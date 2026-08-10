import { describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getChronaGeneratedFilesDir } from "@chrona/shared/data-paths";
import { db } from "@/lib/db";
import { ENGINE_ERROR_CODES } from "../../../errors";
import { claimPlanRunCommand, completePlanRunCommandReceipt, getPlanRun, renewPlanRunCommandReceipt } from "../persistence/plan-run-store";
import { ensureNativePlanRun } from "../persistence/plan-runtime-store";
import { executeTaskNodeCapabilityMock, makeSingleTaskPlan, makeTwoTaskPlan, seedAcceptedCompiledPlan, seedWorkspaceAndTask, setupPlanRunnerTaskExecutorTest } from "../plan-runner.task-executor.fixtures";
import { executeCommand } from "./execute-command";
import { EXECUTION_COMMAND_CANONICALIZER, EXECUTION_COMMAND_CANONICALIZER_VERSION, executionCommandDigest } from "./command-receipts";
import { runtimeSyncIdempotencyKey } from "./sync-runtime-result";


type ReceiptRow = {
  status: string;
  commandDigest: string;
  claimVersion: number;
  leaseOwnerId: string | null;
  result: unknown;
};

async function readReceipt(planRunId: string, commandKey: string): Promise<ReceiptRow> {
  const rows = await db.$queryRaw<ReceiptRow[]>`
    SELECT "status", "commandDigest", "claimVersion", "leaseOwnerId", "result"
    FROM "TaskPlanCommandReceipt"
    WHERE "planRunId" = ${planRunId} AND "commandKey" = ${commandKey}
    LIMIT 1
  `;
  const receipt = rows[0];
  if (!receipt) throw new Error(`Expected receipt ${commandKey}`);
  return {
    ...receipt,
    result: typeof receipt.result === "string" ? JSON.parse(receipt.result) : receipt.result,
  };
}

async function ensurePersistedPlanRun(taskId: string) {
  const runtime = await ensureNativePlanRun(taskId, null, { resolveScope: true });
  if (!runtime) throw new Error("Expected runtime");
  return runtime.persisted;
}

