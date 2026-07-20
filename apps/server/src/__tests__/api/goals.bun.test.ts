import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { createChronaEngine } from "@chrona/engine";
import { createApiRouter } from "../../routes/api";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

function requestJson(app: ReturnType<typeof createApiRouter>, path: string, body: unknown) {
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
    const created = await createdResponse.json() as any;
    expect(created.status).toBe("Active");
    expect(created.projection.activity).toBe("review_due");

    const paused = await (await requestJson(app, `/goals/${created.id}/actions`, { action: "pause" })).json() as any;
    expect(paused.status).toBe("Paused");
    expect(paused.projection.nextAction).toBe("resume");

    const resumed = await (await requestJson(app, `/goals/${created.id}/actions`, { action: "resume" })).json() as any;
    expect(resumed.status).toBe("Active");

    const achieved = await (await requestJson(app, `/goals/${created.id}/actions`, {
      action: "achieve",
      confirmation: "The user accepted the outcome",
    })).json() as any;
    expect(achieved.status).toBe("Achieved");
    expect(achieved.achievedAt).not.toBeNull();
    expect(achieved.successCriteria[0]).toMatchObject({ satisfied: true });
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
    const firstBody = await first.json() as any;
    const secondBody = await second.json() as any;
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
