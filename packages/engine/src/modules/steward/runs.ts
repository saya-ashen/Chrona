import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Prisma } from "@chrona/db";
import { RUN_LIMITS, type ProviderAdapter, type RunLane, type RunTrigger, type SessionSource } from "@chrona/contracts/steward";
import { localDayKey } from "@chrona/domain/steward/local-day";
import type { ExecutionClaimSelection, VerifiedDeviceStop, StewardPorts } from "./ports";
import { buildSettings, budgetTimezone } from "./settings";
import { notifyLifecycle } from "./notify-user";
import { audit } from "./audit";
import { StewardError } from "./errors";
import { providerCancelKey } from "./provider-journal";
import { authenticateRun } from "./run-auth";
import { assertBuildProvider, buildExecution } from "./build-execution";
import { assertExternalName } from "./module-identity";
import { declaredModules } from "./module-build-session";
import { finishExecution, executionPrincipal, executionNeverOfferedIn } from "./execution-state";
import { claimExecutionIn, prepareServerClaim } from "./execution-claim";
import { assertExecutionPrincipal } from "./execution-principal";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export const liveRuns = new Map<string, ReturnType<ProviderAdapter["start"]>>();
export function nextLocalMidnight(now: Date, timezone: string) {
  const day = localDayKey(now, timezone);
  let lo = now.getTime(), hi = lo + 48 * 3600000;
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (localDayKey(new Date(mid), timezone) === day) lo = mid; else hi = mid; }
  return new Date(hi);
}
export { authenticateRun } from "./run-auth";
export type EnqueueRun = { sessionId?: string; lane: RunLane; trigger: RunTrigger; prompt: string; label?: string | null };
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
function runExpired(run: { deadlineAt: Date | null; leaseUntil: Date | null }, now: Date) {
  return !!((run.deadlineAt && run.deadlineAt <= now) || (run.leaseUntil && run.leaseUntil <= now));
}
async function runWasCancelled(tx: Prisma.TransactionClient, runId: string, attempt: { cancelRequestedAt: Date | null } | null) {
  return !!attempt?.cancelRequestedAt || !!await tx.audit.findUnique({ where: { id: providerCancelKey(runId) } });
}
function claimSelection(selection?: ExecutionClaimSelection): Prisma.RunWhereInput {
  if (selection?.kind === "ordinary") return { execution: null };
  if (selection?.kind === "execution") return { execution: { executorId: selection.executorId } };
  return { OR: [{ execution: null }, { execution: { executorId: "server" } }] };
}
export function createRunSession(tx: Prisma.TransactionClient, workspaceId: string, source: SessionSource, now: Date, origin: { originSessionId?: string; moduleId?: string } = {}) {
  return tx.session.create({ data: { workspaceId, key: `${source}:${randomUUID()}`, source, ...origin, createdAt: now, lastActivityAt: now } });
}
/** Coding admission already owns its writer transaction; logs are created by the launch/capture path. */
export function enqueueExecutionRunIn(ports: StewardPorts, tx: Prisma.TransactionClient, input: { workspaceId: string; sessionId: string; prompt: string; cwd: string; now: Date }) {
  return tx.run.create({ data: { workspaceId: input.workspaceId, sessionId: input.sessionId, prompt: input.prompt, cwd: input.cwd, lane: "background", trigger: "source", provider: ports.provider?.name ?? "unconfigured", tokenHash: hash(randomBytes(32).toString("hex")), createdAt: input.now } });
}
export function createRuns(ports: StewardPorts, workspaceId: string) {
  const runs = new RunService(ports, workspaceId);
  return { enqueue: runs.enqueue.bind(runs), claimNext: runs.claimNext.bind(runs), finish: runs.finish.bind(runs), finishRunIn: runs.finishRunIn.bind(runs), expireLeases: runs.expireLeases.bind(runs), authenticate: (token: string) => authenticateRun(ports.db, token, ports.now()) };
}
class RunService {
  constructor(private readonly ports: StewardPorts, private readonly workspaceId: string) {}
  async enqueue(input: EnqueueRun, tx: Prisma.TransactionClient = this.ports.db) {
    const { ports, workspaceId } = this;
    const session = input.sessionId ? await tx.session.findFirst({ where: { id: input.sessionId, workspaceId, status: "active" } }) : null;
    if (input.sessionId && !session) throw new StewardError("not_found", "Active session not found");
    if (!session) throw new StewardError("invalid", "Run requires a session");
    const cwd = join(ports.dataDir, "sessions", session.id);
    await mkdir(cwd, { recursive: true });
    // The clock may tie or move backwards; builds still enter FIFO in admission order.
    const tail = input.lane === "build" ? await tx.run.findFirst({ where: { workspaceId, lane: "build" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }) : null;
    const createdAt = new Date(Math.max(ports.now().getTime(), tail ? tail.createdAt.getTime() + 1 : 0));
    return tx.run.create({ data: { ...input, workspaceId, provider: ports.provider?.name ?? "unconfigured", tokenHash: hash(randomBytes(32).toString("hex")), cwd, createdAt } });
  }
  private async admitQueued(tx: Prisma.TransactionClient, run: RunRow, now: Date, { lane, today, timezone }: { lane: RunLane; today: { sessionId: string | null }[]; timezone: string }) {
    if ((run.session && run.session.status !== "active") || await tx.audit.findUnique({ where: { id: providerCancelKey(run.id) } })) {
      await tx.run.update({ where: { id: run.id }, data: { status: "cancelled", endedAt: now } });
      return "skip";
    }
    if (lane === "build" && run.leaseUntil && run.leaseUntil > now) return "blocked";
    if (today.length >= RUN_LIMITS.maxRunsPerDay || (run.sessionId && today.filter(r => r.sessionId === run.sessionId).length >= RUN_LIMITS.maxRunsPerSessionPerDay)) {
      await tx.run.update({ where: { id: run.id }, data: { leaseUntil: nextLocalMidnight(now, timezone) } });
      return lane === "build" ? "blocked" : "skip";
    }
    return "ready";
  }
  private async checkBuildTargets(tx: Prisma.TransactionClient, run: RunRow, now: Date) {
      try {
        const targets = run.sessionId ? await declaredModules(tx, this.workspaceId, run.sessionId) : null;
        if (!targets?.length) throw new StewardError("forbidden", "Build target authority is missing or malformed; authorize a new build");
        for (const name of targets) await assertExternalName(tx, this.workspaceId, name, "build");
      } catch (error) {
        if (!(error instanceof StewardError)) throw error;
        const reason = `Build refused before Provider start: ${error.message}`.slice(0, 1000);
        await tx.run.update({ where: { id: run.id }, data: { status: "failed", endedAt: now, leaseUntil: null, error: reason } });
        await audit(tx, { workspaceId: this.workspaceId, actor: "chrona", kind: "run_finished", subjectId: run.id, details: { status: "failed", reason } });
        return false;
      }
    return true;
  }
  private async claimQueued(tx: Prisma.TransactionClient, run: RunRow, lane: RunLane, now: Date, builds: ReturnType<typeof buildSettings> | null) {
    if (lane === "build" && !await this.checkBuildTargets(tx, run, now)) return null;
    const execution = lane === "build" ? await buildExecution(tx, run.id) : null;
    if (execution) {
      try { assertBuildProvider(this.ports, execution); }
      catch {
        await tx.run.update({ where: { id: run.id }, data: { status: "failed", endedAt: now, error: "Authorized build Provider/model pin is unavailable" } });
        return null;
      }
      builds = { ...builds!, timeoutMinutes: execution.timeoutMinutes, maxSubmissions: execution.maxSubmissions };
    }
    const timeoutMs = await this.claimTimeout(tx, run, lane, builds);
    if (timeoutMs === null) return null;
    const token = randomBytes(32).toString("hex"), deadlineAt = new Date(now.getTime() + timeoutMs);
    const prompt = builds ? `${run.prompt}\n\nCurrent kernel limits for this run (override earlier numeric build limits): at most ${builds.maxSubmissions} candidate submissions; deadline ${deadlineAt.toISOString()} (${builds.timeoutMinutes} minutes). Report before the deadline; do not start an automatic continuation.` : run.prompt;
    if (!(await tx.run.updateMany({ where: { id: run.id, status: "queued" }, data: { status: "running", tokenHash: hash(token), startedAt: now, deadlineAt, leaseUntil: deadlineAt, prompt } })).count) return null;
    await audit(tx, { workspaceId: this.workspaceId, actor: "chrona", kind: "run_claimed", subjectId: run.id, details: { lane, ...(builds ? { builds } : {}), ...(execution ? { execution } : {}) } });
    return { ...run, status: "running", startedAt: now, deadlineAt, leaseUntil: deadlineAt, prompt, token, runId: run.id, ...(execution ? { model: execution.model } : {}) };
  }
  /** Authorize the admitted execution before selecting its stored budget or lane limits. */
  private async claimTimeout(tx: Prisma.TransactionClient, run: RunRow, lane: RunLane, builds: ReturnType<typeof buildSettings> | null) {
    const coding = await tx.executionAttempt.findUnique({ where: { runId: run.id }, include: { run: true } });
    if (coding) {
      if (coding.capabilityRevokedAt) return null;
      await assertExecutionPrincipal(tx, executionPrincipal(coding));
      return (coding.budget as { timeoutMs: number }).timeoutMs;
    }
    return builds ? builds.timeoutMinutes * 60_000 : { foreground: RUN_LIMITS.foregroundTimeoutMs, background: RUN_LIMITS.backgroundTimeoutMs, build: RUN_LIMITS.buildTimeoutMs }[lane];
  }
  private async foregroundHasPriority(tx: Prisma.TransactionClient, now: Date) {
    const { workspaceId } = this;
    return !await tx.run.count({ where: { workspaceId, lane: "foreground", status: "running" } }) && await tx.run.count({ where: { workspaceId, status: "queued", OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }], lane: "foreground" } });
  }
  private async claimOrdinaryQueued(tx: Prisma.TransactionClient, run: RunRow, state: { lane: RunLane; now: Date; today: { sessionId: string | null }[]; timezone: string; builds: ReturnType<typeof buildSettings> | null }) {
    const { lane, now, today, timezone, builds } = state;
    const admission = await this.admitQueued(tx, run, now, { lane, today, timezone });
    if (admission === "blocked") return "blocked" as const;
    if (admission === "skip") return null;
    if (run.sessionId && await tx.run.count({ where: { workspaceId: this.workspaceId, sessionId: run.sessionId, OR: [{ status: "running" }, { error: "Execution stop is unconfirmed" }, { startedAt: { not: null }, execution: { stopConfirmedAt: null } }] } })) return null;
    return this.claimQueued(tx, run, lane, now, builds);
  }
  async claimNext(lane: RunLane, now = this.ports.now(), selection?: ExecutionClaimSelection): Promise<(RunRow & { token: string; runId: string; startedAt: Date; deadlineAt: Date; leaseUntil: Date; model?: string }) | null> {
    const prepared = await prepareServerClaim(this.ports, this.workspaceId, lane, selection);
    try { return await this.ports.db.$transaction(async tx => {
      const { workspaceId } = this;
      await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
      const fresh = this.ports.now();
      const ordinaryBusy = await tx.run.count({ where: { workspaceId, lane, OR: [{ status: "running" }, { error: "Execution stop is unconfirmed" }], execution: null } });
      const eligible = { workspaceId, status: "queued", OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] };
      const settings = (await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings;
      const timezone = budgetTimezone(settings), builds = lane === "build" ? buildSettings(settings) : null;
      const recent = await tx.run.findMany({ where: { workspaceId, execution: null, startedAt: { gte: new Date(now.getTime() - 48 * 3600000), lte: now } }, select: { startedAt: true, sessionId: true } });
      const today = recent.filter(r => r.startedAt && localDayKey(r.startedAt, timezone) === localDayKey(now, timezone));
      const waiting = lane === "build" ? { workspaceId, status: "queued" } : eligible;
      const scope = claimSelection(selection);
      for (const run of await tx.run.findMany({ where: { AND: [{ ...waiting, lane }, scope] }, include: { session: true, execution: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })) {
        if (run.execution) {
          const claimed = await claimExecutionIn(this.ports, tx, run, fresh, prepared);
          if (claimed) return claimed;
          continue;
        }
        if (ordinaryBusy || lane === "background" && await this.foregroundHasPriority(tx, now)) continue;
        const claimed = await this.claimOrdinaryQueued(tx, run, { lane, now, today, timezone, builds });
        if (claimed === "blocked") return null;
        if (claimed) return claimed;
      }
      return null;
    }); } finally { await prepared?.prepared.release(); }
  }
  async finish(runId: string, outcome: RunOutcome, options: { stopEvidence?: "provider_exited" | "never_started" } = {}) {
    const finalized = await this.ports.db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${this.workspaceId}`;
      return this.finishRunIn(tx, runId, outcome, this.ports.now(), options.stopEvidence);
    });
    if (!finalized) return;
    liveRuns.delete(runId);
    await this.ports.onRunFinished?.(this.workspaceId, runId);
  }
  /** Actual Run finalization core, shared with trusted remote ingress; caller holds writer lock. */
  async finishRunIn(tx: Prisma.TransactionClient, runId: string, outcome: RunOutcome, now: Date, evidence?: "provider_exited" | "never_started" | VerifiedDeviceStop): Promise<boolean> {
    const { ports, workspaceId } = this;
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
    else await this.finishOrdinaryRun(tx, run, status);
    await audit(tx, { workspaceId, actor: "chrona", kind: "run_finished", subjectId: runId, details: { status } });
    return true;
  }
  /** Application contexts own delivery and continuation; internal builds only publish lifecycle facts. */
  private async finishOrdinaryRun(tx: Prisma.TransactionClient, run: RunRow, status: string) {
    if (run.lane !== "build" || (status !== "failed" && status !== "timed_out" && status !== "provider_unavailable")) return;
    await notifyLifecycle(tx, this.ports, this.workspaceId, `build-paused:${run.id}`, { kind: "build-paused", status, ...(run.sessionId ? { session: run.sessionId } : {}) });
  }
  async expireLeases(now = this.ports.now()) {
    const rows = await this.ports.db.run.findMany({ where: { workspaceId: this.workspaceId, status: "running", OR: [{ leaseUntil: { lte: now } }, { deadlineAt: { lte: now } }] } });
    for (const row of rows) {
      const state = await this.ports.db.$transaction(async tx => {
        await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${this.workspaceId}`;
        const current = await tx.run.findFirst({ where: { id: row.id, workspaceId: this.workspaceId, status: "running" } });
        if (!current || !runExpired(current, now)) return null;
        const execution = await tx.executionAttempt.findUnique({ where: { runId: row.id }, include: { run: true } });
        if (execution) {
          await tx.executionAttempt.update({ where: { id: execution.id }, data: { capabilityRevokedAt: execution.capabilityRevokedAt ?? now } });
          if (await executionNeverOfferedIn(tx, execution)) {
            await this.finishRunIn(tx, row.id, { outcome: "timed_out", sessionId: null, error: "Run lease expired" }, now, "never_started");
            return { execution, confirmed: true };
          }
        }
        return { execution, confirmed: false };
      });
      if (!state) continue;
      const { execution } = state, handle = liveRuns.get(row.id);
      if (state.confirmed) {
        await this.ports.remoteCompletion?.committed(this.workspaceId, row.id);
        continue;
      }
      if (execution) {
        if (execution.executorId !== "server") {
          // A waiting relay cannot observe remote process exit. Retain capacity and let device stop/reconcile finalize.
          await handle?.abort();
          continue;
        }
        if (handle) {
          try { await handle.abort(); await handle.done; }
          catch { await this.finish(row.id, { outcome: "timed_out", sessionId: null, error: "Execution stop is unconfirmed" }); continue; }
        }
        // liveRuns can contain the prelaunch gate; only tick's actual Provider completion supplies exit proof.
        await this.finish(row.id, { outcome: "timed_out", sessionId: null, error: "Run lease expired" });
      } else {
        await handle?.abort();
        await this.finish(row.id, { outcome: "timed_out", sessionId: null, error: "Run lease expired" });
      }
    }
    return rows.length;
  }
}

function canReconcileStop(evidence: boolean, attempt: boolean, agentContext: boolean, error: string | null) {
  return evidence && (attempt || agentContext && error === "Execution stop is unconfirmed");
}

async function isAgentContext(tx: Prisma.TransactionClient, sessionId: string | null) {
  return !!(sessionId && await tx.audit.findUnique({ where: { id: `agent-context:${sessionId}` } }));
}
