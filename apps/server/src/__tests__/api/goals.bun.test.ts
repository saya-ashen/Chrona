import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { createChronaEngine } from "@chrona/engine";
import { createApiRouter, type ApiRouter } from "../../routes/api";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";
import type { GoalData } from "../../../../../features/goals";

type GoalTaskResponse = { taskId: string; goal: GoalData };

async function responseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

function requestJson(app: ApiRouter, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function seedAcceptedResult(workspaceId: string, taskId: string) {
  const run = await db.run.create({
    data: { taskId, runtimeName: "hermes", status: "Completed", triggeredBy: "test", endedAt: new Date() },
  });
  const artifact = await db.artifact.create({
    data: {
      workspaceId,
      taskId,
      runId: run.id,
      type: "summary",
      title: "Accepted final result",
      uri: "chrona://result/final",
      contentPreview: "Immutable final result",
    },
  });
  await db.event.create({
    data: {
      workspaceId,
      taskId,
      runId: run.id,
      eventType: "task.result_accepted",
      actorType: "user",
      source: "test",
      payload: { accepted_run_id: run.id, accepted_at: new Date().toISOString() },
      dedupeKey: `accept:${run.id}`,
      ingestSequence: 1,
    },
  });
  return { run, artifact };
}

const criterion = {
  id: "outcome",
  kind: "user_confirmed" as const,
  description: "User confirms the outcome",
  satisfied: false,
  confirmedAt: null,
};

// This scenario proves the complete lifecycle and its persisted evidence in sequence.
// eslint-disable-next-line max-lines-per-function
describe("Goal API", () => {
  beforeEach(resetTestDb);

  it("creates, reads, pauses, resumes, and explicitly achieves a Goal", async () => {
    const { workspaceId } = await seedWorkspace("Goal lifecycle");
    const app = createApiRouter(createChronaEngine());
    const createdResponse = await requestJson(app, "/goals", {
      workspaceId,
      title: "Reach a durable outcome",
      successCriteria: [criterion],
      nextReviewAt: "2026-07-01T00:00:00.000Z",
    });
    expect(createdResponse.status).toBe(201);
    const created = await responseJson<GoalData>(createdResponse);
    expect(created.status).toBe("Active");
    expect(created.projection.activity).toBe("review_due");

    const paused = await responseJson<GoalData>(await requestJson(app, `/goals/${created.id}/actions`, { action: "pause" }));
    expect(paused.status).toBe("Paused");
    expect(paused.projection.nextAction).toBe("resume");

    const resumed = await responseJson<GoalData>(await requestJson(app, `/goals/${created.id}/actions`, { action: "resume" }));
    expect(resumed.status).toBe("Active");

    const { taskId } = await seedTask(workspaceId, {
      title: "Confirm durable outcome",
      status: "Done",
    });
    const { artifact } = await seedAcceptedResult(workspaceId, taskId);
    await db.task.update({ where: { id: taskId }, data: { goalId: created.id } });
    await db.goalAsset.create({
      data: {
        workspaceId,
        goalId: created.id,
        sourceArtifactId: artifact.id,
        currentArtifactId: artifact.id,
        role: "evidence",
        status: "Approved",
        label: "Accepted outcome evidence",
      },
    });
    const achieved = await responseJson<GoalData>(await requestJson(app, `/goals/${created.id}/actions`, {
      action: "achieve",
      confirmation: "Offer received and accepted by the user",
      evidenceArtifactIds: [artifact.id],
    }));
    expect(achieved.status).toBe("Achieved");
    expect(achieved.achievedAt).not.toBeNull();
    expect(achieved.outcome.confirmation).toMatchObject({
      note: "Offer received and accepted by the user",
      actorType: "user",
      evidenceArtifactIds: [artifact.id],
    });
    expect(achieved.outcome.primaryResult?.id).toBe(artifact.id);
    expect(achieved.successCriteria[0]).toMatchObject({ satisfied: true });
    expect(await db.event.count({ where: { eventType: "goal.achieved", workspaceId } })).toBe(1);
  });

  it("creates Goal review work as a bounded task", async () => {
    const { workspaceId } = await seedWorkspace("Goal review");
    const app = createApiRouter(createChronaEngine());
    const created = await responseJson<GoalData>(await requestJson(app, "/goals", {
      workspaceId,
      title: "Reviewable Goal",
      successCriteria: [criterion],
    }));

    const response = await requestJson(app, `/goals/${created.id}/tasks`, {
      kind: "review",
      title: "Review Goal progress",
      description: "Review accepted results and decide the next bounded task.",
      priority: "High",
      autoPlanGeneration: false,
    });
    expect(response.status).toBe(201);
    const body = await responseJson<GoalTaskResponse>(response);
    expect(body.goal.taskGroups.planned[0]).toMatchObject({
      id: body.taskId,
      title: "Review Goal progress",
    });
    expect((await db.task.findUniqueOrThrow({ where: { id: body.taskId } })).goalId).toBe(created.id);
    expect(await db.event.count({ where: { eventType: "goal.review_task_created", taskId: body.taskId } })).toBe(1);
    const read = await responseJson<GoalData>(await app.request(`/goals/${created.id}`));
    expect(read.primaryAction.kind).toBeDefined();
  });

  it("atomically promotes one accepted result and is idempotent", async () => {
    const { workspaceId } = await seedWorkspace("Goal promotion");
    const { taskId } = await seedTask(workspaceId, { title: "Produce a result", status: "Completed" });
    const { run, artifact } = await seedAcceptedResult(workspaceId, taskId);
    const app = createApiRouter(createChronaEngine());
    const command = {
      workspaceId,
      acceptedRunId: run.id,
      artifactIds: [artifact.id],
      title: "Continue this result",
      successCriteria: [criterion],
      idempotencyKey: "promotion-test-key",
    };

    const first = await requestJson(app, `/tasks/${taskId}/actions/promote-to-goal`, command);
    const second = await requestJson(app, `/tasks/${taskId}/actions/promote-to-goal`, command);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = await responseJson<GoalData>(first);
    const secondBody = await responseJson<GoalData>(second);
    expect(secondBody.id).toBe(firstBody.id);
    expect(await db.goal.count()).toBe(1);
    expect(await db.goalAsset.count()).toBe(1);
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).goalId).toBe(firstBody.id);
    expect(await db.artifact.count({ where: { id: artifact.id, contentPreview: "Immutable final result" } })).toBe(1);
  });

  it("rolls back promotion when an artifact is not owned by the accepted result", async () => {
    const { workspaceId } = await seedWorkspace("Goal promotion rollback");
    const { taskId } = await seedTask(workspaceId, { title: "Accepted source", status: "Completed" });
    const accepted = await seedAcceptedResult(workspaceId, taskId);
    const { taskId: otherTaskId } = await seedTask(workspaceId, { title: "Other task", status: "Completed" });
    const other = await seedAcceptedResult(workspaceId, otherTaskId);
    const app = createApiRouter(createChronaEngine());

    const response = await requestJson(app, `/tasks/${taskId}/actions/promote-to-goal`, {
      workspaceId,
      acceptedRunId: accepted.run.id,
      artifactIds: [other.artifact.id],
      title: "Must roll back",
      successCriteria: [criterion],
      idempotencyKey: "promotion-bad-artifact",
    });
    expect(response.status).toBe(400);
    expect(await db.goal.count()).toBe(0);
    expect(await db.goalAsset.count()).toBe(0);
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).goalId).toBeNull();
  });
});
