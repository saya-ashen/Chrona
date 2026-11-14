import { finishRunIn, runExpired } from "./run-finish";
import { liveRuns } from "./run-live";
import { claimApplicationExecutionIn } from "./execution-delivery-claim";
import type { VerifiedExecutionStop } from "./execution-delivery-stop-types";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Prisma } from "@chrona/db";
import { RUN_LIMITS, type ProviderAdapter, type RunLane, type RunTrigger, type SessionSource } from "@chrona/contracts/steward";
import { localDayKey } from "@chrona/domain/steward/local-day";
import type { ExecutionClaimSelection, StewardPorts } from "./ports";
import { buildSettings, budgetTimezone, runTimeoutMinutes } from "./settings";
import { audit } from "./audit";
import { StewardError } from "./errors";
import { authenticateRun } from "./run-auth";
import { assertExternalName } from "./module-identity";
import { declaredModules } from "./module-build-targets";
import { executionPrincipal, executionNeverOfferedIn } from "./execution-state";
import { claimExecutionIn, prepareServerClaim } from "./execution-claim";
import { assertExecutionPrincipal } from "./execution-principal";
import { bindQueuedProviderIn, providerCompletionBudgetSchema } from "./agent-provider";

export { liveRuns } from "./run-live";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export function nextLocalMidnight(now: Date, timezone: string) {
  const day = localDayKey(now, timezone);
  let lo = now.getTime(), hi = lo + 48 * 3600000;
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (localDayKey(new Date(mid), timezone) === day) lo = mid; else hi = mid; }
  return new Date(hi);
}
export { authenticateRun } from "./run-auth";
export type EnqueueRun = { sessionId?: string; lane: RunLane; trigger: RunTrigger; prompt: string; label?: string | null; providerId?: string; providerOptions?: Prisma.InputJsonObject };
type RunRow = Prisma.RunGetPayload<{ include: { session: true } }>;
type RunOutcome = Awaited<ReturnType<ProviderAdapter["start"]>["done"]>;

async function completionTimeout(tx: Prisma.TransactionClient, runId: string, timeoutMs: number | null) {
  const binding = await tx.agentRunProvider.findUnique({ where: { runId } });
  if (binding?.kind === "completion") {
    const budget = providerCompletionBudgetSchema.parse(binding.completion);
    timeoutMs = Math.min(timeoutMs ?? Infinity, budget.limits.eventTimeoutMs);
  }
  return timeoutMs;
}

