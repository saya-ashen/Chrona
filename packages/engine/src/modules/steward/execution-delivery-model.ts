import { moduleManifestSchema, executionDeliveryModelSchema, executionDeliveryTargetSchema, executionIdSchema, type ExecutionDeliveryModel, type ExecutionReceiver, type ExecutionDeliveryTarget, type ExecutionLaunch } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { deliveryIn, liveDeliveryIn, replayIn, receiptIn, replaceReceiptIn } from "./execution-delivery-records";
import { reserveCompletionIn, finishCompletionIn, refused } from "./module-model-budget";
import { runtimeCall } from "./local-runtime";
import { CallError } from "./module-call-error";

/** A durable pending receipt is committed before model I/O. Unknown results are never reissued. */
export function createExecutionDeliveryModel(ports: StewardPorts) {
  return async (who: ExecutionReceiver, rawTarget: ExecutionDeliveryTarget, rawKey: string, raw: ExecutionDeliveryModel) => {
    const target = executionDeliveryTargetSchema.parse(rawTarget), key = executionIdSchema.parse(rawKey), input = executionDeliveryModelSchema.parse(raw);
    const admitted = await ports.db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${who.workspaceId}`;
      const row = await deliveryIn(tx, who, target);
      const prior = await replayIn(tx, row, "model", key, input);
      if (prior) return { prior: prior.receipt };
      const now = ports.now();
      await liveDeliveryIn(tx, row, now);
      if (!row.acceptedAt || !row.attempt.moduleId || !row.attempt.callerHash) throw new CallError("forbidden", "Model delegation requires an accepted module execution");
      const version = await tx.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: row.attempt.moduleId, hash: row.attempt.callerHash } } });
      const launch = row.launch as unknown as ExecutionLaunch, manifest = moduleManifestSchema.parse(version.manifest);
      const reservation = await reserveCompletionIn(tx, { workspaceId: who.workspaceId, moduleId: row.attempt.moduleId, hash: row.attempt.callerHash, manifest, eventKey: `execution:${row.attempt.id}` }, input, now, { maxCalls: Math.min(launch.budget.maxModelCalls, launch.budget.maxToolCalls), maxOutputTokens: launch.budget.maxOutputTokens, timeoutMs: Math.max(1, row.attempt.run.deadlineAt!.getTime() - now.getTime()) });
      const receipt = { status: reservation.error ? "rejected" : "pending", reservationId: reservation.id, error: reservation.error };
      await receiptIn(tx, row, "model", key, input, receipt, now);
      return { reservation, receipt, moduleId: row.attempt.moduleId, hash: row.attempt.callerHash };
    });
    if ("prior" in admitted) return admitted.prior;
    if (admitted.reservation.error) return admitted.receipt;
    let result: { text: string; inputTokens: number | null; outputTokens: number | null };
    try {
      result = await runtimeCall(ports, who.workspaceId, "agent.complete", { ...input, declaredTier: admitted.reservation.declaredTier!, effectiveHardLimits: admitted.reservation.effectiveHardLimits!, timeoutMs: admitted.reservation.effectiveHardLimits!.eventTimeoutMs });
    } catch {
      // Persisted pending receipt deliberately remains pending. A restart cannot replay this gateway request.
      throw refused("provider_error");
    }
    const completed = { status: "completed", reservationId: admitted.reservation.id, result };
    await ports.db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${who.workspaceId}`;
      const row = await deliveryIn(tx, who, target);
      const receipt = await replayIn(tx, row, "model", key, input);
      if (!receipt) throw new CallError("conflict", "Model reservation receipt missing");
      await replaceReceiptIn(tx, row, receipt, completed);
      await finishCompletionIn(tx, who.workspaceId, { id: admitted.reservation.id, result, error: null }, { moduleId: admitted.moduleId, hash: admitted.hash });
    });
    return completed;
  };
}
