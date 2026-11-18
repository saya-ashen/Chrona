import type { Prisma } from "@chrona/db";
import type { ProviderAdapter } from "@chrona/contracts/steward";
import { StewardError } from "../errors";
import { interruptRunCallsIn } from "./run-events";
import { audit } from "../audit";
import { providerCompletionBudgetSchema } from "../agent/agent-provider";
import { finishCompletionIn } from "../modules/module-model-budget";
type RunOutcome = Awaited<ReturnType<ProviderAdapter["start"]>["done"]>;

/** Stop uncertainty and owner cancellation take precedence over Provider output. */
function finalRunOutcome(outcome: RunOutcome, state: { knownStop: boolean; cancelled: boolean; expired: boolean }) {
  if (!state.knownStop) return { status: "failed", stopStatus: "unknown", error: "Execution stop is unconfirmed" };
  if (state.cancelled) return { status: "cancelled", stopStatus: "confirmed", error: "Cancelled by owner" };
  if (state.expired) return { status: "timed_out", stopStatus: "confirmed", error: "Run lease expired" };
  return { status: outcome.outcome === "unavailable" ? "provider_unavailable" : outcome.outcome, stopStatus: "confirmed", error: outcome.error };
}

export function runExpired(run: { deadlineAt: Date | null; leaseUntil: Date | null }, now: Date) {
  return !!((run.deadlineAt && run.deadlineAt <= now) || (run.leaseUntil && run.leaseUntil <= now));
}
export async function finishRunIn(tx: Prisma.TransactionClient, workspaceId: string, runId: string,
  outcome: RunOutcome, { now, evidence }: { now: Date; evidence?: "provider_exited" | "never_started" }): Promise<boolean> {
  const run = await tx.run.findFirst({ where: { id: runId, workspaceId } });
  if (!run) throw new StewardError("not_found", "Run not found");
  if (run.status !== "running" && !(evidence && run.stopStatus === "unknown") && !(run.status === "queued" && evidence === "never_started")) return false;
  const { status, stopStatus, error } = finalRunOutcome(outcome, { knownStop: !!evidence, cancelled: !!run.cancelRequestedAt, expired: runExpired(run, now) });
  if (evidence === "never_started") await releaseUnstartedCompletion(tx, workspaceId, runId);
  await tx.run.update({ where: { id: runId }, data: { status, stopStatus, error: error?.slice(0, 1000) ?? null, endedAt: now, leaseUntil: null } });
  await interruptRunCallsIn(tx, runId, now);
  if (run.sessionId) await tx.agentContext.update({ where: { id: run.sessionId }, data: { lastActivityAt: now, ...(outcome.sessionId ? {
    providerSessionId: outcome.sessionId } : {}) } });
  await audit(tx, { workspaceId, actor: "chrona", kind: "run_finished", subjectId: runId, details: { status } });
  return true;
}

async function releaseUnstartedCompletion(tx: Prisma.TransactionClient, workspaceId: string, runId: string) {
    const binding = await tx.agentRunProvider.findUnique({ where: { runId } });
    if (binding?.kind === "completion") {
      const owner = await tx.agentRunAdmission.findUniqueOrThrow({ where: { runId } });
      const budget = providerCompletionBudgetSchema.parse(binding.completion);
      await finishCompletionIn(tx, workspaceId, { id: budget.reservationId, error: "provider_error" }, { moduleId: owner.moduleId, hash: owner.hash });
    }
}
