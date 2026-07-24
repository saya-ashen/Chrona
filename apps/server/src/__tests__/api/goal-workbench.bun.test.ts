import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { aiClientRegistry, createChronaEngine, waitForGoalAssetOwnershipGeneration } from "@chrona/engine";
import { createApiRouter, type ApiRouter } from "../../routes/api";
import { resetTestDb, seedWorkspace } from "../bun-test-helpers";

function post(app: ApiRouter, path: string, body: unknown) {
  return app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function seedGoalResult() {
  const { workspaceId } = await seedWorkspace();
  const goal = await db.goal.create({ data: { workspaceId, title: "Publish launch kit", description: "Durable launch assets", successCriteria: [], status: "Active" } });
  const task = await db.task.create({ data: { workspaceId, goalId: goal.id, title: "Draft launch brief", executionRuntime: "hermes", executionConfig: {}, status: "Completed", priority: "Medium" } });
  const occurrence = await db.taskOccurrence.create({ data: { workspaceId, taskId: task.id, occurrenceKey: `manual:${task.id}`, source: { kind: "manual" }, status: "Completed", eligibleAt: new Date(), completedAt: new Date() } });
  const run = await db.run.create({ data: { taskId: task.id, occurrenceId: occurrence.id, runtimeName: "hermes", status: "Completed", triggeredBy: "user" } });
  const artifact = await db.artifact.create({ data: { workspaceId, taskId: task.id, runId: run.id, occurrenceId: occurrence.id, type: "report", title: "Launch brief", uri: "generated://launch.md", contentPreview: "# Launch\nReady" } });
  await db.event.create({ data: { workspaceId, taskId: task.id, runId: run.id, eventType: "task.result_accepted", actorType: "user", source: "ui", payload: { accepted_run_id: run.id }, dedupeKey: `accepted:${run.id}`, ingestSequence: 1 } });
  return { workspaceId, goal, task, run, artifact };
}

describe("Goal Workbench API", () => {
  beforeEach(async () => { await resetTestDb(); });

  it("extracts an accepted artifact candidate and formalizes an immutable version", async () => {
    const seeded = await seedGoalResult();
    const app = createApiRouter(createChronaEngine());
    const extracted = await post(app, `/goals/${seeded.goal.id}/inbox/extract`, { taskId: seeded.task.id, runId: seeded.run.id });
    expect(extracted.status).toBe(200);
    const { candidates } = await extracted.json() as { candidates: Array<{ id: string; kind: string; reason: string }> };
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ kind: "document" });
    expect(candidates[0]!.reason).toBe("no_rule_based_name_match");

    const resolved = await post(app, `/goals/${seeded.goal.id}/inbox/${candidates[0]!.id}/resolve`, { workspaceId: seeded.workspaceId, action: "create_asset", label: "Launch brief" });
    expect(resolved.status).toBe(200);
    const assetsResponse = await app.request(`/goals/${seeded.goal.id}/assets?workspaceId=${seeded.workspaceId}`);
    const { assets } = await assetsResponse.json() as { assets: Array<{ kind: string; versions: Array<{ version: number; source: string }> }> };
    expect(assets[0]).toMatchObject({ kind: "document", versions: [{ version: 1, source: "inbox" }] });
  });

  it("generates a bounded AI ownership proposal and applies it only after user confirmation", async () => {
    const seeded = await seedGoalResult();
    const aiClient = await db.aiClient.create({
      data: { name: "Asset ownership debug provider", type: "debug", config: { profile: "deterministic" }, isDefault: true, enabled: true },
    });
    await db.aiFeatureBinding.create({ data: { feature: "goal.asset_ownership", clientId: aiClient.id } });
    await aiClientRegistry.refresh();
    const app = createApiRouter(createChronaEngine());
    const extracted = await post(app, `/goals/${seeded.goal.id}/inbox/extract`, { taskId: seeded.task.id, runId: seeded.run.id });
    const { candidates } = await extracted.json() as { candidates: Array<{ id: string }> };
    const candidateId = candidates[0]!.id;

    const generated = await post(app, `/goals/${seeded.goal.id}/inbox/${candidateId}/ownership-proposals`, {
      workspaceId: seeded.workspaceId,
      idempotencyKey: "asset-ownership-generate-1",
    });
    expect(generated.status).toBe(202);
    const started = await generated.json() as { proposalId: string; sourceTaskId: string };
    await waitForGoalAssetOwnershipGeneration(started.proposalId);
    const proposal = await db.goalAssetOwnershipProposal.findUniqueOrThrow({ where: { id: started.proposalId } });
    expect(proposal.status).toBe("Ready");
    expect(proposal.providerType).toBe("debug");
    expect(proposal.decision).toBe("create_asset");
    expect(await db.goalAsset.count({ where: { goalId: seeded.goal.id } })).toBe(0);

    const applied = await post(app, `/goals/${seeded.goal.id}/inbox/${candidateId}/ownership-proposals/${proposal.id}/apply`, {
      workspaceId: seeded.workspaceId,
      idempotencyKey: "asset-ownership-apply-1",
      action: "apply_suggestion",
    });
    expect(applied.status).toBe(200);
    expect((await applied.json() as { status: string }).status).toBe("Applied");
    expect(await db.goalAsset.count({ where: { goalId: seeded.goal.id } })).toBe(1);

    const replay = await post(app, `/goals/${seeded.goal.id}/inbox/${candidateId}/ownership-proposals/${proposal.id}/apply`, {
      workspaceId: seeded.workspaceId,
      idempotencyKey: "asset-ownership-apply-1",
      action: "apply_suggestion",
    });
    expect(replay.status).toBe(200);
    expect(await db.goalAsset.count({ where: { goalId: seeded.goal.id } })).toBe(1);
  });

  it("marks an ownership proposal stale when the frozen candidate set changes", async () => {
    const seeded = await seedGoalResult();
    const aiClient = await db.aiClient.create({ data: { name: "Stale ownership debug", type: "debug", config: {}, isDefault: true, enabled: true } });
    await db.aiFeatureBinding.create({ data: { feature: "goal.asset_ownership", clientId: aiClient.id } });
    await aiClientRegistry.refresh();
    const app = createApiRouter(createChronaEngine());
    const extracted = await post(app, `/goals/${seeded.goal.id}/inbox/extract`, { taskId: seeded.task.id, runId: seeded.run.id });
    const { candidates } = await extracted.json() as { candidates: Array<{ id: string }> };
    const candidateId = candidates[0]!.id;
    const generated = await post(app, `/goals/${seeded.goal.id}/inbox/${candidateId}/ownership-proposals`, { workspaceId: seeded.workspaceId, idempotencyKey: "stale-generate" });
    const { proposalId } = await generated.json() as { proposalId: string };
    await waitForGoalAssetOwnershipGeneration(proposalId);

    await db.goalInboxCandidate.update({ where: { id: candidateId }, data: { label: "Renamed after review" } });
    const apply = await post(app, `/goals/${seeded.goal.id}/inbox/${candidateId}/ownership-proposals/${proposalId}/apply`, { workspaceId: seeded.workspaceId, idempotencyKey: "stale-apply", action: "apply_suggestion" });
    expect(apply.status).toBe(409);
    expect((await db.goalAssetOwnershipProposal.findUniqueOrThrow({ where: { id: proposalId } })).status).toBe("Stale");
    expect(await db.goalAsset.count({ where: { goalId: seeded.goal.id } })).toBe(0);
  });

  it("rejects resolving the same Inbox candidate twice without duplicate versions", async () => {
    const seeded = await seedGoalResult();
    const app = createApiRouter(createChronaEngine());
    const extracted = await post(app, `/goals/${seeded.goal.id}/inbox/extract`, { taskId: seeded.task.id, runId: seeded.run.id });
    const { candidates } = await extracted.json() as { candidates: Array<{ id: string }> };
    const command = { workspaceId: seeded.workspaceId, action: "create_asset", label: "Launch brief" };

    expect((await post(app, `/goals/${seeded.goal.id}/inbox/${candidates[0]!.id}/resolve`, command)).status).toBe(200);
    expect((await post(app, `/goals/${seeded.goal.id}/inbox/${candidates[0]!.id}/resolve`, command)).status).toBe(404);
    expect(await db.goalAsset.count({ where: { goalId: seeded.goal.id } })).toBe(1);
    expect(await db.goalAssetVersion.count({ where: { goalId: seeded.goal.id } })).toBe(1);
  });

  it("detects optimistic conflicts and recovers old versions as new versions", async () => {
    const seeded = await seedGoalResult();
    const asset = await db.goalAsset.create({ data: { workspaceId: seeded.workspaceId, goalId: seeded.goal.id, sourceArtifactId: seeded.artifact.id, currentArtifactId: seeded.artifact.id, kind: "document", role: "working_document", status: "Approved", label: "Launch brief" } });
    const first = await db.goalAssetVersion.create({ data: { workspaceId: seeded.workspaceId, goalId: seeded.goal.id, assetId: asset.id, artifactId: seeded.artifact.id, version: 1, source: "inbox", content: "one", contentHash: "one", authorType: "user" } });
    const app = createApiRouter(createChronaEngine());
    const draftResponse = await post(app, `/goals/${seeded.goal.id}/assets/${asset.id}/drafts`, { workspaceId: seeded.workspaceId, baseVersionId: first.id, authorType: "user", content: "two" });
    const draft = await draftResponse.json() as { id: string };
    await db.goalAssetVersion.create({ data: { workspaceId: seeded.workspaceId, goalId: seeded.goal.id, assetId: asset.id, version: 2, parentVersionId: first.id, source: "manual", content: "other", contentHash: "other", authorType: "user" } });
    const conflicted = await post(app, `/goals/${seeded.goal.id}/assets/${asset.id}/drafts/submit`, { workspaceId: seeded.workspaceId, draftId: draft.id, changeSummary: "Publish two" });
    expect(conflicted.status).toBe(409);
    expect((await db.goalAssetDraft.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("Conflict");

    const restored = await post(app, `/goals/${seeded.goal.id}/assets/${asset.id}/versions/${first.id}/restore`, { workspaceId: seeded.workspaceId, changeSummary: "Recover one" });
    expect(restored.status).toBe(200);
    const recovered = await restored.json() as { version: number; source: string; parentVersionId: string };
    expect(recovered).toMatchObject({ version: 3, source: "restored" });
  });
  it("submits version-bound Forms, writes exports, and preserves archive history", async () => {
    const seeded = await seedGoalResult();
    const asset = await db.goalAsset.create({ data: { workspaceId: seeded.workspaceId, goalId: seeded.goal.id, sourceArtifactId: seeded.artifact.id, currentArtifactId: seeded.artifact.id, kind: "form", role: "working_document", status: "Approved", label: "Launch intake" } });
    const version = await db.goalAssetVersion.create({ data: { workspaceId: seeded.workspaceId, goalId: seeded.goal.id, assetId: asset.id, artifactId: seeded.artifact.id, version: 1, source: "inbox", content: { fields: [{ id: "name", type: "text", required: true }] }, contentHash: "form-v1", authorType: "user" } });
    const app = createApiRouter(createChronaEngine());

    const submission = await post(app, `/goals/${seeded.goal.id}/assets/${asset.id}/submissions`, { workspaceId: seeded.workspaceId, versionId: version.id, content: { name: "Chrona" } });
    expect(submission.status).toBe(200);
    expect((await submission.json() as { versionId: string }).versionId).toBe(version.id);

    const missingRequired = await post(app, `/goals/${seeded.goal.id}/assets/${asset.id}/submissions`, { workspaceId: seeded.workspaceId, versionId: version.id, content: {} });
    expect(missingRequired.status).toBe(400);
    const unknownField = await post(app, `/goals/${seeded.goal.id}/assets/${asset.id}/submissions`, { workspaceId: seeded.workspaceId, versionId: version.id, content: { name: "Chrona", previewSubmission: true } });
    expect(unknownField.status).toBe(400);
    expect(await db.goalFormSubmission.count({ where: { assetId: asset.id } })).toBe(1);

    const exported = await post(app, `/goals/${seeded.goal.id}/assets/${asset.id}/jobs`, { workspaceId: seeded.workspaceId, versionId: version.id, kind: "export", format: "json" });
    expect(await exported.json()).toMatchObject({ status: "Completed", outputUri: expect.stringContaining(`/v1.json`) });

    const sourceDownload = await app.request(`/goals/${seeded.goal.id}/assets/${asset.id}/download?versionId=${version.id}&mode=source`);
    expect(sourceDownload.status).toBe(200);
    expect(sourceDownload.headers.get("content-disposition")).toContain("Launch%20intake-v1.json");
    expect(await sourceDownload.text()).toContain('"fields"');

    const exportDownload = await app.request(`/goals/${seeded.goal.id}/assets/${asset.id}/download?versionId=${version.id}&mode=export`);
    expect(exportDownload.status).toBe(200);
    expect(exportDownload.headers.get("content-disposition")).toContain("v1.json");
    expect(await exportDownload.text()).toContain('"fields"');

    const unsupported = await post(app, `/goals/${seeded.goal.id}/assets/${asset.id}/jobs`, { workspaceId: seeded.workspaceId, versionId: version.id, kind: "export", format: "pdf" });
    expect(unsupported.status).toBe(400);
    expect((await post(app, `/goals/${seeded.goal.id}/assets/${asset.id}/archive`, { workspaceId: seeded.workspaceId, action: "archive" })).status).toBe(200);
    expect((await db.goalAsset.findUniqueOrThrow({ where: { id: asset.id } })).archivedAt).not.toBeNull();
    expect(await db.goalAssetVersion.count({ where: { assetId: asset.id } })).toBe(1);
    expect((await post(app, `/goals/${seeded.goal.id}/assets/${asset.id}/archive`, { workspaceId: seeded.workspaceId, action: "restore" })).status).toBe(200);
  });

  it("rejects malformed and escaping completed export references", async () => {
    const seeded = await seedGoalResult();
    const asset = await db.goalAsset.create({ data: { workspaceId: seeded.workspaceId, goalId: seeded.goal.id, sourceArtifactId: seeded.artifact.id, currentArtifactId: seeded.artifact.id, kind: "document", role: "working_document", status: "Approved", label: "Secure brief" } });
    const version = await db.goalAssetVersion.create({ data: { workspaceId: seeded.workspaceId, goalId: seeded.goal.id, assetId: asset.id, artifactId: seeded.artifact.id, version: 1, source: "inbox", content: "Secure content", contentHash: "secure-v1", authorType: "user" } });
    const app = createApiRouter(createChronaEngine());

    for (const outputUri of ["generated://goals/../secret.txt", "generated://goals//secret.txt", "file:///tmp/secret.txt"]) {
      await db.goalAssetJob.deleteMany({ where: { assetId: asset.id } });
      await db.goalAssetJob.create({ data: { workspaceId: seeded.workspaceId, goalId: seeded.goal.id, assetId: asset.id, versionId: version.id, kind: "export", format: "md", status: "Completed", outputUri } });
      const response = await app.request(`/goals/${seeded.goal.id}/assets/${asset.id}/download?versionId=${version.id}&mode=export`);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Export path is invalid" });
    }
  });

  it("creates a bounded AI modification Task with an immutable asset version snapshot", async () => {
    const seeded = await seedGoalResult();
    const asset = await db.goalAsset.create({ data: { workspaceId: seeded.workspaceId, goalId: seeded.goal.id, sourceArtifactId: seeded.artifact.id, currentArtifactId: seeded.artifact.id, kind: "document", role: "working_document", status: "Approved", label: "Launch brief" } });
    const version = await db.goalAssetVersion.create({ data: { workspaceId: seeded.workspaceId, goalId: seeded.goal.id, assetId: asset.id, artifactId: seeded.artifact.id, version: 1, source: "inbox", content: "Immutable base", contentHash: "base-v1", authorType: "user" } });
    const app = createApiRouter(createChronaEngine());

    const response = await post(app, `/goals/${seeded.goal.id}/assets/${asset.id}/ai-modification-task`, { workspaceId: seeded.workspaceId, versionId: version.id, instruction: "Clarify the recommendation", expectedOutcome: "A reviewed clearer brief" });

    expect(response.status).toBe(200);
    const { taskId } = await response.json() as { taskId: string };
    const created = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(created.goalId).toBe(seeded.goal.id);
    expect(created.autoExecute).toBe(false);
    expect(created.goalContext).toMatchObject({ items: [{ snapshot: { assetId: asset.id, versionId: version.id, contentHash: "base-v1" } }], expectedOutcome: "A reviewed clearer brief" });

    await db.goalAssetVersion.create({ data: { workspaceId: seeded.workspaceId, goalId: seeded.goal.id, assetId: asset.id, version: 2, parentVersionId: version.id, source: "manual", content: "Newer content", contentHash: "base-v2", authorType: "user" } });
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).goalContext).toMatchObject({ items: [{ snapshot: { versionId: version.id, contentHash: "base-v1" } }] });
  });

  it("rejects appending an Inbox candidate when the selected base version is stale", async () => {
    const seeded = await seedGoalResult();
    const target = await db.goalAsset.create({ data: { workspaceId: seeded.workspaceId, goalId: seeded.goal.id, sourceArtifactId: seeded.artifact.id, currentArtifactId: seeded.artifact.id, kind: "document", role: "working_document", status: "Approved", label: "Existing brief" } });
    const first = await db.goalAssetVersion.create({ data: { workspaceId: seeded.workspaceId, goalId: seeded.goal.id, assetId: target.id, artifactId: seeded.artifact.id, version: 1, source: "inbox", content: "one", contentHash: "one", authorType: "user" } });
    const app = createApiRouter(createChronaEngine());
    const extracted = await post(app, `/goals/${seeded.goal.id}/inbox/extract`, { taskId: seeded.task.id, runId: seeded.run.id });
    const { candidates } = await extracted.json() as { candidates: Array<{ id: string }> };
    await db.goalAssetVersion.create({ data: { workspaceId: seeded.workspaceId, goalId: seeded.goal.id, assetId: target.id, version: 2, parentVersionId: first.id, source: "manual", content: "two", contentHash: "two", authorType: "user" } });

    const response = await post(app, `/goals/${seeded.goal.id}/inbox/${candidates[0]!.id}/resolve`, { workspaceId: seeded.workspaceId, action: "append_version", targetAssetId: target.id, baseVersionId: first.id, changeSummary: "Append accepted result" });
    expect(response.status).toBe(409);
    expect(await db.goalAssetVersion.count({ where: { assetId: target.id } })).toBe(2);
    expect((await db.goalInboxCandidate.findUniqueOrThrow({ where: { id: candidates[0]!.id } })).status).toBe("Pending");
  });

});
