import { beforeEach, describe, expect, it } from "bun:test";
import { db, type Prisma } from "@chrona/db";
import { resetTestDb } from "@chrona/db/test-support";
import type { CompiledPlan, NodeAttempt, NodeResult, PlanOutputState } from "@chrona/contracts/ai";
import { createChronaEngine } from "../../engine";
import { createManagementClient, requireManagementClient } from "./clients";
import { createEmptyPlanOutput, createPlanGraphFromCompiledPlan, getPlanRun, savePlanRun } from "../plan-execution/persistence/plan-run-store";
import { aiArtifactRef } from "../plan-execution/use-cases/register-generated-plan-output-artifacts";
import { appendCanonicalEvent } from "../events";

const engine = createChronaEngine();
const json = (value: unknown) => value as Prisma.InputJsonValue;
const data = (value: unknown) => value as Record<string, any>;
beforeEach(resetTestDb);

async function fixture() {
  const created = await createManagementClient({ name: "result reader", publicUrl: "http://localhost:3101", timezone: "UTC" });
  const identity = await requireManagementClient(created.token);
  const task = await db.task.create({ data: { workspaceId: identity.workspaceId, title: "Trending", status: "Completed", priority: "Medium", executionConfig: {} } });
  const nodeRun = await db.run.create({ data: { taskId: task.id, runtimeName: "test", triggeredBy: "test", status: "Completed" } });
  const report = await db.artifact.create({ data: { workspaceId: identity.workspaceId, taskId: task.id, runId: nodeRun.id, title: "Report", type: "file", uri: "generated://fixture/report.md" } });
  const compiledPlan: CompiledPlan = { id: "compiled_result", editablePlanId: "result_plan", sourceVersion: 1, title: "Trending", goal: "Report", assumptions: [], nodes: [{ id: "node-1", localId: "research", type: "task", title: "Research", config: { expectedOutput: "Report" }, dependencies: [], dependents: [] }], edges: [], entryNodeIds: ["node-1"], terminalNodeIds: ["node-1"], topologicalOrder: ["node-1"], completionPolicy: { type: "all_tasks_completed" }, validationWarnings: [] };
  await db.taskPlan.create({ data: { workspaceId: identity.workspaceId, taskId: task.id, planId: compiledPlan.editablePlanId, revision: 1, status: "Accepted", compiledPlan: json(compiledPlan) } });
  const graph = createPlanGraphFromCompiledPlan({ taskId: task.id, compiledPlan });
  const output: PlanOutputState = createEmptyPlanOutput();
  output.manifest = { ...output.manifest, sourceRevision: 1, outcome: { title: "Complete", summary: "Ten repositories were fetched." }, deliverables: [{ deliverableKey: "report", title: "Report", kind: "document", artifactRef: aiArtifactRef(report.id), status: "current", sourceNodeRef: "N1", placement: "primary", presentation: { primary: "file", allowDownload: true } }] };
  output.finalization = { status: "Running", sourceRevision: 1, attempt: 1, startedAt: new Date().toISOString() };
  const layer = graph.nodes[0]!.layers[0]!.id;
  const attempt: NodeAttempt = { id: "attempt-1", taskId: task.id, graphId: compiledPlan.editablePlanId, nodeId: "node-1", nodeLayerId: layer, executionContextSnapshotId: "snapshot-1", status: "succeeded", idempotencyKey: crypto.randomUUID(), attemptNumber: 1, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() };
  const result: NodeResult = { nodeId: "node-1", nodeLayerId: layer, attemptId: attempt.id, status: "current", outputSummary: "Complete" };
  const save = () => savePlanRun({ workspaceId: identity.workspaceId, taskId: task.id, planId: compiledPlan.editablePlanId, compiledPlan, graph, attempts: [attempt], results: [result], planOutput: output });
  await save();
  const persisted = (await getPlanRun(task.id, compiledPlan.editablePlanId, null))!;
  const canonical = await db.run.upsert({ where: { id: `plan_execution_${persisted.id}` }, create: { id: `plan_execution_${persisted.id}`, taskId: task.id, status: "Completed", triggeredBy: "test", runtimeName: "test", runtimeRunRef: `chrona-plan:${persisted.id}` }, update: { status: "Completed" } });
  const read = async (extra: Record<string, unknown> = {}) => {
    const response = data(await engine.management.call(identity, "chrona_task_read", { taskId: task.id, view: "result", ...extra }));
    expect(response.ok).toBe(true);
    return response.data;
  };
  return { identity, task, nodeRun, report, canonical, persisted, output, save, read };
}

