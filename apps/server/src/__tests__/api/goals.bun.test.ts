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
    const unconfirmedResponse = await requestJson(app, `/goals/${created.id}/actions`, {
      action: "achieve",
      confirmation: "Cannot bypass criterion confirmation",
      evidenceArtifactIds: [artifact.id],
    });
    expect(unconfirmedResponse.status).toBe(409);
    const confirmedResponse = await requestJson(app, `/goals/${created.id}/criteria/outcome/confirm`, {
      artifactIds: [artifact.id],
      note: "The accepted Artifact proves the durable outcome.",
    });
    expect(confirmedResponse.status).toBe(200);
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

  it("persists a Goal brief, working set, and immutable bounded-task context", async () => {
    const { workspaceId } = await seedWorkspace("Goal workbench");
    const app = createApiRouter(createChronaEngine());
    const created = await responseJson<GoalData>(await requestJson(app, "/goals", {
      workspaceId,
      title: "Prepare a research application",
      description: "Build an evidence-backed application over several bounded steps.",
      successCriteria: [{
        id: "submitted",
        kind: "user_confirmed",
        description: "Application submitted",
        satisfied: false,
        confirmedAt: null,
      }],
    }));

    const brief = {
      outcome: "Submit a competitive application",
      currentFocus: "Confirm the target opening",
      strategy: "Use accepted research evidence before drafting",
      constraints: ["Do not invent applicant facts"],
    };
    const briefResponse = await app.request(`/goals/${created.id}/brief`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief }),
    });
    expect(briefResponse.status).toBe(200);

    const sourceTask = await responseJson<GoalTaskResponse>(await requestJson(app, `/goals/${created.id}/tasks`, {
      kind: "task",
      title: "Confirm target opening",
      description: "Review the opening requirements.",
      priority: "High",
      autoPlanGeneration: false,
      expectedOutcome: "A confirmed target opening",
    }));
    const workingSetResponse = await app.request(`/goals/${created.id}/working-set`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selections: [{ subjectType: "task", subjectId: sourceTask.taskId }] }),
    });
    expect(workingSetResponse.status).toBe(200);
    const withWorkingSet = await responseJson<GoalData>(workingSetResponse);
    expect(withWorkingSet.workbench.brief).toEqual(brief);
    expect(withWorkingSet.workbench.workingSet).toHaveLength(1);

    const nextTask = await responseJson<GoalTaskResponse>(await requestJson(app, `/goals/${created.id}/tasks`, {
      kind: "task",
      title: "Draft next application step",
      description: "Use only the frozen workbench context.",
      priority: "High",
      autoPlanGeneration: false,
      expectedOutcome: "A bounded draft",
      contextSelections: [{ subjectType: "task", subjectId: sourceTask.taskId }],
    }));
    const persisted = await db.task.findUniqueOrThrow({ where: { id: nextTask.taskId } });
    expect(persisted.goalContext).toMatchObject({
      goal: { id: created.id, operationalBrief: brief },
      items: [{ subjectType: "task", subjectId: sourceTask.taskId }],
      expectedOutcome: "A bounded draft",
    });
    const bootstrapResponse = await app.request(`/tasks/${nextTask.taskId}`);
    expect(bootstrapResponse.status).toBe(200);
    const bootstrap = await responseJson<{ task: { goalId: string | null; goal: { id: string; title: string } | null } }>(bootstrapResponse);
    expect(bootstrap.task.goalId).toBe(created.id);
    expect(bootstrap.task.goal).toEqual({ id: created.id, title: created.title });

    await app.request(`/goals/${created.id}/working-set`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selections: [] }),
    });
    expect((await db.task.findUniqueOrThrow({ where: { id: nextTask.taskId } })).goalContext)
      .toEqual(persisted.goalContext);
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

  it("processes accepted results, confirms criterion evidence, and applies a structured review", async () => {
    const { workspaceId } = await seedWorkspace("Goal progression");
    const { taskId } = await seedTask(workspaceId, { title: "Produce evidence", status: "Completed" });
    const accepted = await seedAcceptedResult(workspaceId, taskId);
    const app = createApiRouter(createChronaEngine());
    const goal = await responseJson<GoalData>(await requestJson(app, "/goals", {
      workspaceId,
      title: "Progress a durable outcome",
      successCriteria: [criterion],
    }));
    await db.task.update({ where: { id: taskId }, data: { goalId: goal.id } });

    const processed = await responseJson<GoalData>(await requestJson(app, `/goals/${goal.id}/results/${taskId}/process`, {
      artifactIds: [accepted.artifact.id],
      addToWorkingSet: true,
      createGoalAssets: true,
      criterionId: "outcome",
    }));
    expect(processed.assets[0]?.sourceArtifact.id).toBe(accepted.artifact.id);
    expect(processed.workbench.workingSet.some((item) => item.subjectId === processed.assets[0]?.id)).toBe(true);

    const confirmed = await responseJson<GoalData>(await requestJson(app, `/goals/${goal.id}/criteria/outcome/confirm`, {
      artifactIds: [accepted.artifact.id],
      note: "Accepted evidence proves the outcome.",
    }));
    expect(confirmed.outcome.criteria[0]).toMatchObject({ satisfied: true, evidenceArtifactIds: [accepted.artifact.id] });

    const reviewed = await responseJson<GoalData>(await requestJson(app, `/goals/${goal.id}/reviews/apply`, {
      summary: "Focus the next bounded step on final verification.",
      brief: { outcome: "Verified outcome", currentFocus: "Final verification", strategy: "Use accepted evidence", constraints: ["No invented facts"] },
      tasks: [{ kind: "task", title: "Verify final package", description: "Check the retained evidence.", priority: "High", autoPlanGeneration: false, expectedOutcome: "A verified final package" }],
    }));
    expect(reviewed.workbench.brief?.currentFocus).toBe("Final verification");
    expect(reviewed.tasks.some((task) => task.title === "Verify final package")).toBe(true);
    expect(await db.event.count({ where: { eventType: "goal.review_applied", workspaceId } })).toBe(1);
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
