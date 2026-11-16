import { executionIdSchema, executionReceiverSchema, providerAnswerSchema, type ExecutionPrincipal, type ExecutionReceiver, type ExecutionDeliveryTarget } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "../ports";
import { assertRetainedExecutionPrincipal } from "./execution-module-guard";
import { assertExecutionPrincipal } from "./execution-principal";
import { executionScope, executionDigest, executionNeverOfferedIn } from "./execution-state";
import { finishRunIn } from "./run-finish";
import { liveRuns } from "./run-live";
import { deliveryIn, deliveryInclude, replayIn, receiptIn, liveDeliveryIn } from "./execution-delivery-records";
import { CallError } from "../modules/module-call-error";

export async function fenceExecutionModule(ports: StewardPorts, workspaceId: string, moduleId: string) {
  // This transaction intentionally commits before lifecycle's idle check can return conflict.
  const result = await ports.db.$transaction(tx => fenceExecutionModuleIn(ports, tx, workspaceId, moduleId));
  for (const runId of result.localRunIds) await liveRuns.get(runId)?.abort().catch(() => {});
  return { fenced: true, attempts: result.attempts };
}
/** Caller commits this drain transaction before attempting a lifecycle status change. */
export async function fenceExecutionModuleIn(ports: StewardPorts, tx: Prisma.TransactionClient, workspaceId: string, moduleId: string) {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
    const now = ports.now();
    await tx.module.updateMany({ where: { id: moduleId, workspaceId }, data: { executionFenceAt: now } });
    const attempts = await tx.executionAttempt.findMany({ where: { workspaceId, stopConfirmedAt: null, OR: [{ moduleId }, { delivery: { receiverModuleId: moduleId } }, { placement: { path: "$.applicationId", equals: moduleId } }] }, include: { run: true } });
    for (const a of attempts) {
      await tx.executionAttempt.update({ where: { id: a.id }, data: { capabilityRevokedAt: a.capabilityRevokedAt ?? now, cancelRequestedAt: a.cancelRequestedAt ?? now } });
      const row = await tx.executionDelivery.findUnique({ where: { attemptId: a.id }, include: deliveryInclude });
      if (row && !await replayIn(tx, row, "control", `fence:${moduleId}`, { operation: "cancel" })) await receiptIn(tx, row, "control", `fence:${moduleId}`, { operation: "cancel" }, { admitted: true }, now, "outbound");
      if (a.run.status === "queued" && !a.run.startedAt || await executionNeverOfferedIn(tx, a)) await finishRunIn(ports, workspaceId, tx, a.runId, { outcome: "failed", sessionId: null, error: "Application lifecycle drain" }, now, "never_started");
    }
    return { attempts: attempts.length, localRunIds: attempts.filter(a => !a.targetBinding && a.run.status === "running").map(a => a.runId) };
}
export function createExecutionDeliveryControls(ports: StewardPorts) {
  return {
    fenceModule: (workspaceId: string, moduleId: string) => fenceExecutionModule(ports, workspaceId, moduleId),
    async control(principal: ExecutionPrincipal, workId: string, rawKey: string, payload: { operation: "cancel" } | { operation: "write"; text: string } | { operation: "answer"; requestId: string; answer: import("@chrona/contracts/steward").ProviderAnswer }) {
      const key = executionIdSchema.parse(rawKey);
      if (payload.operation === "answer") providerAnswerSchema.parse(payload.answer);
      if (Buffer.byteLength(JSON.stringify(payload)) > 32_768) throw new CallError("too_large", "Execution control exceeds byte limit");
      return ports.db.$transaction(async tx => {
        await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${principal.workspaceId}`;
        await assertRetainedExecutionPrincipal(tx, principal);
        const a = await tx.executionAttempt.findFirst({ where: { ...executionScope(principal), workId }, include: { run: true } });
        if (!a?.targetBinding) throw new CallError("not_found", "Application execution not found");
        const prior = await tx.executionCommand.findUnique({ where: { attemptId_commandKey: { attemptId: a.id, commandKey: key } } });
        if (prior) {
          if (prior.requestDigest !== executionDigest(payload)) throw new CallError("conflict", "Control key changed");
          return prior.receipt;
        }
        if (payload.operation !== "cancel") await assertExecutionPrincipal(tx, principal);
        if (a.stopConfirmedAt || a.capabilityRevokedAt && payload.operation !== "cancel") throw new CallError("conflict", "Execution control is revoked");
        const now = ports.now(), receipt = { admitted: true, commandKey: key, operation: payload.operation };
        const row = await tx.executionDelivery.findUnique({ where: { attemptId: a.id }, include: deliveryInclude });
        if (payload.operation !== "cancel" && (!row?.acceptedAt || a.run.status !== "running")) throw new CallError("conflict", "Execution has no active receiver");
        if (payload.operation !== "cancel" && row) await liveDeliveryIn(tx, row, now);
        if (payload.operation === "cancel") await tx.executionAttempt.update({ where: { id: a.id }, data: { capabilityRevokedAt: a.capabilityRevokedAt ?? now, cancelRequestedAt: a.cancelRequestedAt ?? now } });
        await tx.executionCommand.create({ data: { attemptId: a.id, commandKey: key, operation: payload.operation, requestDigest: executionDigest(payload), receipt, createdAt: now } });
        if (row) await receiptIn(tx, row, "control", key, payload, receipt, now, "outbound");
        if (payload.operation === "cancel" && (!a.run.startedAt || await executionNeverOfferedIn(tx, a))) await finishRunIn(ports, principal.workspaceId, tx, a.runId, { outcome: "failed", sessionId: null, error: "Cancelled by owner" }, now, "never_started");
        return receipt;
      });
    },
    async acknowledge(rawWho: ExecutionReceiver, target: ExecutionDeliveryTarget, rawKey: string, controlKey: string) {
      const who = executionReceiverSchema.parse(rawWho), key = executionIdSchema.parse(rawKey);
      return ports.db.$transaction(async tx => {
        await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${who.workspaceId}`;
        const row = await deliveryIn(tx, who, target), payload = { controlKey };
        const prior = await replayIn(tx, row, "ack", key, payload);
        if (prior) return prior.receipt;
        const command = await tx.executionReceipt.findUnique({ where: { deliveryId_operation_requestKey: { deliveryId: row.id, operation: "control", requestKey: controlKey } } });
        if (!command || !command.offeredAt) throw new CallError("conflict", "Control was not offered");
        await tx.executionReceipt.update({ where: { id: command.id }, data: { acceptedAt: command.acceptedAt ?? ports.now() } });
        const receipt = { acknowledged: true, controlKey };
        await receiptIn(tx, row, "ack", key, payload, receipt, ports.now());
        return receipt;
      });
    },
  };
}

/** A same-hash no-op leaves its activation untouched. The idle check remains in the final writer transaction. */
export async function fenceExecutionVersionChange(ports: StewardPorts, workspaceId: string, moduleId: string, hash: string) {
  const result = await ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
    const current = await tx.module.findFirst({ where: { id: moduleId, workspaceId } });
    if (current && current.activeHash !== hash) return fenceExecutionModuleIn(ports, tx, workspaceId, moduleId);
  });
  for (const runId of result?.localRunIds ?? []) await liveRuns.get(runId)?.abort().catch(error => console.error(JSON.stringify({ component: "execution-drain", event: "abort.failed", runId, error: String(error) })));
}
