import type { Prisma } from "@chrona/db";
import type { ProviderAdapter } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import type { VerifiedExecutionStop } from "./execution-delivery-stop-types";
import { finishExecution } from "./execution-state";
import { StewardError } from "./errors";
import { providerCancelKey } from "./provider-journal";
import { notifyLifecycle } from "./notify-user";
import { audit } from "./audit";
type RunRow = Prisma.RunGetPayload<{ include: { session: true } }>;
type RunOutcome = Awaited<ReturnType<ProviderAdapter["start"]>["done"]>;

/** Stop uncertainty and owner cancellation take precedence over Provider output. */
function finalRunOutcome(outcome: RunOutcome, state: { knownStop: boolean; cancelled: boolean; expired: boolean }) {
  if (!state.knownStop) return { status: "failed", error: "Execution stop is unconfirmed" };
  if (state.cancelled) return { status: "cancelled", error: "Cancelled by owner" };
  if (state.expired) return { status: "timed_out", error: "Run lease expired" };
  return { status: outcome.outcome === "unavailable" ? "provider_unavailable" : outcome.outcome, error: outcome.error };
}

function mayFinalizeRun(status: string, evidence: unknown, hasAttempt: boolean, agentContext: boolean, error: string | null) {
  return status === "running" || canReconcileStop(!!evidence, hasAttempt, agentContext, error);
}
export function runExpired(run: { deadlineAt: Date | null; leaseUntil: Date | null }, now: Date) {
  return !!((run.deadlineAt && run.deadlineAt <= now) || (run.leaseUntil && run.leaseUntil <= now));
}
async function runWasCancelled(tx: Prisma.TransactionClient, runId: string, attempt: { cancelRequestedAt: Date | null } | null) {
  return !!attempt?.cancelRequestedAt || !!await tx.audit.findUnique({ where: { id: providerCancelKey(runId) } });
}
export async function finishRunIn(ports: StewardPorts, workspaceId: string, tx: Prisma.TransactionClient, runId: string, outcome: RunOutcome, now: Date, evidence?: "provider_exited" | "never_started" | VerifiedExecutionStop): Promise<boolean> {
  const run = await tx.run.findFirst({ where: { id: runId, workspaceId }, include: { session: true } });
  if (!run) throw new StewardError("not_found", "Run not found");
  const attempt = await tx.executionAttempt.findUnique({ where: { runId } });
  const agentContext = await isAgentContext(tx, run.sessionId);
  if (attempt?.stopConfirmedAt) return false;
  if (!mayFinalizeRun(run.status, evidence, !!attempt, agentContext, run.error)) return false;
  const { status, error } = finalRunOutcome(outcome, { knownStop: (!attempt && !agentContext) || !!evidence, cancelled: await runWasCancelled(tx, runId, attempt), expired: runExpired(run, now) });
  await tx.run.update({ where: { id: runId }, data: { status, error: error?.slice(0, 1000) ?? null, endedAt: now, leaseUntil: null } });
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
function canReconcileStop(evidence: boolean, attempt: boolean, agentContext: boolean, error: string | null) {
  return evidence && (attempt || agentContext && error === "Execution stop is unconfirmed");
}
async function isAgentContext(tx: Prisma.TransactionClient, sessionId: string | null) {
  return !!(sessionId && await tx.audit.findUnique({ where: { id: `agent-context:${sessionId}` } }));
}
