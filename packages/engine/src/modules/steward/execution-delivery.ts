import { approveExecutionAuthority, admitApplicationExecution } from "./execution-delivery-store";
import { kernelCleanupReceiptSchema, executionDeliveryTargetSchema, executionProcessIdentitySchema, executionDeliverySourceSchema, executionDeliveryFinalSchema, executionSignedStopSchema, executionIdSchema, type ExecutionPrincipal, type ExecutionReceiver, type ExecutionDeliveryTarget, type ExecutionDeliveryFinal, type ExecutionDeliverySource, type ExecutionSignedStop, type ExecutionLaunch } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { createRuns } from "./runs";
import { executionDigest, executionPrincipal, executionRef, executionEventStore, executionSnapshot, finishExecution } from "./execution-state";
import { appendExecutionEventIn } from "./execution-event-store";
import { verifyExecutionStop } from "./execution-delivery-stop";
import { deliveryIn, receiverIn, liveDeliveryIn, replayIn, receiptIn, deliveryInclude, targetOf, json, type DeliveryRow } from "./execution-delivery-records";
import { CallError } from "./module-call-error";
import { createExecutionDeliveryControls } from "./execution-delivery-controls";
import { createExecutionDeliveryModel } from "./execution-delivery-model";

export function createExecutionDelivery(ports: StewardPorts) {
  async function transaction<T>(who: ExecutionReceiver, rawTarget: ExecutionDeliveryTarget, operation: string, rawKey: string, payload: unknown, action: (tx: Prisma.TransactionClient, row: DeliveryRow, now: Date) => Promise<T>) {
    const target = executionDeliveryTargetSchema.parse(rawTarget), requestKey = executionIdSchema.parse(rawKey);
    return ports.db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${who.workspaceId}`;
      const row = await deliveryIn(tx, who, target);
      const prior = await replayIn(tx, row, operation, requestKey, payload);
      if (prior) return prior.receipt as T;
      const now = ports.now(), result = await action(tx, row, now);
      await receiptIn(tx, row, operation, requestKey, payload, result, now);
      return result;
    });
  }
  return {
    approveAuthority: (p: ExecutionPrincipal, input: Parameters<typeof approveExecutionAuthority>[2]) => approveExecutionAuthority(ports, p, input),
    admit: (p: ExecutionPrincipal, input: Parameters<typeof admitApplicationExecution>[2]) => admitApplicationExecution(ports, p, input),
    /** Polling may replay an offered launch. The immutable delivery is the durable outbox. */
    async poll(who: ExecutionReceiver, limit = 10) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new CallError("invalid", "Invalid delivery poll limit");
      await receiverIn(ports.db, who, false);
      // Claim uses the one Run queue; no application-specific scheduling inventory exists.
      for (let i = 0; i < limit; i++) if (!await createRuns(ports, who.workspaceId).claimNext("background", ports.now(), { kind: "application" })) break;
      return ports.db.$transaction(async tx => {
        await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${who.workspaceId}`;
        await receiverIn(tx, who, false);
        const pending = { receipts: { some: { direction: "outbound", acceptedAt: null } } } as const;
        const where = { receiverModuleId: who.moduleId, receiverHash: who.hash, receiverActivationId: who.activationId, OR: [{ settledAt: null }, pending], attempt: { workspaceId: who.workspaceId } };
        const selected: { row: DeliveryRow; launchable: boolean }[] = [];
        // offeredAt is a durable visit watermark as well as the offer fence.
        // Reserve a bounded share for controls; a busy control lane must not
        // prevent a cold held claim from reaching the application's journal.
        const select = async (controlsOnly: boolean, through: number) => {
          let cursor: string | undefined;
          while (selected.length < through) {
            const rows = await tx.executionDelivery.findMany({ where: controlsOnly ? { ...where, ...pending } : where, include: deliveryInclude, orderBy: [{ offeredAt: "asc" }, { id: "asc" }], take: 50, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
            for (const row of rows) {
              if (selected.some(item => item.row.id === row.id)) continue;
              let launchable = true;
              try { await liveDeliveryIn(tx, row, ports.now()); } catch (e) { if (!(e instanceof CallError)) throw e; launchable = false; }
              // A fresh launch is never returned after a lifecycle fence;
              // skip it without letting it pin the rest of the durable scan.
              if (!launchable && !row.offeredAt && !await tx.executionReceipt.findFirst({ where: { deliveryId: row.id, direction: "outbound", acceptedAt: null }, select: { id: true } })) continue;
              selected.push({ row, launchable });
              if (selected.length === through) break;
            }
            if (rows.length < 50) break;
            cursor = rows.at(-1)!.id;
          }
        };
        await select(true, Math.floor(limit / 2));
        await select(false, limit);
        // A fixed clock or concurrent polls must still advance the rotation.
        const latest = await tx.executionDelivery.findFirst({ where, orderBy: { offeredAt: "desc" }, select: { offeredAt: true } });
        const visit = new Date(Math.max(ports.now().getTime(), (latest?.offeredAt?.getTime() ?? 0) + 1));
        const deliveries = [];
        for (const { row, launchable } of selected) {
          await tx.executionDelivery.update({ where: { id: row.id }, data: { offeredAt: visit } });
          const controls = await tx.executionReceipt.findMany({ where: { deliveryId: row.id, direction: "outbound", acceptedAt: null }, orderBy: [{ offeredAt: "asc" }, { id: "asc" }], take: 100 });
          for (const c of controls) await tx.executionReceipt.update({ where: { id: c.id }, data: { offeredAt: visit } });
          deliveries.push({ target: targetOf(row), launch: row.launch, launchable, controls: controls.map(c => ({ requestKey: c.requestKey, operation: c.operation, payload: c.payload })) });
        }
        return { deliveries };
      });
    },
    accept(who: ExecutionReceiver, target: ExecutionDeliveryTarget, key: string) {
      return transaction(who, target, "accept", key, {}, async (tx, row, now) => {
        await liveDeliveryIn(tx, row, now);
        if (!row.offeredAt) throw new CallError("conflict", "Delivery has not been offered");
        await tx.executionDelivery.update({ where: { id: row.id }, data: { acceptedAt: row.acceptedAt ?? now } });
        return { accepted: true, target: targetOf(row) };
      });
    },
    started(who: ExecutionReceiver, target: ExecutionDeliveryTarget, key: string, raw: { id: string; scope: string }) {
      const identity = executionProcessIdentitySchema.parse(raw);
      return transaction(who, target, "started", key, identity, async (tx, row, now) => {
        await liveDeliveryIn(tx, row, now);
        if (!row.acceptedAt) throw new CallError("conflict", "Delivery must be accepted before process start");
        if (row.processIdentity && executionDigest(row.processIdentity) !== executionDigest(identity)) throw new CallError("conflict", "Process identity is immutable");
        await tx.executionDelivery.update({ where: { id: row.id }, data: { startedAt: row.startedAt ?? now, processIdentity: identity } });
        return { started: true, target: targetOf(row) };
      });
    },
    source(who: ExecutionReceiver, target: ExecutionDeliveryTarget, key: string, raw: ExecutionDeliverySource) {
      const records = executionDeliverySourceSchema.parse(raw);
      return transaction(who, target, "source", key, records, async (tx, row) => {
        if (row.settledAt || row.finalDigest) throw new CallError("conflict", "Execution source is closed");
        if (!row.acceptedAt) throw new CallError("conflict", "Delivery was not accepted");
        let through = row.sourceThrough;
        for (const r of records) {
          if (r.sequence !== through + 1) throw new CallError("conflict", "Execution source sequence is not contiguous");
          await appendExecutionEventIn(ports, tx, executionPrincipal(row.attempt), { ...executionRef(row.attempt), seq: r.sequence, at: r.at, payload: r.payload }, { allocate: true });
          through = r.sequence;
        }
        await tx.executionDelivery.update({ where: { id: row.id }, data: { sourceThrough: through } });
        return { throughSourceSeq: through };
      });
    },
    final(who: ExecutionReceiver, target: ExecutionDeliveryTarget, key: string, raw: ExecutionDeliveryFinal) {
      const final = executionDeliveryFinalSchema.parse(raw);
      return transaction(who, target, "final", key, final, async (tx, row, now) => {
        const digest = executionDigest(final);
        if (row.finalDigest && row.finalDigest !== digest) throw new CallError("conflict", "Execution final is immutable");
        if (row.finalDigest) return { finalDigest: digest, committed: true };
        if (!row.offeredAt || final.throughSourceSeq !== row.sourceThrough || executionDigest(final.baseline) !== executionDigest((row.launch as unknown as ExecutionLaunch).target.baseline)) throw new CallError("conflict", "Final source frontier or baseline mismatch");
        await tx.executionDelivery.update({ where: { id: row.id }, data: { finalDigest: digest, final: json(final), finalCommittedAt: now } });
        await tx.executionAttempt.update({ where: { id: row.attempt.id }, data: { capabilityRevokedAt: row.attempt.capabilityRevokedAt ?? now } });
        // The final is durable even when process stop is still unknown. Directory and capacity remain held.
        await tx.run.update({ where: { id: row.attempt.runId }, data: { status: "failed", error: "Execution stop is unconfirmed", endedAt: now, leaseUntil: null } });
        await finishExecution(ports, tx, row.attempt.runId, undefined, now);
        const a = await tx.executionAttempt.findUniqueOrThrow({ where: { id: row.attempt.id }, include: { run: true } });
        await executionEventStore(ports).saveSnapshot(tx, executionPrincipal(a), { ...await executionSnapshot(tx, a, now), finalMessage: final.finalMessage, missing: final.missing });
        return { finalDigest: digest, committed: true };
      });
    },
    stop(who: ExecutionReceiver, target: ExecutionDeliveryTarget, key: string, raw: ExecutionSignedStop) {
      const proof = executionSignedStopSchema.parse(raw);
      return transaction(who, target, "stop", key, proof, async (tx, row, now) => {
        if (!row.finalDigest || !row.final) throw new CallError("conflict", "Stop settlement requires the committed final");
        const evidence = await verifyExecutionStop(tx, targetOf(row), proof);
        if (proof.statement.sourceThrough !== row.sourceThrough) throw new CallError("conflict", "Stop source frontier mismatch");
        if (!row.settledAt) {
          const final = row.final as ExecutionDeliveryFinal;
          await createRuns(ports, who.workspaceId).finishRunIn(tx, row.attempt.runId, { outcome: final.outcome === "cancelled" ? "failed" : final.outcome, sessionId: null, error: final.error }, now, evidence);
          await tx.executionDelivery.update({ where: { id: row.id }, data: { settledAt: now } });
        }
        return { settled: true, finalDigest: row.finalDigest, stopDigest: evidence.digest };
      });
    },
    cleanupReport(who: ExecutionReceiver, target: ExecutionDeliveryTarget, key: string, rawControlKey: string, raw: import("zod").z.infer<typeof kernelCleanupReceiptSchema>) {
      const controlKey = executionIdSchema.parse(rawControlKey), report = kernelCleanupReceiptSchema.parse(raw);
      return transaction(who, target, "cleanup-report", key, { controlKey, report }, async (tx, row, now) => {
        const command = await tx.executionReceipt.findUnique({ where: { deliveryId_operation_requestKey: { deliveryId: row.id, operation: "cleanup", requestKey: controlKey } } });
        if (!command?.offeredAt || !row.settledAt || report.workId !== row.attempt.workId || report.workspaceRef !== row.attempt.workspaceRef || report.operationKey !== controlKey || report.state === "pending") throw new CallError("conflict", "Cleanup receipt does not match its offered workspace operation");
        if (command.acceptedAt) throw new CallError("conflict", "Cleanup operation already has a receipt");
        const input = command.payload as { op: "preview" | "confirm"; previewDigest?: string };
        if (input.op === "preview" && (report.state === "removed" || report.state === "retained" && !report.previewDigest) || input.op === "confirm" && report.previewDigest !== input.previewDigest) throw new CallError("conflict", "Cleanup preview or confirmation digest changed");
        await tx.executionReceipt.update({ where: { id: command.id }, data: { acceptedAt: now } });
        return report;
      });
    },
    ...createExecutionDeliveryControls(ports),
    model: createExecutionDeliveryModel(ports),
  };
}