describe("kernel command receipts focused races", () => {
  setupPlanRunnerTaskExecutorTest();

  it("replays an A command after an A to B to A original snapshot", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValue({
      status: "started",
      summary: "started",
      evidence: { sessionId: "main-session", runId: "run-receipt-aba" },
      output: { runtimeRunRef: "runtime-receipt-aba" },
    });
    const { workspace, task } = await seedWorkspaceAndTask("Receipt ABA");
    const compiledPlan = makeTwoTaskPlan("graph_receipt_aba");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await executeCommand({ taskId: task.id, command: { type: "start", trigger: "manual" }, context: { idempotencyKey: "aba-bootstrap" } });
    await executeCommand({ taskId: task.id, command: { type: "restart_from_beginning", trigger: "manual" }, context: { idempotencyKey: "aba-a" } });
    await executeCommand({ taskId: task.id, command: { type: "restart_from_beginning", trigger: "manual" }, context: { idempotencyKey: "aba-b" } });
    const before = await getPlanRun(task.id, compiledPlan.editablePlanId);
    await executeCommand({ taskId: task.id, command: { type: "restart_from_beginning", trigger: "manual" }, context: { idempotencyKey: "aba-a" } });

    const after = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(after?.executionEpoch).toBe(before?.executionEpoch);
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(3);
  });

  it("rejects same-key commands with different digest, canonicalizer, or version", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValue({
      status: "started",
      summary: "started",
      evidence: { sessionId: "main-session", runId: "run-receipt-conflict" },
      output: { runtimeRunRef: "runtime-receipt-conflict" },
    });
    const { workspace, task } = await seedWorkspaceAndTask("Receipt digest conflict");
    const compiledPlan = makeTwoTaskPlan("graph_receipt_conflict");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);
    await executeCommand({ taskId: task.id, command: { type: "start", trigger: "manual" }, context: { idempotencyKey: "conflict-bootstrap" } });
    const runtime = await getPlanRun(task.id, compiledPlan.editablePlanId);
    if (!runtime) throw new Error("Expected runtime");
    const digest = executionCommandDigest({
      command: { type: "restart_from_beginning", trigger: "manual" },
      context: { idempotencyKey: "same-key" },
    });
    await db.taskPlanCommandReceipt.createMany({
      data: [
        {
          planRunId: runtime.id,
          commandKey: "same-key-digest",
          commandDigest: "different-digest",
          canonicalizer: EXECUTION_COMMAND_CANONICALIZER,
          canonicalizerVersion: EXECUTION_COMMAND_CANONICALIZER_VERSION,
          status: "claimed",
          executionEpoch: runtime.executionEpoch,
        },
        {
          planRunId: runtime.id,
          commandKey: "same-key-version",
          commandDigest: digest,
          canonicalizer: EXECUTION_COMMAND_CANONICALIZER,
          canonicalizerVersion: EXECUTION_COMMAND_CANONICALIZER_VERSION + 1,
          status: "claimed",
          executionEpoch: runtime.executionEpoch,
        },
        {
          planRunId: runtime.id,
          commandKey: "same-key-canonicalizer",
          commandDigest: digest,
          canonicalizer: `${EXECUTION_COMMAND_CANONICALIZER}.old`,
          canonicalizerVersion: EXECUTION_COMMAND_CANONICALIZER_VERSION,
          status: "claimed",
          executionEpoch: runtime.executionEpoch,
        },
      ],
    });

    await expect(claimPlanRunCommand({
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      expectedEpoch: runtime.executionEpoch,
      commandKey: "same-key-digest",
      commandDigest: digest,
    })).rejects.toMatchObject({ code: ENGINE_ERROR_CODES.CONFLICT });
    await expect(claimPlanRunCommand({
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      expectedEpoch: runtime.executionEpoch,
      commandKey: "same-key-version",
      commandDigest: digest,
    })).rejects.toMatchObject({ code: ENGINE_ERROR_CODES.CONFLICT });
    await expect(claimPlanRunCommand({
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      expectedEpoch: runtime.executionEpoch,
      commandKey: "same-key-canonicalizer",
      commandDigest: digest,
    })).rejects.toMatchObject({ code: ENGINE_ERROR_CODES.CONFLICT });
  });

  it("keeps same-key concurrent claims to a single durable receipt", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValue({
      status: "started",
      summary: "started",
      evidence: { sessionId: "main-session", runId: "run-receipt-concurrent" },
      output: { runtimeRunRef: "runtime-receipt-concurrent" },
    });
    const { workspace, task } = await seedWorkspaceAndTask("Receipt concurrent");
    const compiledPlan = makeTwoTaskPlan("graph_receipt_concurrent");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);
    await executeCommand({ taskId: task.id, command: { type: "start", trigger: "manual" }, context: { idempotencyKey: "concurrent-bootstrap" } });
    const runtime = await getPlanRun(task.id, compiledPlan.editablePlanId);
    if (!runtime) throw new Error("Expected runtime");

    const [first, second] = await Promise.all([
      claimPlanRunCommand({ taskId: task.id, planId: compiledPlan.editablePlanId, expectedEpoch: runtime.executionEpoch, commandKey: "once", commandDigest: "digest-once" }),
      claimPlanRunCommand({ taskId: task.id, planId: compiledPlan.editablePlanId, expectedEpoch: runtime.executionEpoch, commandKey: "once", commandDigest: "digest-once" }),
    ]);

    expect([first?.status, second?.status].sort()).toEqual(["claimed", "in_flight"]);
    expect(await db.taskPlanCommandReceipt.count({ where: { planRunId: runtime.id, commandKey: "once" } })).toBe(1);
  });

  it("allows only the first exact completed receipt claim to commit", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValue({
      status: "started",
      summary: "started",
      evidence: { sessionId: "main-session", runId: "run-receipt-first-writer" },
      output: { runtimeRunRef: "runtime-receipt-first-writer" },
    });
    const { workspace, task } = await seedWorkspaceAndTask("Receipt first writer");
    const compiledPlan = makeSingleTaskPlan("graph_receipt_first_writer");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);
    await executeCommand({ taskId: task.id, command: { type: "start", trigger: "manual" }, context: { idempotencyKey: "first-writer-bootstrap" } });
    const runtime = await getPlanRun(task.id, compiledPlan.editablePlanId);
    if (!runtime) throw new Error("Expected runtime");
    const claimed = await claimPlanRunCommand({
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      expectedEpoch: runtime.executionEpoch,
      commandKey: "first-writer",
      commandDigest: "first-writer-digest",
    });
    if (!claimed || claimed.status !== "claimed") throw new Error("Expected claim");
    const result = await executeCommand({ taskId: task.id, command: { type: "start", trigger: "manual" }, context: { idempotencyKey: "first-writer-current-state" } });

    expect(await completePlanRunCommandReceipt({
      planRunId: claimed.planRunId,
      commandKey: claimed.commandKey,
      commandDigest: claimed.commandDigest,
      canonicalizer: claimed.canonicalizer,
      canonicalizerVersion: claimed.canonicalizerVersion,
      claimedEpoch: claimed.claimedEpoch,
      leaseOwnerId: claimed.leaseOwnerId,
      claimVersion: claimed.claimVersion,
      result,
    })).toBe(true);
    expect(await completePlanRunCommandReceipt({
      planRunId: claimed.planRunId,
      commandKey: claimed.commandKey,
      commandDigest: claimed.commandDigest,
      canonicalizer: claimed.canonicalizer,
      canonicalizerVersion: claimed.canonicalizerVersion,
      claimedEpoch: claimed.claimedEpoch,
      leaseOwnerId: claimed.leaseOwnerId,
      claimVersion: claimed.claimVersion,
      result,
    })).toBe(false);
  });

  it("does not cache a CAS-lost current-state fallback as the command receipt", async () => {
    let taskId = "";
    let planId = "";
    executeTaskNodeCapabilityMock.mockImplementation(async () => {
      queueMicrotask(async () => {
        const runtime = await getPlanRun(taskId, planId);
        if (!runtime) return;
        await claimPlanRunCommand({
          taskId,
          planId,
          expectedEpoch: runtime.executionEpoch,
          commandKey: "cas-lost-winner",
          commandDigest: "cas-lost-winner-digest",
        });
      });
      return {
        status: "done",
        summary: "done after lost CAS",
        evidence: { sessionId: "main-session", runId: "run-cas-lost" },
      };
    });
    const { workspace, task } = await seedWorkspaceAndTask("Receipt CAS lost fallback");
    const compiledPlan = makeSingleTaskPlan("graph_receipt_cas_lost");
    taskId = task.id;
    planId = compiledPlan.editablePlanId;
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await executeCommand({ taskId: task.id, command: { type: "start", trigger: "manual" }, context: { idempotencyKey: "cas-lost-start" } });
    const runtime = await getPlanRun(task.id, compiledPlan.editablePlanId);
    if (!runtime) throw new Error("Expected runtime");

    expect(await readReceipt(runtime.id, "cas-lost-start")).toMatchObject({ status: "claimed", result: null });
  });

  it("reclaims a crash-before-side-effect stale claim without duplicating side effects", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValue({
      status: "done",
      summary: "done after stale reclaim",
      evidence: { sessionId: "main-session", runId: "run-receipt-stale-before" },
    });
    const { workspace, task } = await seedWorkspaceAndTask("Receipt stale before side effect");
    const compiledPlan = makeSingleTaskPlan("graph_receipt_stale_before");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);
    const runtime = await ensurePersistedPlanRun(task.id);
    const digest = executionCommandDigest({ command: { type: "start", trigger: "manual" }, context: { idempotencyKey: "stale-before" } });
    const stale = await claimPlanRunCommand({
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      expectedEpoch: runtime.executionEpoch,
      commandKey: "stale-before",
      commandDigest: digest,
      leaseOwnerId: "owner-old",
      leaseDurationMs: -1,
    });
    if (!stale || stale.status !== "claimed") throw new Error("Expected stale claim");

    const reclaimed = await executeCommand({ taskId: task.id, command: { type: "start", trigger: "manual" }, context: { idempotencyKey: "stale-before" } });
    const receipt = await readReceipt(runtime.id, "stale-before");

    expect(reclaimed.status).toBe("completed");
    expect(receipt).toMatchObject({ status: "completed", commandDigest: digest, claimVersion: stale.claimVersion + 1 });
    expect(receipt.leaseOwnerId).not.toBe("owner-old");
    expect(receipt.result).toEqual(reclaimed);
    expect(await db.taskPlanNodeAttempt.count({ where: { planRunId: runtime.id } })).toBe(1);
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);
  });

  it("replays original response after outcome and receipt commit", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValue({
      status: "done",
      summary: "done before replay",
      evidence: { sessionId: "main-session", runId: "run-receipt-after-outcome" },
    });
    const { workspace, task } = await seedWorkspaceAndTask("Receipt after outcome");
    const compiledPlan = makeSingleTaskPlan("graph_receipt_after_outcome");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const first = await executeCommand({ taskId: task.id, command: { type: "start", trigger: "manual" }, context: { idempotencyKey: "after-outcome" } });
    const second = await executeCommand({ taskId: task.id, command: { type: "start", trigger: "manual" }, context: { idempotencyKey: "after-outcome" } });
    const runtime = await getPlanRun(task.id, compiledPlan.editablePlanId);
    if (!runtime) throw new Error("Expected runtime");
    const receipt = await readReceipt(runtime.id, "after-outcome");

    expect(second).toEqual(first);
    expect(receipt).toMatchObject({ status: "completed" });
    expect(receipt.result).toEqual(first);
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);
  });

  it("allows only one concurrent stale reclaimer to own the exact claim version", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Receipt concurrent stale reclaim");
    const compiledPlan = makeSingleTaskPlan("graph_receipt_concurrent_reclaim");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);
    const runtime = await ensurePersistedPlanRun(task.id);
    const digest = executionCommandDigest({ command: { type: "start", trigger: "manual" }, context: { idempotencyKey: "reclaim-race" } });
    const stale = await claimPlanRunCommand({
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      expectedEpoch: runtime.executionEpoch,
      commandKey: "reclaim-race",
      commandDigest: digest,
      leaseOwnerId: "race-old",
      leaseDurationMs: -1,
    });
    if (!stale || stale.status !== "claimed") throw new Error("Expected stale claim");

    const [first, second] = await Promise.all([
      claimPlanRunCommand({ taskId: task.id, planId: compiledPlan.editablePlanId, expectedEpoch: runtime.executionEpoch, commandKey: "reclaim-race", commandDigest: digest, leaseOwnerId: "race-a" }),
      claimPlanRunCommand({ taskId: task.id, planId: compiledPlan.editablePlanId, expectedEpoch: runtime.executionEpoch, commandKey: "reclaim-race", commandDigest: digest, leaseOwnerId: "race-b" }),
    ]);
    const statuses = [first?.status, second?.status].sort();
    const owner = first?.status === "claimed" ? first : second?.status === "claimed" ? second : null;
    if (!owner || owner.status !== "claimed") throw new Error("Expected one reclaimed owner");
    const receipt = await readReceipt(runtime.id, "reclaim-race");

    expect(statuses).toEqual(["claimed", "in_flight"]);
    expect(owner?.claimVersion).toBe(stale.claimVersion + 1);
    expect(receipt.claimVersion).toBe(stale.claimVersion + 1);
    expect(receipt.leaseOwnerId).toBe(owner.leaseOwnerId);
  });

  it("renews an exact expired receipt claim and rejects the stale owner after reclaim", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Receipt lease renewal");
    const compiledPlan = makeSingleTaskPlan("graph_receipt_renewal");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);
    const runtime = await ensurePersistedPlanRun(task.id);
    expect(runtime).not.toBeNull();
    const commandKey = "claim-renewal";
    const commandDigest = executionCommandDigest({ command: { type: "start", trigger: "manual" }, context: { idempotencyKey: commandKey } });
    const claimed = await claimPlanRunCommand({
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      expectedEpoch: runtime!.executionEpoch,
      commandKey,
      commandDigest,
      leaseOwnerId: "owner-a",
      leaseDurationMs: -1,
    });
    expect(claimed?.status).toBe("claimed");
    if (!claimed || claimed.status !== "claimed") throw new Error("Expected the command receipt to be claimed");

    await expect(renewPlanRunCommandReceipt(claimed, 60_000)).resolves.toBe(true);
    await expect(claimPlanRunCommand({
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      expectedEpoch: runtime!.executionEpoch,
      commandKey,
      commandDigest,
      leaseOwnerId: "owner-b",
    })).resolves.toMatchObject({ status: "in_flight" });

    await db.$executeRaw`
      UPDATE "TaskPlanCommandReceipt"
      SET "leaseOwnerId" = ${"owner-b"}, "claimVersion" = ${claimed.claimVersion + 1}
      WHERE "planRunId" = ${claimed.planRunId} AND "commandKey" = ${commandKey}
    `;
    await expect(renewPlanRunCommandReceipt(claimed, 60_000)).resolves.toBe(false);
  });

  it("uses lease owner and claim version to block A-B-A stale completion", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Receipt claim ABA");
    const compiledPlan = makeSingleTaskPlan("graph_receipt_claim_aba");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);
    const runtime = await ensurePersistedPlanRun(task.id);
    const digest = executionCommandDigest({ command: { type: "start", trigger: "manual" }, context: { idempotencyKey: "claim-aba" } });
    const old = await claimPlanRunCommand({
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      expectedEpoch: runtime.executionEpoch,
      commandKey: "claim-aba",
      commandDigest: digest,
      leaseOwnerId: "owner-a",
      leaseDurationMs: -1,
    });
    if (!old || old.status !== "claimed") throw new Error("Expected old claim");
    const replacement = await claimPlanRunCommand({
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      expectedEpoch: runtime.executionEpoch,
      commandKey: "claim-aba",
      commandDigest: digest,
      leaseOwnerId: "owner-b",
    });
    if (!replacement || replacement.status !== "claimed") throw new Error("Expected replacement claim");
    await db.$executeRaw`
      UPDATE "TaskPlanCommandReceipt" SET "leaseOwnerId" = ${"owner-a"}
      WHERE "planRunId" = ${runtime.id} AND "commandKey" = ${"claim-aba"}
    `;
    const result = {
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      mainSessionId: "main-session",
      status: "started" as const,
      currentNodeId: null,
      executedNodeIds: [],
      waitingNodeIds: [],
      blockedNodeIds: [],
      checkpoint: null,
      message: "old stale result",
    };

    expect(await completePlanRunCommandReceipt({
      planRunId: old.planRunId,
      commandKey: old.commandKey,
      commandDigest: old.commandDigest,
      canonicalizer: old.canonicalizer,
      canonicalizerVersion: old.canonicalizerVersion,
      claimedEpoch: old.claimedEpoch,
      leaseOwnerId: old.leaseOwnerId,
      claimVersion: old.claimVersion,
      result,
    })).toBe(false);
    expect(await completePlanRunCommandReceipt({
      planRunId: replacement.planRunId,
      commandKey: replacement.commandKey,
      commandDigest: replacement.commandDigest,
      canonicalizer: replacement.canonicalizer,
      canonicalizerVersion: replacement.canonicalizerVersion,
      claimedEpoch: replacement.claimedEpoch,
      leaseOwnerId: "owner-a",
      claimVersion: replacement.claimVersion,
      result,
    })).toBe(true);
  });

  it("builds stable runtime sync keys from exact durable and terminal identity", () => {
    const input = {
      taskId: "task-1",
      runtimeRunRef: " runtime-canonical ",
      expectedAttemptId: "attempt-1",
      providerRunId: "provider-1",
      status: "Completed" as const,
      summary: "done",
      output: { b: 2, a: 1 },
    };
    const first = runtimeSyncIdempotencyKey(input, { planRunId: "plan-run-1", workBlockId: null, expectedAttemptId: "attempt-1", providerRunId: "provider-1" });
    const second = runtimeSyncIdempotencyKey(input, { planRunId: "plan-run-1", workBlockId: null, expectedAttemptId: "attempt-1", providerRunId: "provider-1" });
    const changed = runtimeSyncIdempotencyKey({ ...input, status: "Failed" as const, error: "boom", output: undefined }, { planRunId: "plan-run-1", workBlockId: null, expectedAttemptId: "attempt-1", providerRunId: "provider-1" });

    expect(first).toBe(second);
    expect(first).not.toBe(changed);
  });

  async function runningProviderAttempt(title: string, planId: string) {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "started",
      summary: "provider started",
      evidence: { sessionId: "main-session", runId: `run-${planId}` },
      output: { runtimeRunRef: `runtime-${planId}` },
    });
    const { workspace, task } = await seedWorkspaceAndTask(title);
    const compiledPlan = makeSingleTaskPlan(planId);
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);
    await executeCommand({ taskId: task.id, command: { type: "start", trigger: "manual" }, context: { idempotencyKey: `${planId}-start` } });
    const planRun = await db.taskPlanRun.findFirstOrThrow({ where: { taskId: task.id, planId: compiledPlan.editablePlanId } });
    const attempt = await db.taskPlanNodeAttempt.findFirstOrThrow({ where: { planRunId: planRun.id, nodeId: "task_node", status: "running" } });
    const mainTaskSession = await db.taskSession.findFirstOrThrow({ where: { taskId: task.id } });
    const run = await db.run.create({
      data: { taskId: task.id, taskSessionId: mainTaskSession.id, nodeAttemptId: attempt.id, runtimeName: "hermes", runtimeRunRef: `runtime-${planId}`, status: "Running", triggeredBy: "system" },
    });
    const providerRun = await db.taskPlanProviderRun.create({
      data: { workspaceId: workspace.id, taskId: task.id, planId: compiledPlan.editablePlanId, planRunId: planRun.id, nodeAttemptId: attempt.id, runId: run.id, idempotencyKey: `${planId}-provider`, status: "running" },
    });
    return { task, attempt, run, providerRun };
  }

  async function submitGeneratedDeliverable(input: {
    taskId: string;
    runId: string;
    expectedAttemptId: string;
    runtimeRunRef: string;
    providerRunId?: string;
    idempotencyKey: string;
  }) {
    const directory = join(getChronaGeneratedFilesDir(), input.runId);
    const uri = `generated://${input.runId}/result.md` as `generated://${string}`;
    const executionSession = await db.executionSession.findFirstOrThrow({
      where: { taskId: input.taskId, status: "Active" },
      orderBy: { updatedAt: "desc" },
    });
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "result.md"), "# Exact result\n");
    try {
      return await executeCommand({
        taskId: input.taskId,
        command: {
          type: "submit_node_result",
          nodeId: "task_node",
          expectedAttemptId: input.expectedAttemptId,
          runtimeRunRef: input.runtimeRunRef,
          providerRunId: input.providerRunId,
          result: {
            kind: "done",
            summary: "Exact result",
            evidence: { runId: input.runId },
            deliverables: [{
              deliverableKey: "exact-result",
              title: "Exact result",
              kind: "document",
              source: { type: "generated_file", uri },
            }],
          },
          continueExecution: false,
        },
        context: {
          idempotencyKey: input.idempotencyKey,
          runId: input.runId,
          sessionId: executionSession.id,
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  it("does not persist artifacts for stale submit attempt identity", async () => {
    const { task, run, providerRun } = await runningProviderAttempt("Receipt stale artifact", "graph_receipt_stale_artifact");

    await submitGeneratedDeliverable({
      taskId: task.id,
      runId: run.id,
      expectedAttemptId: "attempt-stale",
      runtimeRunRef: "runtime-graph_receipt_stale_artifact",
      providerRunId: providerRun.id,
      idempotencyKey: "stale-artifact-submit",
    });

    expect(await db.artifact.count({ where: { taskId: task.id } })).toBe(0);
  });

  it("does not persist artifacts for wrong provider, runtime run, or run refs", async () => {
    const first = await runningProviderAttempt("Receipt wrong identity artifact", "graph_receipt_wrong_identity_artifact");
    const other = await runningProviderAttempt("Receipt other identity artifact", "graph_receipt_other_identity_artifact");

    await submitGeneratedDeliverable({
      taskId: first.task.id,
      runId: first.run.id,
      expectedAttemptId: first.attempt.id,
      runtimeRunRef: "runtime-graph_receipt_wrong_identity_artifact",
      providerRunId: other.providerRun.id,
      idempotencyKey: "wrong-provider-artifact-submit",
    });
    await submitGeneratedDeliverable({
      taskId: first.task.id,
      runId: first.run.id,
      expectedAttemptId: first.attempt.id,
      runtimeRunRef: "runtime-wrong-ref",
      providerRunId: first.providerRun.id,
      idempotencyKey: "wrong-runtime-artifact-submit",
    });
    await submitGeneratedDeliverable({
      taskId: first.task.id,
      runId: other.run.id,
      expectedAttemptId: first.attempt.id,
      runtimeRunRef: "runtime-graph_receipt_wrong_identity_artifact",
      providerRunId: first.providerRun.id,
      idempotencyKey: "wrong-run-artifact-submit",
    });

    expect(await db.artifact.count({ where: { taskId: first.task.id } })).toBe(0);
  });

  it("persists one artifact for exact current submit and concurrent duplicate", async () => {
    const { task, attempt, run, providerRun } = await runningProviderAttempt("Receipt exact artifact", "graph_receipt_exact_artifact");

    await Promise.all([
      submitGeneratedDeliverable({
        taskId: task.id,
        runId: run.id,
        expectedAttemptId: attempt.id,
        runtimeRunRef: "runtime-graph_receipt_exact_artifact",
        providerRunId: providerRun.id,
        idempotencyKey: "exact-artifact-submit",
      }),
      submitGeneratedDeliverable({
        taskId: task.id,
        runId: run.id,
        expectedAttemptId: attempt.id,
        runtimeRunRef: "runtime-graph_receipt_exact_artifact",
        providerRunId: providerRun.id,
        idempotencyKey: "exact-artifact-submit",
      }),
    ]);

    expect(await db.artifact.count({ where: { taskId: task.id, runId: run.id } })).toBe(1);
  });
});
