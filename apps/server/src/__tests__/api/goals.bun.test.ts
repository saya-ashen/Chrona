import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { aiClientRegistry, createChronaEngine, waitForGoalReviewGeneration } from "@chrona/engine";
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

  it("atomically and idempotently creates a direct Goal with its first bounded Task", async () => {
    const { workspaceId } = await seedWorkspace("Direct Goal entry");
    const app = createApiRouter(createChronaEngine());
    const command = { workspaceId, title: "Launch a durable program", firstTaskTitle: "Draft the launch brief", additionalContext: "Start with evidence", priority: "High", idempotencyKey: "direct-goal-entry-1" };

    const first = await responseJson<GoalTaskResponse>(await requestJson(app, "/goals/with-first-task", command));
    const second = await responseJson<GoalTaskResponse>(await requestJson(app, "/goals/with-first-task", command));
    expect(second.taskId).toBe(first.taskId);
    expect(second.goal.id).toBe(first.goal.id);
    expect(await db.goal.count({ where: { workspaceId } })).toBe(1);
    expect(await db.task.count({ where: { workspaceId, goalId: first.goal.id } })).toBe(1);
    const createdGoal = await db.goal.findUniqueOrThrow({ where: { id: first.goal.id } });
    expect(createdGoal.description).toBe("Start with evidence");
    expect(createdGoal.operationalBrief).toMatchObject({
      outcome: "Launch a durable program",
      currentFocus: "Draft the launch brief",
      strategy: "",
      constraints: [],
    });
    expect(await db.taskOccurrence.count({ where: { taskId: first.taskId } })).toBe(1);
    const createdTask = await db.task.findUniqueOrThrow({ where: { id: first.taskId }, include: { sessions: true, projection: true } });
    expect(createdTask.description).toBeNull();
    expect(createdTask.goalContext).toMatchObject({
      goal: {
        title: "Launch a durable program",
        additionalContext: "Start with evidence",
        operationalBrief: {
          outcome: "Launch a durable program",
          currentFocus: "Draft the launch brief",
        },
      },
    });
    expect(createdTask.sessions).toHaveLength(1);
    expect(createdTask.defaultSessionId).toBe(createdTask.sessions[0]?.id);
    expect(createdTask.sessions[0]?.sessionKey).toBe(`chrona:task:${first.taskId}:default`);
    expect(createdTask.projection).not.toBeNull();
    expect(await db.event.count({ where: { taskId: first.taskId, eventType: "task.created" } })).toBe(1);
  });

  it("coalesces concurrent retries into one Goal and first Task", async () => {
    const { workspaceId } = await seedWorkspace("Concurrent direct Goal entry");
    const app = createApiRouter(createChronaEngine());
    const command = { workspaceId, title: "One durable outcome", firstTaskTitle: "One bounded Task", idempotencyKey: "concurrent-direct-goal" };

    const responses = await Promise.all([requestJson(app, "/goals/with-first-task", command), requestJson(app, "/goals/with-first-task", command)]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const payloads = await Promise.all(responses.map((response) => responseJson<GoalTaskResponse>(response)));
    expect(new Set(payloads.map((payload) => payload.goal.id)).size).toBe(1);
    expect(new Set(payloads.map((payload) => payload.taskId)).size).toBe(1);
    expect(await db.goal.count({ where: { workspaceId } })).toBe(1);
    expect(await db.task.count({ where: { workspaceId } })).toBe(1);
  });

  it("rolls back the Goal when canonical Task validation fails", async () => {
    const { workspaceId } = await seedWorkspace("Invalid direct Goal entry");
    const app = createApiRouter(createChronaEngine());

    const response = await requestJson(app, "/goals/with-first-task", { workspaceId, title: "Never persist partially", firstTaskTitle: "   ", idempotencyKey: "invalid-direct-goal" });

    expect(response.status).toBe(400);
    expect(await db.goal.count({ where: { workspaceId } })).toBe(0);
    expect(await db.task.count({ where: { workspaceId } })).toBe(0);
    expect(await db.event.count({ where: { dedupeKey: "goal.created_with_first_task:invalid-direct-goal" } })).toBe(0);
  });

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

  it("surfaces pending result inbox work on an achieved Goal", async () => {
    const { workspaceId } = await seedWorkspace("Archived Goal inbox attention");
    const app = createApiRouter(createChronaEngine());
    const created = await responseJson<GoalData>(await requestJson(app, "/goals", {
      workspaceId,
      title: "Retain an achieved result",
      description: "Archive with one unprocessed result candidate.",
      successCriteria: [{ ...criterion, satisfied: true, confirmedAt: new Date().toISOString() }],
    }));
    const { taskId } = await seedTask(workspaceId, { title: "Produce retained result", status: "Done" });
    await db.task.update({ where: { id: taskId }, data: { goalId: created.id } });
    const { run } = await seedAcceptedResult(workspaceId, taskId);
    await db.goal.update({
      where: { id: created.id },
      data: { status: "Achieved", achievedAt: new Date(), achievementConfirmation: { note: "Confirmed", actorType: "user", actorId: "user-1", confirmedAt: new Date().toISOString(), evidenceArtifactIds: [] } },
    });
    await db.goalInboxCandidate.create({
      data: {
        workspaceId,
        goalId: created.id,
        sourceTaskId: taskId,
        sourceRunId: run.id,
        groupKey: "accepted-result",
        kind: "document",
        label: "Retained result",
        proposedAction: "create_asset",
        reason: "Needs review",
        changeSummary: "Create retained asset",
        confidence: 0.8,
        content: "Result content",
        contentHash: "pending-result",
      },
    });

    const read = await responseJson<GoalData>(await app.request(`/goals/${created.id}`));
    expect(read.mode).toBe("archive");
    expect(read.projection.attention).toBe("needs_input");
    expect(read.workbench.pendingInboxCount).toBe(1);
  });

  it("targets the planned Task when active Goal work can continue", async () => {
    const { workspaceId } = await seedWorkspace("Goal primary action");
    const app = createApiRouter(createChronaEngine());
    const created = await responseJson<GoalData>(await requestJson(app, "/goals", {
      workspaceId,
      title: "Prepare an application",
      description: "Complete the next bounded step.",
      successCriteria: [{ id: "submitted", kind: "user_confirmed", description: "Application submitted", satisfied: false, confirmedAt: null }],
    }));
    const taskResponse = await responseJson<GoalTaskResponse>(await requestJson(app, `/goals/${created.id}/tasks`, {
      title: "Assemble the final application package",
      description: "Prepare the package for submission.",
      kind: "task",
      priority: "Medium",
    }));

    expect(taskResponse.goal.primaryAction).toEqual({ kind: "continue_work", taskId: taskResponse.taskId });
  });

  it("persists a Goal brief and immutable accepted-result context automatically", async () => {
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
    const { run } = await seedAcceptedResult(workspaceId, sourceTask.taskId);
    const formalArtifact = await db.artifact.create({
      data: {
        workspaceId,
        taskId: sourceTask.taskId,
        runId: run.id,
        type: "file",
        title: "Current research brief",
        uri: "generated://tests/current-research-brief.md",
        contentPreview: "Current approved guidance",
      },
    });
    const formalAsset = await db.goalAsset.create({
      data: {
        workspaceId,
        goalId: created.id,
        sourceArtifactId: formalArtifact.id,
        currentArtifactId: formalArtifact.id,
        role: "working_document",
        status: "Approved",
        label: "Research brief",
        kind: "document",
      },
    });
    await db.goalAssetVersion.create({
      data: {
        workspaceId,
        goalId: created.id,
        assetId: formalAsset.id,
        artifactId: formalArtifact.id,
        version: 1,
        source: "inbox",
        content: "Current approved guidance",
        contentHash: "formal-v1",
        authorType: "user",
      },
    });

    const nextTask = await responseJson<GoalTaskResponse>(await requestJson(app, `/goals/${created.id}/tasks`, {
      kind: "task",
      title: "Draft next application step",
      description: "Use only the frozen workbench context.",
      priority: "High",
      autoPlanGeneration: false,
      expectedOutcome: "A bounded draft",
    }));
    const persisted = await db.task.findUniqueOrThrow({ where: { id: nextTask.taskId } });
    expect(persisted.goalContext).toMatchObject({
      goal: { title: created.title, operationalBrief: brief },
      acceptedResults: [{ taskTitle: "Confirm target opening" }],
      expectedOutcome: "A bounded draft",
    });
    expect(persisted.goalContext).toMatchObject({
      assets: [{
        label: "Research brief",
        version: 1,
        content: "Current approved guidance",
      }],
    });
    const formalAssets = persisted.goalContext && typeof persisted.goalContext === "object" && !Array.isArray(persisted.goalContext) && "assets" in persisted.goalContext
      ? persisted.goalContext.assets
      : null;
    const firstAsset = Array.isArray(formalAssets) ? formalAssets[0] : null;
    const formalAssetRef = firstAsset && typeof firstAsset === "object" && "ref" in firstAsset
      ? firstAsset.ref
      : null;
    expect(formalAssetRef).toMatch(/^GA[0-9A-F]{12}$/);
    expect(formalAssetRef).not.toContain(formalAsset.id);
    const goalResults = await createChronaEngine().goals.readAcceptedResults({
      taskId: nextTask.taskId,
      workspaceId,
      query: "Current approved guidance",
      limit: 5,
    });
    expect(goalResults.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: formalAssetRef,
          title: "Research brief",
          version: 1,
          summary: "Current approved guidance",
        }),
      ]),
    );
    expect(persisted.goalContext).toBeTruthy();
    expect(typeof persisted.goalContext).toBe("object");
    expect(persisted.goalContext).not.toBeInstanceOf(Array);
    const acceptedResults = persisted.goalContext && typeof persisted.goalContext === "object" && !Array.isArray(persisted.goalContext) && "acceptedResults" in persisted.goalContext
      ? persisted.goalContext.acceptedResults
      : null;
    expect(Array.isArray(acceptedResults)).toBe(true);
    const firstAcceptedResult = Array.isArray(acceptedResults) ? acceptedResults[0] : null;
    const acceptedResultRef = firstAcceptedResult && typeof firstAcceptedResult === "object" && "ref" in firstAcceptedResult
      ? firstAcceptedResult.ref
      : null;
    expect(acceptedResultRef).toMatch(/^GR[0-9A-F]{12}$/);
    expect(acceptedResultRef).not.toContain(run.id);
    const bootstrapResponse = await app.request(`/tasks/${nextTask.taskId}`);
    expect(bootstrapResponse.status).toBe(200);
    const bootstrap = await responseJson<{ task: { goalId: string | null; goal: { id: string; title: string } | null } }>(bootstrapResponse);
    expect(bootstrap.task.goalId).toBe(created.id);
    expect(bootstrap.task.goal).toEqual({ id: created.id, title: created.title });

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
    expect(firstBody.titleSource).toBe("system");
    expect(firstBody.titleRenameNoticeSeenAt).toBeNull();
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

    const extracted = await responseJson<{ candidates: Array<{ id: string }> }>(await requestJson(app, `/goals/${goal.id}/inbox/extract`, {
      taskId,
      runId: accepted.run.id,
    }));
    await responseJson(await requestJson(app, `/goals/${goal.id}/inbox/${extracted.candidates[0]!.id}/resolve`, {
      workspaceId,
      action: "create_asset",
      label: "Accepted evidence",
    }));
    const processed = await responseJson<GoalData>(await requestJson(app, `/goals/${goal.id}/results/${taskId}/process`, {
      artifactIds: [accepted.artifact.id],
      criterionId: "outcome",
    }));
    expect(processed.assets[0]?.sourceArtifact.id).toBe(accepted.artifact.id);
    expect(processed.assets[0]?.role).toBe("evidence");

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


  it("generates, persists, and atomically applies an itemized Goal Review Proposal", async () => {
    const { workspaceId } = await seedWorkspace("Goal AI review");
    const aiClient = await db.aiClient.create({
      data: {
        name: "Goal review debug provider",
        type: "debug",
        config: { profile: "deterministic" },
        isDefault: true,
        enabled: true,
      },
    });
    await db.aiFeatureBinding.create({ data: { feature: "goal.review", clientId: aiClient.id } });
    const engine = createChronaEngine();
    await aiClientRegistry.refresh();
    const app = createApiRouter(engine);
    const goal = await responseJson<GoalData>(await requestJson(app, "/goals", {
      workspaceId,
      title: "Review a durable outcome",
      successCriteria: [criterion],
    }));
    await requestJson(app, `/goals/${goal.id}/brief`, {
      brief: { outcome: "Durable outcome", currentFocus: "Initial focus", strategy: "Use evidence", constraints: ["No invented facts"] },
    });

    const generation = await requestJson(app, `/goals/${goal.id}/reviews/generate`, { idempotencyKey: "goal-review-request-1" });
    expect(generation.status).toBe(202);
    const started = await responseJson<{ proposalId: string; sourceTaskId: string }>(generation);
    await waitForGoalReviewGeneration(started.proposalId);
    const proposal = await db.goalReviewProposal.findUnique({ where: { id: started.proposalId }, include: { items: true } });
    expect(proposal?.status).toBe("Ready");
    expect(proposal?.providerName).toBe("debug");
    expect(proposal?.items).toHaveLength(1);
    expect(proposal?.items[0]?.kind).toBe("brief_field");

    const apply = await requestJson(app, `/goals/${goal.id}/reviews/${started.proposalId}/apply`, {
      idempotencyKey: "goal-review-apply-1",
      decisions: [{ itemId: "debug-current-focus", action: "accept" }],
    });
    expect(apply.status).toBe(200);
    const refreshed = await responseJson<GoalData>(await app.request(`/goals/${goal.id}`));
    expect(refreshed.workbench.brief?.currentFocus).toBe("Review the next bounded outcome");
    expect(refreshed.reviewProposals[0]?.status).toBe("Applied");
    expect(refreshed.reviewProposals[0]?.items[0]?.decision).toBe("Accepted");

    const replay = await requestJson(app, `/goals/${goal.id}/reviews/${started.proposalId}/apply`, {
      idempotencyKey: "goal-review-apply-1",
      decisions: [{ itemId: "debug-current-focus", action: "accept" }],
    });
    expect(replay.status).toBe(200);
    expect(await db.goalBriefRevision.count({ where: { goalId: goal.id } })).toBe(1);
  });

  it("marks conflicting Goal Review items stale without overwriting current state", async () => {
    const { workspaceId } = await seedWorkspace("Goal stale review");
    const goal = await db.goal.create({
      data: {
        workspaceId,
        title: "Guard review dependencies",
        description: null,
        status: "Active",
        successCriteria: [criterion],
        operationalBrief: { outcome: "Outcome", currentFocus: "Frozen focus", strategy: "Strategy", constraints: [] },
      },
    });
    const { taskId } = await seedTask(workspaceId, { title: "Review source" });
    await db.task.update({ where: { id: taskId }, data: { goalId: goal.id } });
    const proposal = await db.goalReviewProposal.create({
      data: {
        workspaceId,
        goalId: goal.id,
        sourceTaskId: taskId,
        status: "Ready",
        inputSnapshot: {},
        inputSnapshotHash: "snapshot",
        requestIdempotencyKey: "stale-review-request",
        items: {
          create: {
            workspaceId,
            goalId: goal.id,
            itemId: "focus-change",
            kind: "brief_field",
            payload: { field: "currentFocus", value: "Proposed focus" },
            rationale: "Old rationale",
            evidenceRefs: [],
            warnings: [],
            dependencySnapshot: { kind: "brief_field", field: "currentFocus", value: "Frozen focus" },
            dependencyHash: "sha256:not-current",
          },
        },
      },
    });
    await db.goal.update({ where: { id: goal.id }, data: { operationalBrief: { outcome: "Outcome", currentFocus: "User changed focus", strategy: "Strategy", constraints: [] } } });
    const app = createApiRouter(createChronaEngine());
    const response = await requestJson(app, `/goals/${goal.id}/reviews/${proposal.id}/apply`, {
      idempotencyKey: "stale-review-apply",
      decisions: [{ itemId: "focus-change", action: "accept" }],
    });
    expect(response.status).toBe(200);
    const storedGoal = await db.goal.findUniqueOrThrow({ where: { id: goal.id } });
    expect(storedGoal.operationalBrief).toMatchObject({ currentFocus: "User changed focus" });
    const item = await db.goalReviewProposalItem.findFirstOrThrow({ where: { proposalId: proposal.id } });
    expect(item.decision).toBe("Stale");
  });
  it("rejects criterion evidence until every selected Artifact is formalized in the Inbox", async () => {
    const { workspaceId } = await seedWorkspace("Goal unformalized evidence");
    const { taskId } = await seedTask(workspaceId, { title: "Produce pending evidence", status: "Completed" });
    const accepted = await seedAcceptedResult(workspaceId, taskId);
    const app = createApiRouter(createChronaEngine());
    const goal = await responseJson<GoalData>(await requestJson(app, "/goals", {
      workspaceId,
      title: "Require Inbox review",
      successCriteria: [criterion],
    }));
    await db.task.update({ where: { id: taskId }, data: { goalId: goal.id } });

    const response = await requestJson(app, `/goals/${goal.id}/results/${taskId}/process`, {
      artifactIds: [accepted.artifact.id],
      criterionId: "outcome",
    });

    expect(response.status).toBe(400);
    expect(await responseJson<{ error: string }>(response)).toEqual({
      error: "Review every selected Artifact in the Goal Workbench Inbox before linking it as criterion evidence",
    });
    expect(await db.event.count({ where: { eventType: "goal.result_processed", workspaceId } })).toBe(0);
  });

  it("keeps proposed criteria outside progress until explicit review", async () => {
    const { workspaceId } = await seedWorkspace("Goal criteria review");
    const app = createApiRouter(createChronaEngine());
    const goal = await responseJson<GoalData>(await requestJson(app, "/goals", {
      workspaceId,
      title: "Review proposed success",
      successCriteria: [{ ...criterion, proposalStatus: "proposed" }],
    }));
    expect(goal.primaryAction.kind).toBe("review_criteria");
    expect(goal.projection.criteriaTotalCount).toBe(0);

    const reviewed = await responseJson<GoalData>(await requestJson(app, `/goals/${goal.id}/criteria/outcome/review`, {
      description: "User-approved outcome definition",
    }));
    expect(reviewed.outcome.criteria[0]).toMatchObject({ proposalStatus: "confirmed", description: "User-approved outcome definition" });
    expect(reviewed.projection.criteriaTotalCount).toBe(1);
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

  it("reads only accepted results scoped through the current Goal Task", async () => {
    const { workspaceId } = await seedWorkspace("Goal result retrieval");
    const otherWorkspace = await seedWorkspace("Isolated Goal result retrieval");
    const engine = createChronaEngine();
    const created = await engine.goals.createWithFirstTask({
      workspaceId,
      title: "Synthesize accepted research",
      firstTaskTitle: "Collect evidence",
      priority: "Medium",
      idempotencyKey: "goal-result-search",
    });
    const accepted = await seedAcceptedResult(workspaceId, created.taskId);
    const rejectedTask = await seedTask(workspaceId, { title: "Rejected evidence", status: "Completed" });
    await db.task.update({ where: { id: rejectedTask.taskId }, data: { goalId: created.goal.id } });
    await db.run.create({ data: { taskId: rejectedTask.taskId, runtimeName: "hermes", status: "Completed", triggeredBy: "test" } });
    const reader = await seedTask(workspaceId, { title: "Use Goal evidence" });
    await db.task.update({ where: { id: reader.taskId }, data: { goalId: created.goal.id } });

    const firstPage = await engine.goals.readAcceptedResults({ taskId: reader.taskId, workspaceId, query: "immutable", limit: 1 });
    expect(firstPage).toMatchObject({ linked: true, results: [{ title: "Collect evidence" }], nextCursor: null });
    expect(firstPage.results[0]?.ref).toMatch(/^GR[0-9A-F]{12}$/);
    expect(firstPage.results[0]?.ref).not.toContain(accepted.run.id);
    expect(firstPage.results.some((result) => result.title === "Rejected evidence")).toBe(false);
    expect(firstPage.results[0]?.artifacts[0]).toEqual({
      title: "Accepted final result",
      type: "summary",
      contentPreview: "Immutable final result",
    });
    expect(JSON.stringify(firstPage)).not.toContain("chrona://result/final");

    await expect(engine.goals.readAcceptedResults({ taskId: reader.taskId, workspaceId: otherWorkspace.workspaceId, limit: 5 }))
      .rejects.toThrow("Task not found");
    const standalone = await seedTask(workspaceId, { title: "Standalone Task" });
    await expect(engine.goals.readAcceptedResults({ taskId: standalone.taskId, workspaceId, limit: 5 }))
      .resolves.toEqual({ linked: false, message: "Current Task is not linked to a Goal.", results: [], nextCursor: null });
    await expect(engine.goals.readAcceptedResults({ taskId: reader.taskId, workspaceId, limit: 5, cursor: "GR000000000000" }))
      .rejects.toThrow("Goal result cursor is invalid or stale");
  });
});
