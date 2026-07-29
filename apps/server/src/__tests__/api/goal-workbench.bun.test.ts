import { beforeEach, describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getChronaGeneratedFilesDir } from "@chrona/shared/data-paths";
import { createHash } from "node:crypto";
import { db } from "@chrona/db";
import { aiClientRegistry, createChronaEngine, waitForGoalAssetOwnershipGeneration } from "@chrona/engine";
import { acceptTaskResult } from "@chrona/engine/test-support";
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

async function seedStructuredGoalResultWithoutArtifacts() {
  const { workspaceId } = await seedWorkspace("Structured Goal result");
  const goal = await db.goal.create({ data: { workspaceId, title: "Plan a trip", successCriteria: [], status: "Active" } });
  const task = await db.task.create({ data: { workspaceId, goalId: goal.id, title: "Select destination", executionRuntime: "hermes", executionConfig: {}, status: "Done", priority: "Medium" } });
  const run = await db.run.create({ data: { taskId: task.id, runtimeName: "hermes", status: "Completed", triggeredBy: "user" } });
  const plan = await db.taskPlan.create({ data: { workspaceId, taskId: task.id, planId: "structured-result-plan", revision: 1, status: "Accepted", compiledPlan: {} } });
  const now = new Date().toISOString();
  const spec = {
    root: "workspace",
    elements: {
      workspace: {
        type: "Stack",
        props: { gap: "lg" },
        children: [
          "overview",
          "readiness",
          "section",
          "metrics",
          "comparison",
          "timeline",
          "checklist",
          "changes",
          "summary",
        ],
      },
      overview: {
        type: "ResultOverview",
        props: { title: "Destination selected", summary: "推荐日照＋临沂沂蒙山" },
      },
      readiness: {
        type: "ResultReadiness",
        props: { status: "ready", summary: "Ready" },
      },
      section: {
        type: "ResultSection",
        props: { title: "Recommendation", layout: "stack" },
      },
      metrics: {
        type: "ResultMetricGrid",
        props: { items: [{ label: "Stops", value: "2" }] },
      },
      comparison: {
        type: "ResultComparison",
        props: {
          title: "Options",
          columns: [{ key: "route", label: "Route" }],
          rows: [{ label: "日照", values: { route: "Coastal route" } }],
        },
      },
      timeline: {
        type: "ResultTimeline",
        props: { title: "Weekend", items: [{ label: "Day 1", title: "Arrive in 日照" }] },
      },
      checklist: {
        type: "ResultChecklist",
        props: { title: "Before departure", items: [{ label: "Book hotel", status: "todo" }] },
      },
      changes: {
        type: "ResultChangeSummary",
        props: { title: "Plan changes", items: [{ path: "itinerary.md", summary: "Added 沂蒙山", status: "modified" }] },
      },
      summary: {
        type: "ResultSummary",
        props: { text: "推荐日照＋临沂沂蒙山，路线完整且适合周末出行。" },
      },
    },
  };
  const manifest = {
    schemaVersion: 1,
    sourceRevision: 1,
    outcome: { title: "Destination selected", summary: "推荐日照＋临沂沂蒙山" },
    readiness: { status: "ready", summary: "Ready" },
    sections: [{ key: "outcome", title: "Outcome", kind: "outcome", itemKeys: [] }],
    deliverables: [],
    findings: [],
    decisions: [],
    caveats: [],
    nextActions: [],
    evidence: [],
  };
  const compiledPlan = {
    id: "compiled-structured",
    editablePlanId: plan.planId,
    sourceVersion: 1,
    title: "Select destination",
    goal: "Plan a trip",
    assumptions: [],
    nodes: [],
    edges: [],
    entryNodeIds: [],
    terminalNodeIds: [],
    topologicalOrder: [],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
  await db.taskPlan.update({ where: { id: plan.id }, data: { compiledPlan } });
  await db.taskPlanRun.create({
    data: {
      workspaceId,
      taskId: task.id,
      planId: plan.planId,
      workBlockScopeKey: "",
      planRun: {
        planRun: {
          id: "structured-result-run",
          compiledPlanId: compiledPlan.id,
          editablePlanId: compiledPlan.editablePlanId,
          sourceVersion: 1,
          status: "completed",
          nodeStates: {},
          checkpointResponses: [],
          artifactRefs: [],
          attempts: [],
          createdAt: now,
          updatedAt: now,
        },
        mutableGraph: {
          graph: { id: "structured-result-plan", version: 1, nodes: [], edges: [], entryNodeIds: [], mutations: [], createdAt: now, updatedAt: now },
          attempts: [],
          results: [],
          executionContextSnapshots: [],
          planOutput: {
            manifest,
            finalizedResult: { sourceRevision: 1, manifest, spec, finalizedAt: now },
            finalization: { status: "Ready", sourceRevision: 1, attempt: 1, finalizedAt: now },
            revision: 1,
            updatedAt: now,
            updatedByNodeId: null,
          },
        },
      },
    },
  });
  await db.event.create({ data: { workspaceId, taskId: task.id, runId: run.id, planId: plan.planId, eventType: "provider.run_completed", actorType: "runtime", source: "provider", payload: {}, dedupeKey: `provider-completed:${run.id}`, ingestSequence: 1 } });
  await db.event.create({ data: { workspaceId, taskId: task.id, runId: run.id, eventType: "task.result_accepted", actorType: "user", source: "ui", payload: { accepted_run_id: run.id }, dedupeKey: `accepted:${run.id}`, ingestSequence: 2 } });
  return { workspaceId, goal, task, run };
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

  it("automatically syncs accepted finalized results into a reviewable Inbox candidate", async () => {
    const seeded = await seedStructuredGoalResultWithoutArtifacts();

    const accepted = await acceptTaskResult({ taskId: seeded.task.id });

    expect(accepted.runId).toBe(seeded.run.id);
    const candidates = await db.goalInboxCandidate.findMany({
      where: { goalId: seeded.goal.id, sourceRunId: seeded.run.id },
      select: { kind: true, status: true, groupKey: true, content: true },
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: "structured_result",
      status: "Pending",
      groupKey: "structured-result:1",
      content: {
        spec: { root: "workspace" },
      },
    });
    expect(await db.goalAsset.count({ where: { goalId: seeded.goal.id } })).toBe(0);
  });

  it("preserves a structured accepted result as an immutable json-render asset", async () => {
    const seeded = await seedStructuredGoalResultWithoutArtifacts();
    const app = createApiRouter(createChronaEngine());
    const extracted = await post(app, `/goals/${seeded.goal.id}/inbox/extract`, { taskId: seeded.task.id, runId: seeded.run.id });
    expect(extracted.status).toBe(200);
    const { candidates } = await extracted.json() as { candidates: Array<{ id: string; kind: string; content: { format: string; summary: string; spec: unknown } }> };
    expect(candidates[0]).toMatchObject({ kind: "structured_result", content: { format: "chrona-json-render", summary: expect.stringContaining("日照＋临沂沂蒙山"), spec: { root: "workspace" } } });

    const resolved = await post(app, `/goals/${seeded.goal.id}/inbox/${candidates[0]!.id}/resolve`, { workspaceId: seeded.workspaceId, action: "create_asset", label: "Selected destination" });
    expect(resolved.status).toBe(200);
    const version = await db.goalAssetVersion.findFirstOrThrow({ where: { goalId: seeded.goal.id } });
    expect(version.content).toMatchObject({ format: "chrona-json-render", spec: { root: "workspace" } });
    expect((await db.goalAsset.findFirstOrThrow({ where: { goalId: seeded.goal.id } })).kind).toBe("structured_result");

    const planRun = await db.taskPlanRun.findFirstOrThrow({ where: { taskId: seeded.task.id } });
    const stored = planRun.planRun as Record<string, any>;
    stored.mutableGraph.planOutput.manifest.sourceRevision = 2;
    stored.mutableGraph.planOutput.finalizedResult.sourceRevision = 2;
    stored.mutableGraph.planOutput.finalizedResult.manifest.sourceRevision = 2;
    stored.mutableGraph.planOutput.finalizedResult.spec.elements.summary.props.text = "推荐青岛，新的最终结果。";
    await db.taskPlanRun.update({ where: { id: planRun.id }, data: { planRun: stored } });

    const replayed = await post(app, `/goals/${seeded.goal.id}/inbox/extract`, {
      taskId: seeded.task.id,
      runId: seeded.run.id,
    });
    expect(replayed.status).toBe(200);
    expect(await db.goalInboxCandidate.count({
      where: { goalId: seeded.goal.id, sourceRunId: seeded.run.id },
    })).toBe(2);
    expect(await db.goalInboxCandidate.findMany({
      where: { goalId: seeded.goal.id, sourceRunId: seeded.run.id },
      orderBy: { groupKey: "asc" },
      select: { groupKey: true },
    })).toEqual([
      { groupKey: "structured-result:1" },
      { groupKey: "structured-result:2" },
    ]);
  });

  it("registers generated files and persists only opaque structured references", async () => {
    const seeded = await seedStructuredGoalResultWithoutArtifacts();
    const csvPath = path.join(getChronaGeneratedFilesDir(), "tests", seeded.run.id, "destination-shortlist.csv");
    await mkdir(path.dirname(csvPath), { recursive: true });
    await writeFile(csvPath, "candidate,budget\n日照＋临沂沂蒙山,8000\n", "utf8");
    const row = await db.taskPlanRun.findFirstOrThrow({ where: { taskId: seeded.task.id } });
    const stored = row.planRun as Record<string, any>;
    const spec = stored.mutableGraph.planOutput.finalizedResult.spec;
    spec.elements.summary = { type: "FileRef", props: { path: csvPath, title: "destination-shortlist.csv" } };
    stored.mutableGraph.planOutput.finalizedResult.spec = spec;
    const content = await Bun.file(csvPath).arrayBuffer();
    const artifact = await db.artifact.create({
      data: {
        workspaceId: seeded.workspaceId,
        taskId: seeded.task.id,
        runId: seeded.run.id,
        type: "file",
        title: "destination-shortlist.csv",
        uri: `generated://tests/${seeded.run.id}/destination-shortlist.csv`,
        metadata: {
          checksum: createHash("sha256").update(new Uint8Array(content)).digest("hex"),
          size: content.byteLength,
          mimeType: "text/csv",
        },
      },
    });
    await db.taskPlanRun.update({ where: { id: row.id }, data: { planRun: stored } });

    const app = createApiRouter(createChronaEngine());
    const extracted = await post(app, `/goals/${seeded.goal.id}/inbox/extract`, { taskId: seeded.task.id, runId: seeded.run.id });
    expect(extracted.status).toBe(200);
    const { candidates } = await extracted.json() as {
      candidates: Array<{
        id: string;
        kind: string;
        sourceArtifact: { id: string } | null;
        content: { artifactRefs?: Array<{ ref: string }> };
      }>;
    };
    expect(candidates).toHaveLength(2);
    const structured = candidates.find((candidate) => candidate.kind === "structured_result")!;
    const fileCandidate = candidates.find((candidate) => candidate.sourceArtifact?.id === artifact.id)!;
    const serialized = JSON.stringify(structured.content);
    expect(serialized).toContain("GF");
    expect(serialized).not.toContain(csvPath);
    expect(serialized).not.toContain(seeded.task.id);
    expect(artifact.uri).toMatch(/^generated:\/\/tests\//);
    expect(artifact.metadata).toMatchObject({ mimeType: "text/csv", size: expect.any(Number), checksum: expect.any(String) });
    const resolved = await post(app, `/goals/${seeded.goal.id}/inbox/${structured.id}/resolve`, { workspaceId: seeded.workspaceId, action: "create_asset", label: "Selected destination" });
    expect(resolved.status).toBe(200);
    const { assetId, linkedAssets } = await resolved.json() as {
      assetId: string;
      linkedAssets: Array<{ ref: string; assetId: string }>;
    };
    expect(linkedAssets).toHaveLength(1);
    expect(linkedAssets[0]!.ref).toBe(structured.content.artifactRefs![0]!.ref);
    const linkedAsset = await db.goalAsset.findUniqueOrThrow({
      where: { goalId_sourceArtifactId: { goalId: seeded.goal.id, sourceArtifactId: artifact.id } },
      include: { versions: true },
    });
    expect(linkedAsset.id).toBe(linkedAssets[0]!.assetId);
    expect(linkedAsset.kind).toBe("file");
    expect(linkedAsset.versions).toHaveLength(1);
    const assetResponse = await app.request(`/goals/${seeded.goal.id}/assets/${assetId}`);
    expect(assetResponse.status).toBe(200);
    expect(await assetResponse.json()).toMatchObject({
      linkedAssets: [{ ref: structured.content.artifactRefs![0]!.ref, assetId: linkedAsset.id }],
    });
    const version = await db.goalAssetVersion.findFirstOrThrow({ where: { assetId } });
    const download = await app.request(`/goals/${seeded.goal.id}/assets/${assetId}/artifacts/${structured.content.artifactRefs![0]!.ref}/download?versionId=${version.id}`);
    expect(download.status).toBe(200);
    expect(await download.text()).toContain("日照＋临沂沂蒙山");
    await post(app, `/goals/${seeded.goal.id}/inbox/${fileCandidate.id}/resolve`, { workspaceId: seeded.workspaceId, action: "create_asset", label: fileCandidate.sourceArtifact!.id });
    expect(await db.goalAsset.count({ where: { goalId: seeded.goal.id, sourceArtifactId: artifact.id } })).toBe(1);
  });

  it("accepts file-backed tables without persisting task-scoped download links", async () => {
    const seeded = await seedStructuredGoalResultWithoutArtifacts();
    const csvPath = path.join(
      getChronaGeneratedFilesDir(),
      "tests",
      seeded.run.id,
      "channel-table.csv",
    );
    await mkdir(path.dirname(csvPath), { recursive: true });
    await writeFile(csvPath, "channel,url\nChrona,https://chrona.example\n", "utf8");
    const row = await db.taskPlanRun.findFirstOrThrow({
      where: { taskId: seeded.task.id },
    });
    const stored = row.planRun as Record<string, any>;
    stored.mutableGraph.planOutput.finalizedResult.spec.elements.summary = {
      type: "Table",
      props: {
        title: "Updated channels",
        uri: csvPath,
        columns: [
          { key: "channel", label: "Channel" },
          { key: "url", label: "URL", type: "link" },
        ],
      },
    };
    const tableContent = await Bun.file(csvPath).arrayBuffer();
    await db.artifact.create({
      data: {
        workspaceId: seeded.workspaceId,
        taskId: seeded.task.id,
        runId: seeded.run.id,
        type: "file",
        title: "channel-table.csv",
        uri: `generated://tests/${seeded.run.id}/channel-table.csv`,
        metadata: {
          checksum: createHash("sha256").update(new Uint8Array(tableContent)).digest("hex"),
          size: tableContent.byteLength,
          mimeType: "text/csv",
        },
      },
    });
    await db.taskPlanRun.update({
      where: { id: row.id },
      data: { planRun: stored },
    });

    const app = createApiRouter(createChronaEngine());
    const extracted = await post(
      app,
      `/goals/${seeded.goal.id}/inbox/extract`,
      { taskId: seeded.task.id, runId: seeded.run.id },
    );

    expect(extracted.status).toBe(200);
    const { candidates } = (await extracted.json()) as {
      candidates: Array<{
        content: {
          spec: { elements: Record<string, { props: Record<string, unknown> }> };
          artifactRefs: Array<{ ref: string }>;
        };
      }>;
    };
    expect(candidates).not.toHaveLength(0);
    const structuredCandidate = candidates.find(
      (candidate) => candidate.content.artifactRefs.length === 1,
    );
    expect(structuredCandidate).toBeDefined();
    expect(structuredCandidate!.content.spec.elements.summary!.props).toMatchObject({
      path: structuredCandidate!.content.artifactRefs[0]!.ref,
      displayPath: "channel-table.csv",
    });
    expect(
      structuredCandidate!.content.spec.elements.summary!.props,
    ).not.toHaveProperty("downloadHref");
  });

  it("rejects execution controls in structured result assets", async () => {
    const seeded = await seedStructuredGoalResultWithoutArtifacts();
    const row = await db.taskPlanRun.findFirstOrThrow({ where: { taskId: seeded.task.id } });
    const stored = row.planRun as Record<string, any>;
    stored.mutableGraph.planOutput.finalizedResult.spec.elements.summary = { type: "WorkspaceActionCard", props: { title: "Run again", taskId: seeded.task.id }, on: { click: { action: "dispatchExecution" } } };
    await db.taskPlanRun.update({ where: { id: row.id }, data: { planRun: stored } });
    const app = createApiRouter(createChronaEngine());
    const response = await post(app, `/goals/${seeded.goal.id}/inbox/extract`, { taskId: seeded.task.id, runId: seeded.run.id });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("component is not allowed") });
  });

  it("exports structured result assets to Markdown, PDF, and JSON", async () => {
    const seeded = await seedStructuredGoalResultWithoutArtifacts();
    const app = createApiRouter(createChronaEngine());
    const extracted = await post(app, `/goals/${seeded.goal.id}/inbox/extract`, { taskId: seeded.task.id, runId: seeded.run.id });
    const { candidates } = await extracted.json() as { candidates: Array<{ id: string }> };
    const resolved = await post(app, `/goals/${seeded.goal.id}/inbox/${candidates[0]!.id}/resolve`, { workspaceId: seeded.workspaceId, action: "create_asset", label: "Selected destination" });
    const { assetId } = await resolved.json() as { assetId: string };
    const version = await db.goalAssetVersion.findFirstOrThrow({ where: { assetId } });

    for (const format of ["md", "pdf", "json"] as const) {
      const exported = await post(app, `/goals/${seeded.goal.id}/assets/${assetId}/jobs`, { workspaceId: seeded.workspaceId, versionId: version.id, kind: "export", format });
      expect(exported.status).toBe(200);
      expect(await exported.json()).toMatchObject({ status: "Completed", format, outputUri: expect.stringContaining(`.${format}`) });
      const download = await app.request(`/goals/${seeded.goal.id}/assets/${assetId}/download?versionId=${version.id}&mode=export&format=${format}`);
      expect(download.status).toBe(200);
      const body = await download.arrayBuffer();
      expect(body.byteLength).toBeGreaterThan(format === "pdf" ? 1_000 : 40);
      if (format === "md") expect(new TextDecoder().decode(body)).toContain("日照＋临沂沂蒙山");
    }
  }, 15_000);

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

  it("creates bounded metadata-only asset Tasks", async () => {
    const seeded = await seedGoalResult();
    const asset = await db.goalAsset.create({ data: { workspaceId: seeded.workspaceId, goalId: seeded.goal.id, sourceArtifactId: seeded.artifact.id, currentArtifactId: seeded.artifact.id, kind: "document", role: "working_document", status: "Approved", label: "Launch brief" } });
    const version = await db.goalAssetVersion.create({ data: { workspaceId: seeded.workspaceId, goalId: seeded.goal.id, assetId: asset.id, artifactId: seeded.artifact.id, version: 1, source: "inbox", content: "SECRET ASSET BODY", contentHash: "base-v1", authorType: "user" } });
    const app = createApiRouter(createChronaEngine());

    for (const route of ["ai-modification-task", "use-task"]) {
      const body = route === "ai-modification-task"
        ? { workspaceId: seeded.workspaceId, versionId: version.id, instruction: "Clarify the recommendation", expectedOutcome: "A reviewed clearer brief" }
        : { workspaceId: seeded.workspaceId, versionId: version.id, title: "Use launch brief", instruction: "Prepare the next decision", expectedOutcome: "A decision memo" };
      const response = await post(app, `/goals/${seeded.goal.id}/assets/${asset.id}/${route}`, body);
      expect(response.status).toBe(200);
      const { taskId } = await response.json() as { taskId: string };
      const created = await db.task.findUniqueOrThrow({ where: { id: taskId } });
      expect(created.goalId).toBe(seeded.goal.id);
      expect(created.autoExecute).toBe(false);
      expect(created.description).toContain("chrona_goal_results_read");
      expect(created.description).toMatch(/GA[A-F0-9]{12}/);
      expect(created.description).toContain("captured version v1");
      expect(created.description).not.toContain("SECRET ASSET BODY");
      expect(JSON.stringify(created.goalContext)).not.toContain("SECRET ASSET BODY");
      expect(JSON.stringify(created.goalContext)).not.toContain(asset.id);
      expect(JSON.stringify(created.goalContext)).not.toContain(version.id);
    }
  });

  it("records append-only version-specific asset verification", async () => {
    const seeded = await seedGoalResult();
    const asset = await db.goalAsset.create({ data: { workspaceId: seeded.workspaceId, goalId: seeded.goal.id, sourceArtifactId: seeded.artifact.id, currentArtifactId: seeded.artifact.id, kind: "document", role: "reference", status: "Approved", label: "Reference" } });
    const version = await db.goalAssetVersion.create({ data: { workspaceId: seeded.workspaceId, goalId: seeded.goal.id, assetId: asset.id, version: 1, source: "manual", content: "Reference", contentHash: "reference-v1", authorType: "user" } });
    const app = createApiRouter(createChronaEngine());
    const response = await post(app, `/goals/${seeded.goal.id}/assets/${asset.id}/reviews`, { workspaceId: seeded.workspaceId, versionId: version.id, verifiedAt: "2026-07-29T10:00:00.000Z", nextReviewAt: "2026-08-29T10:00:00.000Z", summary: "Checked source links" });
    expect(response.status).toBe(200);
    const review = await response.json() as { assetId: string; versionId: string; summary: string };
    expect(review).toMatchObject({ assetId: asset.id, versionId: version.id, summary: "Checked source links" });
    expect(await db.goalAssetReview.count({ where: { assetId: asset.id } })).toBe(1);
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
