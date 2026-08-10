import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { db } from "@/lib/db";
import type { CompiledPlan, NodeAttempt, NodeResult } from "@chrona/contracts/ai";
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
    data: { name: `Result recovery ${crypto.randomUUID()}`, status: "Active", defaultRuntime: "test" },
  });
  workspaceId = workspace.id;
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Recover semantic result",
      priority: "Medium",
      executionRuntime: "test",
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
