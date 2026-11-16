import type { Prisma } from "@chrona/db";
import type { ProviderAdapter } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import type { VerifiedExecutionStop } from "./execution-delivery-stop-types";
import { finishExecution } from "./execution-state";
import { StewardError } from "../errors";
import { notifyLifecycle } from "../notify-user";
import { interruptRunCallsIn } from "./run-events";
import { audit } from "../audit";
type RunRow = Prisma.RunGetPayload<{ include: { session: true } }>;
type RunOutcome = Awaited<ReturnType<ProviderAdapter["start"]>["done"]>;

/** Stop uncertainty and owner cancellation take precedence over Provider output. */
function finalRunOutcome(outcome: RunOutcome, state: { knownStop: boolean; cancelled: boolean; expired: boolean }) {
  if (!state.knownStop) return { status: "failed", stopStatus: "unknown", error: "Execution stop is unconfirmed" };
  if (state.cancelled) return { status: "cancelled", stopStatus: "confirmed", error: "Cancelled by owner" };
  if (state.expired) return { status: "timed_out", stopStatus: "confirmed", error: "Run lease expired" };
  return { status: outcome.outcome === "unavailable" ? "provider_unavailable" : outcome.outcome, stopStatus: "confirmed", error: outcome.error };
}

function mayFinalizeRun(status: string, evidence: unknown, hasAttempt: boolean, agentContext: boolean, stopStatus: string) {
  return status === "running" || canReconcileStop(!!evidence, hasAttempt, agentContext, stopStatus);
}
export function runExpired(run: { deadlineAt: Date | null; leaseUntil: Date | null }, now: Date) {
  return !!((run.deadlineAt && run.deadlineAt <= now) || (run.leaseUntil && run.leaseUntil <= now));
}
function runWasCancelled(run: { cancelRequestedAt: Date | null }, attempt: { cancelRequestedAt: Date | null } | null) {
  return !!attempt?.cancelRequestedAt || !!run.cancelRequestedAt;
}
export async function finishRunIn(ports: StewardPorts, workspaceId: string, tx: Prisma.TransactionClient, runId: string, outcome: RunOutcome, now: Date, evidence?: "provider_exited" | "never_started" | VerifiedExecutionStop): Promise<boolean> {
  const run = await tx.run.findFirst({ where: { id: runId, workspaceId }, include: { session: true } });
  if (!run) throw new StewardError("not_found", "Run not found");
  const attempt = await tx.executionAttempt.findUnique({ where: { runId } });
  const agentContext = await hasProviderStopGuard(tx, run);
  if (attempt?.stopConfirmedAt) return false;
  if (!mayFinalizeRun(run.status, evidence, !!attempt, agentContext, run.stopStatus)) return false;
  const knownStop = (!attempt && !agentContext) || !!evidence;
  const { status, stopStatus, error } = finalRunOutcome(outcome, { knownStop, cancelled: runWasCancelled(run, attempt), expired: runExpired(run, now) });
  await tx.run.update({ where: { id: runId }, data: { status, stopStatus, error: error?.slice(0, 1000) ?? null, endedAt: now, leaseUntil: null } });
  await interruptRunCallsIn(tx, runId, now);
  if (run.sessionId) await tx.session.update({ where: { id: run.sessionId }, data: { lastActivityAt: now, ...(outcome.sessionId ? { providerSessionId: outcome.sessionId } : {}) } });
  if (attempt) await finishExecution(ports, tx, runId, evidence, now);
  else await finishOrdinaryRun(ports, tx, run, status);
  await audit(tx, { workspaceId, actor: "chrona", kind: "run_finished", subjectId: runId, details: { status } });
  return true;
}
async function finishOrdinaryRun(ports: StewardPorts, tx: Prisma.TransactionClient, run: RunRow, status: string) {
  if (run.lane !== "build" || (status !== "failed" && status !== "timed_out" && status !== "provider_unavailable")) return;
  await notifyLifecycle(tx, ports, run.workspaceId, `build-paused:${run.id}`, { kind: "build-paused", status, ...(run.sessionId ? { session: run.sessionId } : {}) });
}
function canReconcileStop(evidence: boolean, attempt: boolean, agentContext: boolean, stopStatus: string) {
  return evidence && (attempt || agentContext && stopStatus === "unknown");
}
async function hasProviderStopGuard(tx: Prisma.TransactionClient, run: RunRow) {
  return await isAgentContext(tx, run.sessionId) || !!await tx.agentRunProvider.findUnique({ where: { runId: run.id } });
}
async function isAgentContext(tx: Prisma.TransactionClient, sessionId: string | null) {
  return !!(sessionId && await tx.agentContext.findUnique({ where: { sessionId } }));
}