function claimSelection(selection?: ExecutionClaimSelection): Prisma.RunWhereInput {
  if (selection?.kind === "ordinary") return { execution: null };
  if (selection?.kind === "application") return { execution: { placement: { path: "$.kind", equals: "application" } } };
  if (selection?.kind === "execution") return { execution: { executorId: selection.executorId, targetBinding: { equals: Prisma.DbNull } } };
  return { OR: [{ execution: null }, { execution: { executorId: "server", targetBinding: { equals: Prisma.DbNull } } }] };
}
export function createRunSession(tx: Prisma.TransactionClient, workspaceId: string, source: SessionSource, now: Date, origin: { originSessionId?: string; moduleId?: string } = {}) {
  return tx.session.create({ data: { workspaceId, key: `${source}:${randomUUID()}`, source, ...origin, createdAt: now, lastActivityAt: now } });
}
/** Coding admission already owns its writer transaction; logs are created by the launch/capture path. */
export async function enqueueExecutionRunIn(ports: StewardPorts, tx: Prisma.TransactionClient, input: { workspaceId: string; sessionId: string; prompt: string; cwd: string; now: Date }) {
  const run = await tx.run.create({ data: { workspaceId: input.workspaceId, sessionId: input.sessionId, prompt: input.prompt, cwd: input.cwd, lane: "background", trigger: "source", provider: "unconfigured", tokenHash: hash(randomBytes(32).toString("hex")), createdAt: input.now } });
  await bindQueuedProviderIn(tx, input.workspaceId, run.id);
  return run;
}
export function createRuns(ports: StewardPorts, workspaceId: string) {
  const runs = new RunService(ports, workspaceId);
  return { enqueue: runs.enqueue.bind(runs), claimNext: runs.claimNext.bind(runs), finish: runs.finish.bind(runs), finishRunIn: runs.finishRunIn.bind(runs), expireLeases: runs.expireLeases.bind(runs), authenticate: (token: string) => authenticateRun(ports.db, token, ports.now()) };
}
class RunService {
  constructor(private readonly ports: StewardPorts, private readonly workspaceId: string) {}
  async enqueue(input: EnqueueRun, tx?: Prisma.TransactionClient): Promise<Prisma.RunGetPayload<Record<string, never>>> {
    const { ports, workspaceId } = this;
    if (!tx) return ports.db.$transaction(writer => this.enqueue(input, writer));
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
    const session = input.sessionId ? await tx.session.findFirst({ where: { id: input.sessionId, workspaceId, status: "active" } }) : null;
    if (input.sessionId && !session) throw new StewardError("not_found", "Active session not found");
    if (!session) throw new StewardError("invalid", "Run requires a session");
    if (session.source === "module") {
      const module = session.moduleId ? await tx.module.findFirst({ where: { id: session.moduleId, workspaceId, status: "active", executionFenceAt: null }, select: { id: true, activeHash: true } }) : null;
      const version = module?.activeHash ? await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } }, select: { status: true } }) : null;
      if (version?.status !== "approved") throw new StewardError("forbidden", "Run session module is no longer approved and active for new work");
    }
    const cwd = join(ports.dataDir, "sessions", session.id);
    await mkdir(cwd, { recursive: true });
    // The clock may tie or move backwards; builds still enter FIFO in admission order.
    const tail = input.lane === "build" ? await tx.run.findFirst({ where: { workspaceId, lane: "build" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }) : null;
    const createdAt = new Date(Math.max(ports.now().getTime(), tail ? tail.createdAt.getTime() + 1 : 0));
    const { providerId, providerOptions, ...record } = input;
    const run = await tx.run.create({ data: { ...record, workspaceId, provider: "unconfigured", tokenHash: hash(randomBytes(32).toString("hex")), cwd, createdAt } });
    const context = await tx.agentContext.findUnique({ where: { sessionId: session.id } });
    // Public Agent admission writes its explicitly selected binding in this same transaction.
    if (!context?.providerId) await bindQueuedProviderIn(tx, workspaceId, run.id, providerId, providerOptions);
    return run;
  }
  private async admitQueued(tx: Prisma.TransactionClient, run: RunRow, now: Date, { lane, today, timezone }: { lane: RunLane; today: { sessionId: string | null }[]; timezone: string }) {
    if ((run.session && run.session.status !== "active") || run.cancelRequestedAt) {
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
  private async claimQueued(tx: Prisma.TransactionClient, run: RunRow, now: Date, builds: ReturnType<typeof buildSettings> | null, ordinaryTimeoutMinutes: number | null) {
    if (run.lane === "build" && !await this.checkBuildTargets(tx, run, now)) return null;
    const requestedTimeout = await this.claimTimeout(tx, run, builds, ordinaryTimeoutMinutes);
    if (requestedTimeout === undefined) return null;
    const timeoutMs = await completionTimeout(tx, run.id, requestedTimeout);
    const token = randomBytes(32).toString("hex"), deadlineAt = timeoutMs === null ? null : new Date(now.getTime() + timeoutMs);
    const prompt = builds ? `${run.prompt}\n\nCurrent kernel limits for this run (override earlier numeric build limits): at most ${builds.maxSubmissions} candidate submissions; deadline ${deadlineAt!.toISOString()} (${builds.timeoutMinutes} minutes). Report before the deadline; do not start an automatic continuation.` : run.prompt;
    if (!(await tx.run.updateMany({ where: { id: run.id, status: "queued" }, data: { status: "running", tokenHash: hash(token), startedAt: now, deadlineAt, leaseUntil: deadlineAt, prompt } })).count) return null;
    await audit(tx, { workspaceId: this.workspaceId, actor: "chrona", kind: "run_claimed", subjectId: run.id, details: { lane: run.lane, ...(builds ? { builds } : {}) } });
    return { ...run, status: "running", startedAt: now, deadlineAt, leaseUntil: deadlineAt, prompt, token, runId: run.id };
  }
  /** Authorize the admitted execution before selecting its stored budget or lane limits. */
  private async claimTimeout(tx: Prisma.TransactionClient, run: RunRow, builds: ReturnType<typeof buildSettings> | null, ordinaryTimeoutMinutes: number | null) {
    const coding = await tx.executionAttempt.findUnique({ where: { runId: run.id }, include: { run: true } });
    if (coding) {
      if (coding.capabilityRevokedAt) return undefined;
      await assertExecutionPrincipal(tx, executionPrincipal(coding));
      return (coding.budget as { timeoutMs: number }).timeoutMs;
    }
    if (builds) return builds.timeoutMinutes * 60_000;
    if (run.lane === "build") return RUN_LIMITS.buildTimeoutMs;
    return ordinaryTimeoutMinutes === null ? null : ordinaryTimeoutMinutes * 60_000;
  }
  private async foregroundHasPriority(tx: Prisma.TransactionClient, now: Date) {
    const { workspaceId } = this;
    return !await tx.run.count({ where: { workspaceId, lane: "foreground", status: "running" } }) && await tx.run.count({ where: { workspaceId, status: "queued", OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }], lane: "foreground" } });
  }
  private async claimOrdinaryQueued(tx: Prisma.TransactionClient, run: RunRow, state: { lane: RunLane; now: Date; today: { sessionId: string | null }[]; timezone: string; builds: ReturnType<typeof buildSettings> | null; ordinaryTimeoutMinutes: number | null }) {
    const { lane, now, today, timezone, builds, ordinaryTimeoutMinutes } = state;
    const admission = await this.admitQueued(tx, run, now, { lane, today, timezone });
    if (admission === "blocked") return "blocked" as const;
    if (admission === "skip") return null;
    if (run.sessionId && await tx.run.count({ where: { workspaceId: this.workspaceId, sessionId: run.sessionId, OR: [{ status: "running" }, { stopStatus: "unknown" }, { startedAt: { not: null }, execution: { stopConfirmedAt: null } }] } })) return null;
    return this.claimQueued(tx, run, now, builds, ordinaryTimeoutMinutes);
  }
  async claimNext(lane: RunLane, now = this.ports.now(), selection?: ExecutionClaimSelection): Promise<(RunRow & { token: string; runId: string; startedAt: Date; deadlineAt: Date | null; leaseUntil: Date | null; model?: string }) | null> {
    const prepared = await prepareServerClaim(this.ports, this.workspaceId, lane, selection);
    try { return await this.ports.db.$transaction(async tx => {
      const { workspaceId } = this;
      await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
      const fresh = this.ports.now();
      const ordinaryBusy = await tx.run.count({ where: { workspaceId, lane, OR: [{ status: "running" }, { stopStatus: "unknown" }], execution: null } });
      const eligible = { workspaceId, status: "queued", OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] };
      const settings = (await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings;
      const timezone = budgetTimezone(settings), builds = lane === "build" ? buildSettings(settings) : null;
      const ordinaryTimeoutMinutes = runTimeoutMinutes(settings);
      const recent = await tx.run.findMany({ where: { workspaceId, execution: null, startedAt: { gte: new Date(now.getTime() - 48 * 3600000), lte: now } }, select: { startedAt: true, sessionId: true } });
      const today = recent.filter(r => r.startedAt && localDayKey(r.startedAt, timezone) === localDayKey(now, timezone));
      const waiting = lane === "build" ? { workspaceId, status: "queued" } : eligible;
      const scope = claimSelection(selection);
      for (const run of await tx.run.findMany({ where: { AND: [{ ...waiting, lane }, scope] }, include: { session: true, execution: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })) {
        if (run.execution) {
          const claimed = run.execution.targetBinding ? await claimApplicationExecutionIn(this.ports, tx, run, fresh) : await claimExecutionIn(this.ports, tx, run, fresh, prepared);
          if (claimed) return claimed;
          continue;
        }
        if (ordinaryBusy || lane === "background" && await this.foregroundHasPriority(tx, now)) continue;
        const claimed = await this.claimOrdinaryQueued(tx, run, { lane, now, today, timezone, builds, ordinaryTimeoutMinutes });
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
  async finishRunIn(tx: Prisma.TransactionClient, runId: string, outcome: RunOutcome, now: Date, evidence?: "provider_exited" | "never_started" | VerifiedExecutionStop): Promise<boolean> {
    return finishRunIn(this.ports, this.workspaceId, tx, runId, outcome, now, evidence);
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
        continue;
      }
      if (execution) {
        if (execution.targetBinding) {
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
