import { finishRunIn, runExpired } from "./run-finish";
import { liveRuns } from "./run-live";
import { createHash, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Prisma } from "@chrona/db";
import { RUN_LIMITS, type ProviderAdapter, type RunLane, type RunTrigger } from "@chrona/contracts/steward";
import { localDayKey } from "@chrona/domain/steward/local-day";
import type { StewardPorts } from "../ports";
import { budgetTimezone, runTimeoutMinutes } from "../settings";
import { audit } from "../audit";
import { StewardError } from "../errors";
import { authenticateRun } from "./run-auth";
import { bindQueuedProviderIn, providerCompletionBudgetSchema } from "../agent/agent-provider";

export { liveRuns } from "./run-live";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export function nextLocalMidnight(now: Date, timezone: string) {
  const day = localDayKey(now, timezone);
  let lo = now.getTime(), hi = lo + 48 * 3600000;
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (localDayKey(new Date(mid), timezone) === day) lo = mid; else hi = mid; }
  return new Date(hi);
}
export { authenticateRun } from "./run-auth";
type EnqueueRun = { sessionId?: string; lane: RunLane; trigger: RunTrigger; prompt: string; label?: string | null; cwd?: string; providerId?: string; providerOptions?: Prisma.InputJsonObject };
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
    const context = input.sessionId ? await tx.agentContext.findFirst({ where: { id: input.sessionId, workspaceId, status: "active" } }) : null;
    if (!context) throw new StewardError(input.sessionId ? "not_found" : "invalid", "Active Agent context not found");
    if (!context.moduleId) throw new StewardError("forbidden", "Agent context owner is missing");
    const module = await tx.module.findFirst({ where: { id: context.moduleId, workspaceId, activeHash: context.hash, status: "active", executionFenceAt: null }, select: { id: true } });
    const version = module ? await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: context.hash } }, select: { status: true } }) : null;
    if (version?.status !== "approved") throw new StewardError("forbidden", "Agent context module is no longer its approved active version for new work");
    const cwd = input.cwd ?? join(ports.dataDir, "sessions", context.id);
    await mkdir(cwd, { recursive: true });
    const { providerId, providerOptions, ...record } = input;
    const run = await tx.run.create({ data: { ...record, workspaceId, provider: "unconfigured", tokenHash: hash(randomBytes(32).toString("hex")), cwd, createdAt: ports.now() } });
    // Public Agent admission writes its explicitly selected binding in this same transaction.
    if (!context.providerId) await bindQueuedProviderIn(tx, workspaceId, run.id, providerId, providerOptions);
    return run;
  }
  private async admitQueued(tx: Prisma.TransactionClient, run: RunRow, now: Date, today: { sessionId: string | null }[], timezone: string) {
    if ((run.session && run.session.status !== "active") || run.cancelRequestedAt) {
      await this.finishRunIn(tx, run.id, { outcome: "cancelled", sessionId: null, error: "Run session ended or owner cancelled" }, now, "never_started");
      return false;
    }
    if (today.length >= RUN_LIMITS.maxRunsPerDay || (run.sessionId && today.filter(r => r.sessionId === run.sessionId).length >= RUN_LIMITS.maxRunsPerSessionPerDay)) {
      await tx.run.update({ where: { id: run.id }, data: { leaseUntil: nextLocalMidnight(now, timezone) } });
      return false;
    }
    return true;
  }
  private async claimQueued(tx: Prisma.TransactionClient, run: RunRow, now: Date, timeoutMinutes: number | null) {
    const timeoutMs = await completionTimeout(tx, run.id, timeoutMinutes === null ? null : timeoutMinutes * 60_000);
    const token = randomBytes(32).toString("hex"), deadlineAt = timeoutMs === null ? null : new Date(now.getTime() + timeoutMs);
    if (!(await tx.run.updateMany({ where: { id: run.id, status: "queued" }, data: { status: "running", tokenHash: hash(token), startedAt: now, deadlineAt, leaseUntil: deadlineAt } })).count) return null;
    await audit(tx, { workspaceId: this.workspaceId, actor: "chrona", kind: "run_claimed", subjectId: run.id, details: { lane: run.lane } });
    return { ...run, status: "running", startedAt: now, deadlineAt, leaseUntil: deadlineAt, token, runId: run.id };
  }
  private async foregroundHasPriority(tx: Prisma.TransactionClient, now: Date) {
    const { workspaceId } = this;
    return !await tx.run.count({ where: { workspaceId, lane: "foreground", OR: [{ status: "running" }, { stopStatus: "unknown" }] } }) && await tx.run.count({ where: { workspaceId, status: "queued", OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }], lane: "foreground" } });
  }
  async claimNext(lane: RunLane, now = this.ports.now()): Promise<(RunRow & { token: string; runId: string; startedAt: Date; deadlineAt: Date | null; leaseUntil: Date | null }) | null> {
    return this.ports.db.$transaction(async tx => {
      const { workspaceId } = this;
      await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
      const busy = await tx.run.count({ where: { workspaceId, lane, OR: [{ status: "running" }, { stopStatus: "unknown" }] } });
      if (busy || lane === "background" && await this.foregroundHasPriority(tx, now)) return null;
      const settings = (await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings;
      const timezone = budgetTimezone(settings), timeoutMinutes = runTimeoutMinutes(settings);
      const recent = await tx.run.findMany({ where: { workspaceId, startedAt: { gte: new Date(now.getTime() - 48 * 3600000), lte: now } }, select: { startedAt: true, sessionId: true } });
      const today = recent.filter(r => r.startedAt && localDayKey(r.startedAt, timezone) === localDayKey(now, timezone));
      const waiting = { workspaceId, lane, status: "queued", OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] };
      for (const run of await tx.run.findMany({ where: waiting, include: { session: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })) {
        if (!await this.admitQueued(tx, run, now, today, timezone)) continue;
        if (run.sessionId && await tx.run.count({ where: { workspaceId, sessionId: run.sessionId, OR: [{ status: "running" }, { stopStatus: "unknown" }] } })) continue;
        const claimed = await this.claimQueued(tx, run, now, timeoutMinutes);
        if (claimed) return claimed;
      }
      return null;
    });
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
  async finishRunIn(tx: Prisma.TransactionClient, runId: string, outcome: RunOutcome, now: Date, evidence?: "provider_exited" | "never_started"): Promise<boolean> {
    return finishRunIn(this.ports, this.workspaceId, tx, runId, outcome, now, evidence);
  }
  async expireLeases(now = this.ports.now()) {
    const rows = await this.ports.db.run.findMany({ where: { workspaceId: this.workspaceId, status: "running", OR: [{ leaseUntil: { lte: now } }, { deadlineAt: { lte: now } }] } });
    for (const row of rows) {
      const expired = await this.ports.db.$transaction(async tx => {
        await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${this.workspaceId}`;
        const current = await tx.run.findFirst({ where: { id: row.id, workspaceId: this.workspaceId, status: "running" } });
        return !!current && runExpired(current, now);
      });
      if (!expired) continue;
      try { await liveRuns.get(row.id)?.abort(); }
      catch (error) { console.error(JSON.stringify({ component: "runs", event: "expired_run_abort.failed", runId: row.id, error: String(error) })); }
      await this.finish(row.id, { outcome: "timed_out", sessionId: null, error: "Run lease expired" });
    }
    return rows.length;
  }
}
