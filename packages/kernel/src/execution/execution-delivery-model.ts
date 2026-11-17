import { runtimeCompletionSchema, moduleManifestSchema, executionLaunchSchema, executionDeliveryModelSchema, executionDeliveryTargetSchema, executionIdSchema, type ExecutionDeliveryModel, type ExecutionReceiver, type ExecutionDeliveryTarget } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import { deliveryIn, liveDeliveryIn, replayIn, receiptIn, replaceReceiptIn } from "./execution-delivery-records";
import { reserveCompletionIn, finishCompletionIn, refused, type ModelError } from "../modules/module-model-budget";
import { callProviderEndpoint, assertProviderBinding, providerSnapshot } from "../agent/agent-provider";
import { maskProviderPayload } from "../agent/agent-provider-redaction";
import { CallError } from "../modules/module-call-error";
import { awaitRegisteredCompletion, releaseRegisteredCompletion } from "./execution-delivery-completion";

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
      const launch = executionLaunchSchema.parse(row.launch), manifest = moduleManifestSchema.parse(version.manifest);
      const provider = await tx.agentRunProvider.findUnique({ where: { runId: row.attempt.run.id } });
      if (!provider || !(await assertProviderBinding(tx, who.workspaceId, provider)).capabilities.completion) throw new CallError("unavailable", "Admitted execution provider has no completion capability");
      const reservation = await reserveCompletionIn(tx, { workspaceId: who.workspaceId, moduleId: row.attempt.moduleId, hash: row.attempt.callerHash, manifest, eventKey: `execution:${row.attempt.id}` }, input, now, { maxCalls: Math.min(launch.budget.maxModelCalls, launch.budget.maxToolCalls), maxOutputTokens: launch.budget.maxOutputTokens, timeoutMs: Math.max(1, row.attempt.run.deadlineAt!.getTime() - now.getTime()) });
      const receipt = { status: reservation.error ? "rejected" : "pending", reservationId: reservation.id, error: reservation.error };
      await receiptIn(tx, row, "model", key, input, receipt, now);
      return { reservation, receipt, provider, moduleId: row.attempt.moduleId, hash: row.attempt.callerHash };
    });
    if ("prior" in admitted) return admitted.prior;
    if (admitted.reservation.error) return admitted.receipt;
    const endpoint: Parameters<typeof awaitRegisteredCompletion>[0] = (name, args, requestKey) => callProviderEndpoint(ports, who.workspaceId, admitted.provider, name, args, requestKey);
    const operationId = admitted.reservation.id, timeoutMs = admitted.reservation.effectiveHardLimits!.eventTimeoutMs;
    const configuration = providerSnapshot(admitted.provider.declaration).configuration;
    let settled: Awaited<ReturnType<typeof awaitRegisteredCompletion>>;
    try {
      settled = await awaitRegisteredCompletion(endpoint, operationId, { ...input, commandKey: operationId, timeoutMs, ...(configuration?.revision ? { configurationRevision: configuration.revision } : {}) }, timeoutMs);
    } catch {
      // Persisted pending receipt deliberately remains pending. A restart cannot replay this gateway request.
      throw refused("provider_error");
    }
    const { result, error } = retainedCompletion(settled, input.maxOutputTokens);
    const completed = error ? { status: "failed", reservationId: operationId, error } : { status: "completed", reservationId: operationId, result };
    await ports.db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${who.workspaceId}`;
      const row = await deliveryIn(tx, who, target);
      const receipt = await replayIn(tx, row, "model", key, input);
      if (!receipt) throw new CallError("conflict", "Model reservation receipt missing");
      await replaceReceiptIn(tx, row, receipt, completed);
      await finishCompletionIn(tx, who.workspaceId, { id: operationId, ...(error ? {} : { result }), error }, { moduleId: admitted.moduleId, hash: admitted.hash });
    });
    await releaseRegisteredCompletion(endpoint, operationId);
    if (error) throw refused(error);
    return completed;
  };
}

function retainedCompletion(settled: Awaited<ReturnType<typeof awaitRegisteredCompletion>>, maxOutputTokens: number): { result?: ReturnType<typeof runtimeCompletionSchema.parse>; error: ModelError | null } {
  if (!("result" in settled)) return { error: settled.outcome.outcome === "timed_out" ? "timeout" : "provider_error" };
  try {
    const result = runtimeCompletionSchema.parse(maskProviderPayload(settled.result));
    return result.outputTokens !== null && result.outputTokens > maxOutputTokens ? { error: "provider_error" } : { result, error: null };
  } catch { return { error: "provider_error" }; }
}
