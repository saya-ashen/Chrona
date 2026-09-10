import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { db } from "@/lib/db";
import type { CompiledPlan, NodeAttempt, NodeResult, PlanOutputState, ResultManifest } from "@chrona/contracts/ai";
import type { getAiClientForTask, runProviderRequest } from "../../ai";
import type { ProviderJsonValue } from "@chrona/providers-foundation";
import { createPlanGraphFromCompiledPlan, getPlanRun, savePlanRun } from "../persistence/plan-run-store";
import { Prisma } from "@/generated/prisma/client";
import { createEmptyPlanOutput } from "../persistence/plan-run-store";
import { __resultFinalizationTestHooks } from "./finalize-task-result";

let dataDir = "";
let workspaceId = "";

const compiledPlan: CompiledPlan = {
  id: "compiled_result_recovery",
  editablePlanId: "plan_result_recovery",
  sourceVersion: 1,
  title: "Recover result",
  goal: "Recover canonical result content",
  assumptions: [],
  nodes: [{
    id: "node-1",
    localId: "research",
    type: "task",
    title: "Research",
    config: { expectedOutput: "Report" },
    dependencies: [],
    dependents: [],
  }],
  edges: [],
  entryNodeIds: ["node-1"],
  terminalNodeIds: ["node-1"],
  topologicalOrder: ["node-1"],
  completionPolicy: { type: "all_tasks_completed" },
  validationWarnings: [],
};

async function seedRecoveryFixture() {
  const workspace = await db.workspace.create({
    data: { name: `Result recovery ${crypto.randomUUID()}`, status: "Active" },
  });
  workspaceId = workspace.id;
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Recover semantic result",
      priority: "Medium",
      executionConfig: {},
      status: "Completed",
    },
  });
  const run = await db.run.create({
    data: {
      taskId: task.id,
      runtimeName: "test",
      status: "Completed",
      triggeredBy: "system",
    },
  });
  await mkdir(join(dataDir, "generated", run.id), { recursive: true });
  await writeFile(join(dataDir, "generated", run.id, "report.md"), "# Recovered report\n");
  const taskPlan = await db.taskPlan.create({
    data: {
      workspaceId: workspace.id,
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      revision: 1,
      status: "Accepted",
      compiledPlan: compiledPlan as unknown as Prisma.InputJsonValue,
    },
  });
  const graph = createPlanGraphFromCompiledPlan({ taskId: task.id, compiledPlan });
  const nodeLayerId = graph.nodes[0]!.layers[0]!.id;
  const attempt: NodeAttempt = {
    id: `attempt-${crypto.randomUUID()}`,
    taskId: task.id,
    graphId: compiledPlan.editablePlanId,
    nodeId: "node-1",
    nodeLayerId,
    executionContextSnapshotId: "snapshot-1",
    status: "succeeded",
    idempotencyKey: `result-recovery-${crypto.randomUUID()}`,
    attemptNumber: 1,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
  const result: NodeResult = {
    nodeId: "node-1",
    nodeLayerId,
    attemptId: attempt.id,
    status: "current",
    outputSummary: "Summary only",
  };
  await savePlanRun({
    workspaceId: workspace.id,
    taskId: task.id,
    planId: compiledPlan.editablePlanId,
    compiledPlan,
    graph,
    attempts: [attempt],
    results: [result],
    planOutput: createEmptyPlanOutput(),
  });
  const planRun = await db.taskPlanRun.findFirstOrThrow({
    where: { taskId: task.id, planId: compiledPlan.editablePlanId },
  });
  await db.taskPlanNodeAttempt.create({
    data: {
      id: attempt.id,
      workspaceId: workspace.id,
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      planRunId: planRun.id,
      nodeId: "node-1",
      nodeLayerId,
      idempotencyKey: attempt.idempotencyKey,
      attemptNumber: 1,
      status: "succeeded",
      executionEpoch: 0,
    },
  });
  await db.taskPlanTerminalAction.create({
    data: {
      workspaceId: workspace.id,
      taskId: task.id,
      runId: run.id,
      runtimeSessionKey: "result-recovery-session",
      nodeId: "node-1",
      nodeAttemptId: attempt.id,
      kind: "complete",
      payload: {
        summary: "Full result",
        deliverables: [{
          deliverableKey: "report",
          title: "Recovered report",
          kind: "document",
          source: { type: "generated_file", uri: `generated://${run.id}/report.md` },
        }],
        findings: [{ key: "finding", content: "Recovered finding" }],
        decisions: [{ key: "decision", content: "Recovered decision" }],
        caveats: [{ key: "caveat", content: "Recovered caveat" }],
        nextActions: [{ key: "next", content: "Recovered next action" }],
        evidenceItems: [{ key: "evidence", summary: "Recovered evidence" }],
      },
    },
  });
  const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId, null);
  if (!persisted) throw new Error("Expected persisted plan run");
  const accepted = {
    recordId: taskPlan.id,
    workspaceId: workspace.id,
    taskId: task.id,
    workBlockId: null,
    compiledPlan,
    editablePlan: null,
    status: "accepted" as const,
    prompt: null,
    summary: null,
    generatedBy: "test",
    changeSummary: null,
    createdAt: taskPlan.createdAt.toISOString(),
    updatedAt: taskPlan.updatedAt.toISOString(),
  };
  return { task, run, accepted, persisted };
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "chrona-result-recovery-"));
  process.env.CHRONA_DATA_DIR = dataDir;
  await mkdir(join(dataDir, "generated"), { recursive: true });
});