describe("management plan results", () => {
  it("returns node-owned declared artifacts and semantic summary while finalizing, without offering acceptance", async () => {
    const f = await fixture();
    const value = await f.read();
    expect(value.state.state).toBe("finalizing");
    expect(value.availableActions.find((a: any) => a.type === "accept_result")).toMatchObject({ permitted: false, runId: f.canonical.id });
    expect(value.result).toMatchObject({ runId: f.canonical.id, total: 1, summary: "Ten repositories were fetched.", summarySource: "manifest", finalization: { status: "Running", canAccept: false } });
    expect(value.result.artifacts[0]).toMatchObject({ ref: f.report.id, artifactRef: aiArtifactRef(f.report.id) });
    const before = await db.taskPlanRun.findUnique({ where: { id: f.persisted.id } });
    await f.read({ view: "summary" });
    expect(await db.taskPlanRun.findUnique({ where: { id: f.persisted.id } })).toEqual(before);
    const accept = data(await engine.management.call(f.identity, "chrona_task_action", { requestId: crypto.randomUUID(), taskId: f.task.id, action: { type: "accept_result", runId: f.canonical.id } }));
    expect(accept.ok).toBe(false);
    expect(await db.event.count({ where: { eventType: "task.result_accepted" } })).toBe(0);
    f.output.manifest.outcome.summary = "x".repeat(3500);
    await f.save();
    const bounded = await f.read();
    expect(bounded.result.summary.length).toBe(3000);
    expect(bounded.result.summaryTruncated).toBe(true);
  });

  it("reads ResultOverview and offers the same canonical Run that acceptance uses", async () => {
    const f = await fixture();
    const now = new Date().toISOString();
    f.output.finalizedResult = { sourceRevision: 1, manifest: f.output.manifest, finalizedAt: now, spec: { root: "overview", elements: { overview: { type: "ResultOverview", props: { title: "Trending", summary: "Final overview." } } } } };
    f.output.finalization = { status: "Ready", sourceRevision: 1, attempt: 1, finalizedAt: now };
    await f.save();
    const value = await f.read();
    expect(value.state.state).toBe("result_ready");
    expect(value.result).toMatchObject({ summary: "Final overview.", summarySource: "finalized_result", finalization: { canAccept: true } });
    expect(value.availableActions.find((a: any) => a.type === "accept_result")).toMatchObject({ permitted: true, runId: f.canonical.id });
    // Node Runs can be newer than the compatibility plan Run. Acceptance must
    // still use the result identity the management reader just returned.
    await db.run.create({ data: { taskId: f.task.id, runtimeName: "test", triggeredBy: "test", status: "Completed", createdAt: new Date(Date.now() + 1000) } });
    const accept = data(await engine.management.call(f.identity, "chrona_task_action", { requestId: crypto.randomUUID(), taskId: f.task.id, action: { type: "accept_result", runId: f.canonical.id } }));
    expect(accept.ok, JSON.stringify(accept.error)).toBe(true);
    expect(await db.event.findFirst({ where: { eventType: "task.result_accepted" } })).toMatchObject({ runId: f.canonical.id });
  });

  it("keeps accepted-result artifacts pinned to the accepted Run rather than the newest plan", async () => {
    const f = await fixture();
    await appendCanonicalEvent({ workspaceId: f.identity.workspaceId, taskId: f.task.id, runId: f.canonical.id, eventType: "task.result_accepted", actorType: "user", actorId: "test", source: "ui", payload: { accepted_run_id: f.canonical.id } });
    const compiledPlan: CompiledPlan = { id: "compiled_next", editablePlanId: "next_plan", sourceVersion: 2, title: "Next", goal: "Next", assumptions: [], nodes: [], edges: [], entryNodeIds: [], terminalNodeIds: [], topologicalOrder: [], completionPolicy: { type: "all_tasks_completed" }, validationWarnings: [] };
    await db.taskPlan.create({ data: { workspaceId: f.identity.workspaceId, taskId: f.task.id, planId: compiledPlan.editablePlanId, revision: 2, status: "Accepted", compiledPlan: json(compiledPlan) } });
    await savePlanRun({ workspaceId: f.identity.workspaceId, taskId: f.task.id, planId: compiledPlan.editablePlanId, compiledPlan, graph: createPlanGraphFromCompiledPlan({ taskId: f.task.id, compiledPlan }), planOutput: createEmptyPlanOutput() });
    const result = await f.read({ resultSource: "accepted" });
    expect(result.result.runId).toBe(f.canonical.id);
    expect(result.result.accepted).toBe(true);
    expect(result.result.artifacts.map((a: any) => a.ref)).toEqual([f.report.id]);
  });

  it("filters history and foreign task/work-block refs before pagination; deduplicates manifest evidence", async () => {
    const f = await fixture();
    await db.artifact.create({ data: { workspaceId: f.identity.workspaceId, taskId: f.task.id, runId: f.nodeRun.id, title: "Undeclared history", type: "file", uri: "generated://fixture/old.md" } });
    const task = await db.task.create({ data: { workspaceId: f.identity.workspaceId, title: "Foreign", status: "Completed", priority: "Medium", executionConfig: {} } });
    const foreignRun = await db.run.create({ data: { taskId: task.id, status: "Completed", runtimeName: "test", triggeredBy: "test" } });
    const foreign = await db.artifact.create({ data: { workspaceId: f.identity.workspaceId, taskId: task.id, runId: foreignRun.id, title: "Foreign", type: "file", uri: "generated://fixture/foreign.md" } });
    const block = await db.workBlock.create({ data: { taskId: f.task.id, workspaceId: f.identity.workspaceId, title: "Another occurrence", status: "Completed", scheduledStartAt: new Date(), scheduledEndAt: new Date(Date.now() + 3600_000) } });
    const otherRun = await db.run.create({ data: { taskId: f.task.id, workBlockId: block.id, status: "Completed", runtimeName: "test", triggeredBy: "test" } });
    const other = await db.artifact.create({ data: { workspaceId: f.identity.workspaceId, taskId: f.task.id, runId: otherRun.id, title: "Other occurrence", type: "file", uri: "generated://fixture/other.md" } });
    f.output.manifest.evidence = [f.report, foreign, other].map((a, i) => ({ key: `e${i}`, summary: "Evidence", artifactRef: aiArtifactRef(a.id), sourceNodeRef: "N1" }));
    await f.save();
    const first = await f.read({ pageSize: 1 });
    expect(first.result.total).toBe(1);
    expect(first.result.artifacts.map((a: any) => a.ref)).toEqual([f.report.id]);
    const second = await f.read({ page: 2, pageSize: 1 });
    expect(second.result.total).toBe(1);
    expect(second.result.artifacts).toEqual([]);
    await appendCanonicalEvent({ workspaceId: f.identity.workspaceId, taskId: f.task.id, runId: f.canonical.id, eventType: "task.result_accepted", actorType: "user", actorId: "test", source: "ui", payload: { accepted_run_id: f.canonical.id } });
    expect((await f.read({ resultSource: "accepted", workBlockId: block.id })).result).toBeNull();
  });
});