afterEach(async () => {
  if (workspaceId) {
    await db.artifact.deleteMany({ where: { workspaceId } });
    await db.taskPlanTerminalAction.deleteMany({ where: { workspaceId } });
    await db.taskPlanNodeAttempt.deleteMany({ where: { workspaceId } });
    await db.taskPlanRun.deleteMany({ where: { workspaceId } });
    await db.taskPlan.deleteMany({ where: { workspaceId } });
    await db.run.deleteMany({ where: { task: { workspaceId } } });
    await db.task.deleteMany({ where: { workspaceId } });
    await db.workspace.delete({ where: { id: workspaceId } });
    workspaceId = "";
  }
  delete process.env.CHRONA_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

function composedSpec(manifest: ResultManifest, summary = "Composed report") {
  return { root: "root", elements: {
    root: { type: "Stack", props: { gap: "md" }, children: ["overview", "readiness", "report"] },
    overview: { type: "ResultOverview", props: { title: "Report", summary } },
    readiness: { type: "ResultReadiness", props: { status: manifest.readiness.status, summary: manifest.readiness.summary } },
    report: { type: "ResultDeliverable", props: { title: "Report", artifactRef: manifest.deliverables[0]!.artifactRef, kind: "document", role: "primary", sourceKeys: ["report"] } },
  } };
}
function dependencies(request: typeof runProviderRequest) {
  return {
    getClient: async () => ({ providerClient: {} } as Awaited<ReturnType<typeof getAiClientForTask>>),
    request, composeTimeoutMs: 500, reviewTimeoutMs: 200,
  };
}

describe("bounded result publication", () => {
  it.each(["success", "error", "invalid", "hang", "late"])("persists candidate before review and publishes safely on %s", async (mode) => {
    const fixture = await seedRecoveryFixture();
    let calls = 0;
    let reviewSignal: AbortSignal | undefined;
    let candidateAtReview: PlanOutputState | undefined;
    let finishLate: (() => void) | undefined;
    const deps = dependencies(async (_client, request) => {
      calls++;
      const manifest = (request.input as unknown as { manifest: ResultManifest }).manifest;
      if (calls === 1) return { provider: "pi", runId: "compose", status: "completed", structuredPayload: { parsed: composedSpec(manifest) } };
      const persisted = (await getPlanRun(fixture.task.id, compiledPlan.editablePlanId, null))!;
      candidateAtReview = persisted.planOutput;
      reviewSignal = request.signal;
      if (mode === "hang") return new Promise(() => {}); // deliberately ignores AbortSignal
      if (mode === "late") return new Promise<Awaited<ReturnType<typeof runProviderRequest>>>((resolve) => {
        finishLate = () => resolve({ provider: "pi", runId: "late", status: "completed", structuredPayload: { parsed: composedSpec(manifest, "Late review must not publish") } });
      });
      if (mode === "error") throw new Error("review unavailable");
      return { provider: "pi", runId: "review", status: "completed", structuredPayload: { parsed: mode === "invalid" ? {} : composedSpec(manifest, "Reviewed report") } };
    });
    const result = await __resultFinalizationTestHooks.finalize({ taskId: fixture.task.id }, deps);
    expect(calls).toBe(2);
    expect(candidateAtReview?.finalization).toMatchObject({ status: "Running", phase: "review" });
    expect(candidateAtReview?.finalizedResult?.spec).toEqual(composedSpec(result.manifest));
    expect(result.finalization.status).toBe("Ready");
    expect(candidateAtReview?.finalizedResult?.review).toEqual({ status: "pending" });
    expect(result.finalizedResult?.review).toMatchObject(mode === "success"
      ? { status: "completed" }
      : { status: "fallback", reason: mode === "invalid" ? "invalid_output" : mode === "hang" || mode === "late" ? "timeout" : "provider_error" });
    expect(result.finalizedResult?.spec.elements.overview?.props.summary).toBe(mode === "success" ? "Reviewed report" : "Composed report");
    expect((await getPlanRun(fixture.task.id, compiledPlan.editablePlanId, null))?.planOutput).toEqual(result);
    if (mode === "hang" || mode === "late") expect(reviewSignal?.aborted).toBe(true);
    finishLate?.();
    await Promise.resolve();
    expect((await getPlanRun(fixture.task.id, compiledPlan.editablePlanId, null))?.planOutput).toEqual(result);
  });

  it("records failure when compose never settles, without an unbounded cleanup wait", async () => {
    const fixture = await seedRecoveryFixture();
    let signal: AbortSignal | undefined;
    await expect(__resultFinalizationTestHooks.finalize({ taskId: fixture.task.id }, dependencies(async (_client, request) => {
      signal = request.signal;
      return new Promise(() => {});
    }))).rejects.toThrow("timed out");
    const persisted = (await getPlanRun(fixture.task.id, compiledPlan.editablePlanId, null))!;
    expect(signal?.aborted).toBe(true);
    expect(persisted.planOutput.finalization.status).toBe("Failed");
    expect(persisted.planOutput.finalizedResult).toBeNull();
  });

  it("reuses a persisted candidate after interrupted review, without re-composing or executing nodes", async () => {
    const fixture = await seedRecoveryFixture();
    const restored = await __resultFinalizationTestHooks.restoreRecordedTerminalResults({ taskId: fixture.task.id, accepted: fixture.accepted, persisted: fixture.persisted });
    const manifest = restored.planOutput.manifest;
    const spec = __resultFinalizationTestHooks.validateFinalizedSpec({ manifest, payload: composedSpec(manifest) as ProviderJsonValue });
    const now = new Date().toISOString();
    await savePlanRun({ workspaceId, taskId: fixture.task.id, planId: compiledPlan.editablePlanId, compiledPlan,
      run: restored.planRun, graph: restored.graph!, attempts: restored.attempts, results: restored.results,
      planOutput: { ...restored.planOutput, finalization: { status: "Running", sourceRevision: manifest.sourceRevision, attempt: 1, startedAt: now },
        finalizedResult: { manifest, sourceRevision: manifest.sourceRevision, spec, finalizedAt: now } } });
    let calls = 0;
    const result = await __resultFinalizationTestHooks.finalize({ taskId: fixture.task.id, force: true }, dependencies(async (_client, request) => {
      calls++;
      expect(request.clientOperationId).toContain(":review:");
      throw new Error("review unavailable");
    }));
    expect(calls).toBe(1);
    expect(result.finalization.status).toBe("Ready");
    expect(result.finalizedResult?.spec).toEqual(spec);
    expect(await db.taskPlanNodeAttempt.count({ where: { taskId: fixture.task.id } })).toBe(1);
  });

  it("does not overwrite a newer epoch when review completes late", async () => {
    const fixture = await seedRecoveryFixture();
    let calls = 0;
    const newerSummary = "A newer execution owns this result";
    const deps = dependencies(async (_client, request) => {
      const manifest = (request.input as unknown as { manifest: ResultManifest }).manifest;
      if (++calls === 2) {
        const current = (await getPlanRun(fixture.task.id, compiledPlan.editablePlanId, null))!;
        await savePlanRun({ workspaceId, taskId: fixture.task.id, planId: compiledPlan.editablePlanId, compiledPlan,
          run: current.planRun, graph: current.graph!, attempts: current.attempts, results: current.results,
          planOutput: { ...current.planOutput, manifest: { ...current.planOutput.manifest, sourceRevision: manifest.sourceRevision + 1, outcome: { title: "New result", summary: newerSummary } }, finalizedResult: null, finalization: { status: "Pending", sourceRevision: manifest.sourceRevision + 1 } } });
      }
      return { provider: "pi", runId: "fixture", status: "completed", structuredPayload: { parsed: composedSpec(manifest) } };
    });
    await expect(__resultFinalizationTestHooks.finalize({ taskId: fixture.task.id }, deps)).rejects.toThrow("changed");
    const latest = (await getPlanRun(fixture.task.id, compiledPlan.editablePlanId, null))!;
    expect(latest.planOutput.manifest.outcome.summary).toBe(newerSummary);
    expect(latest.planOutput.finalizedResult).toBeNull();
  });
});

describe("recorded terminal result recovery", () => {
  it("restores semantic fields and a completed Run-owned Artifact idempotently", async () => {
    const fixture = await seedRecoveryFixture();

    const first = await __resultFinalizationTestHooks.restoreRecordedTerminalResults({
      taskId: fixture.task.id,
      accepted: fixture.accepted,
      persisted: fixture.persisted,
    });
    const replay = await __resultFinalizationTestHooks.restoreRecordedTerminalResults({
      taskId: fixture.task.id,
      accepted: fixture.accepted,
      persisted: first,
    });
    const artifacts = await db.artifact.findMany({ where: { taskId: fixture.task.id } });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.runId).toBe(fixture.run.id);
    expect(first.results[0]).toMatchObject({
      outputSummary: "Full result",
      findings: [{ key: "finding", content: "Recovered finding" }],
      decisions: [{ key: "decision", content: "Recovered decision" }],
      caveats: [{ key: "caveat", content: "Recovered caveat" }],
      nextActions: [{ key: "next", content: "Recovered next action" }],
      resultEvidence: [{ key: "evidence", summary: "Recovered evidence", sourceNodeRef: expect.any(String) }],
    });
    expect(first.results[0]!.deliverables).toHaveLength(1);
    expect(first.planOutput.manifest).toMatchObject({
      sourceRevision: 1,
      findings: [{ key: "finding", content: "Recovered finding", sourceNodeRef: expect.any(String) }],
      evidence: [{ key: "evidence", summary: "Recovered evidence", sourceNodeRef: expect.any(String) }],
    });
    expect(replay.planOutput).toEqual(first.planOutput);
    expect(await db.artifact.count({ where: { taskId: fixture.task.id } })).toBe(1);
  });
});
