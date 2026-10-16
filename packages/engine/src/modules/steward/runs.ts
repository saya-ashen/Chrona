import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { join } from "node:path";
import type { Prisma } from "@chrona/db";
import { RUN_LIMITS, type ProviderAdapter, type RunLane, type RunTrigger } from "@chrona/contracts/steward";
import { localDayKey } from "@chrona/domain/steward/notify-budget";
import type { StewardPorts } from "./ports";
import { createWorkspaceFs } from "./workspace-fs";
import { requireAffair } from "./affairs";
import { notificationSettings } from "./settings";
import { enqueueNotification } from "./notify";
import { audit } from "./audit";
import { StewardError } from "./errors";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export const liveRuns = new Map<string, ReturnType<ProviderAdapter["start"]>>();
export function nextLocalMidnight(now: Date, timezone: string) {
  const day = localDayKey(now, timezone);
  let lo = now.getTime(), hi = lo + 48 * 3600000;
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (localDayKey(new Date(mid), timezone) === day) lo = mid; else hi = mid; }
  return new Date(hi);
}
export async function canDescribeInactiveAffair(tx: Prisma.TransactionClient, run: { id: string; workspaceId: string }, affairId: string, tool?: string) {
  if (!["chrona_reply", "chrona_ui_set", "chrona_notify"].includes(tool ?? "")) return false;
  const records = await tx.audit.findMany({ where: { workspaceId: run.workspaceId, kind: "affair_updated", subjectId: affairId } });
  return records.some(record => {
    const change = z.object({ runId: z.string(), status: z.enum(["paused", "done"]) }).safeParse(record.details);
    return change.success && change.data.runId === run.id;
  });
}
export async function authenticateRun(tx: Prisma.TransactionClient, token: string, now: Date, tool?: string) {
  const row = await tx.run.findUnique({ where: { tokenHash: hash(token) }, include: { affair: true } });
  if (!row || row.status !== "running" || !row.deadlineAt || row.deadlineAt <= now || !row.leaseUntil || row.leaseUntil <= now) throw new StewardError("forbidden", "Run capability is no longer valid");
  if (row.affair && row.affair.status !== "active" && !await canDescribeInactiveAffair(tx, row, row.affair.id, tool)) throw new StewardError("forbidden", "Affair is not active");
  const { affair, ...run } = row;
  return { run, affair, workspaceId: row.workspaceId };
}
export type EnqueueRun = { affairId?: string; lane: RunLane; trigger: RunTrigger; prompt: string; conversationKey?: string; label?: string | null };
type RunWithAffair = Prisma.RunGetPayload<{ include: { affair: true } }>;
type RunOutcome = Awaited<ReturnType<ProviderAdapter["start"]>["done"]>;

export function createRuns(ports: StewardPorts, workspaceId: string) {
  const runs = new RunService(ports, workspaceId);
  return { enqueue: runs.enqueue.bind(runs), claimNext: runs.claimNext.bind(runs), finish: runs.finish.bind(runs), expireLeases: runs.expireLeases.bind(runs), authenticate: (token: string) => authenticateRun(ports.db, token, ports.now()) };
}

class RunService {
  private readonly fs: ReturnType<typeof createWorkspaceFs>;
  constructor(private readonly ports: StewardPorts, private readonly workspaceId: string) {
    this.fs = createWorkspaceFs(ports.dataDir);
  }
  async enqueue(input: EnqueueRun, tx: Prisma.TransactionClient = this.ports.db) {
    const { ports, workspaceId, fs } = this;
    const affair = input.affairId ? await requireAffair(tx, workspaceId, input.affairId) : null;
    if (affair && affair.status !== "active") throw new StewardError("conflict", "Affair is not active");
    if (input.lane === "background" && !affair) throw new StewardError("invalid", "Background run requires an affair");
    return tx.run.create({ data: { ...input, workspaceId, provider: ports.provider?.name ?? "unconfigured", tokenHash: hash(randomBytes(32).toString("hex")), cwd: affair ? await fs.forAffair(affair.dirName).directory() : join(ports.dataDir, "affairs"), createdAt: ports.now() } });
  }
  async claimNext(lane: RunLane, now = this.ports.now()) {
    return this.ports.db.$transaction(tx => this.claimInTransaction(tx, lane, now));
  }
  private async deferIneligibleRun(tx: Prisma.TransactionClient, run: RunWithAffair, now: Date, timezone: string) {
    const { workspaceId } = this;
    if (run.affair && run.affair.status !== "active") {
      await tx.run.update({ where: { id: run.id }, data: { status: "cancelled", endedAt: now } });
      return true;
    }
    if (run.affairId) {
      const recent = await tx.run.findMany({ where: { workspaceId, affairId: run.affairId, startedAt: { gte: new Date(now.getTime() - 48 * 3600000), lte: now } }, select: { startedAt: true } });
      if (recent.filter(r => r.startedAt && localDayKey(r.startedAt, timezone) === localDayKey(now, timezone)).length >= RUN_LIMITS.maxRunsPerAffairPerDay) {
        await tx.run.update({ where: { id: run.id }, data: { leaseUntil: nextLocalMidnight(now, timezone) } });
        return true;
      }
    }
    return false;
  }
  private async claimInTransaction(tx: Prisma.TransactionClient, lane: RunLane, now: Date) {
    const { workspaceId } = this;
    if (await tx.run.count({ where: { workspaceId, lane, status: "running" } })) return null;
    const eligible = { workspaceId, status: "queued", OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] };
    // Claim foreground first, but a running foreground never blocks background.
    if (lane === "background" && !await tx.run.count({ where: { workspaceId, lane: "foreground", status: "running" } }) && await tx.run.count({ where: { ...eligible, lane: "foreground" } })) return null;
    const timezone = notificationSettings((await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings).timezone;
    for (const run of await tx.run.findMany({ where: { ...eligible, lane }, include: { affair: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })) {
      if (await this.deferIneligibleRun(tx, run, now, timezone)) continue;
      const token = randomBytes(32).toString("hex"), deadlineAt = new Date(now.getTime() + (lane === "foreground" ? RUN_LIMITS.foregroundTimeoutMs : RUN_LIMITS.backgroundTimeoutMs));
      const claimed = await tx.run.updateMany({ where: { id: run.id, status: "queued" }, data: { status: "running", tokenHash: hash(token), startedAt: now, deadlineAt, leaseUntil: deadlineAt } });
      if (!claimed.count) continue;
      await audit(tx, { workspaceId, actor: "chrona", kind: "run_claimed", subjectId: run.id, details: { lane } });
      return { ...run, status: "running", startedAt: now, deadlineAt, leaseUntil: deadlineAt, token, runId: run.id };
    }
    return null;
  }
  async finish(runId: string, outcome: RunOutcome) {
    const { ports, workspaceId } = this, { db } = ports;
    const now = ports.now(), run = await db.run.findFirst({ where: { id: runId, workspaceId }, include: { affair: true } });
    if (!run) throw new StewardError("not_found", "Run not found");
    if (run.status !== "running") return;
    const result = this.finishState(run, outcome, now);
    const changes = await this.commitChanges(run, result);
    const { status, error, foregroundDeadline } = result;
    const chatBound = ports.chat ? await ports.chat.bound() : false;
    const finalized = await db.$transaction(async tx => {
      if (!(await tx.run.updateMany({ where: { id: runId, workspaceId, status: "running" }, data: { status, error: error?.slice(0, 1000), endedAt: now, leaseUntil: null } })).count) return null;
      let deadlineMessage = null;
      await this.recordChanges(tx, run, changes, { now, status, sessionId: outcome.sessionId });
      const history = await tx.run.findMany({ where: { workspaceId, affairId: run.affairId, conversationKey: run.conversationKey, status: { notIn: ["queued", "running"] } }, orderBy: [{ endedAt: "desc" }, { createdAt: "desc" }] });
      let failures = 0;
      for (const prior of history) { if (!["failed", "timed_out", "provider_unavailable"].includes(prior.status)) break; failures++; }
      if (failures === RUN_LIMITS.maxFailures) await enqueueNotification(tx, { workspaceId, affairId: run.affairId ?? undefined, level: "now", title: "处理连续失败", body: "连续三次处理失败，请检查服务状态。", dedupeKey: `run-failed:${runId}` }, { now, chatBound, publicUrl: ports.publicUrl });
      if (foregroundDeadline) {
        deadlineMessage = await this.continueAfterDeadline(tx, run, now);
      } else if (["failed", "timed_out", "provider_unavailable"].includes(status) && (!run.affair || run.affair.status === "active")) {
        // Retry identity is immutable; the attempt status already records why it retried.
        const retry = await tx.run.create({ data: { workspaceId, affairId: run.affairId, conversationKey: run.conversationKey, lane: run.lane, trigger: run.trigger, provider: run.provider, prompt: run.prompt, label: run.label, cwd: run.cwd, tokenHash: hash(randomBytes(32).toString("hex")), createdAt: now, leaseUntil: new Date(now.getTime() + Math.min(30, 2 ** Math.min(failures - 1, 5)) * 60000) } });
        const source = await tx.audit.findFirst({ where: { workspaceId, kind: "chat_run_input", subjectId: run.id } });
        if (source) await audit(tx, { workspaceId, actor: "chrona", kind: "chat_run_input", subjectId: retry.id, details: source.details as Prisma.InputJsonObject });
      }
      await audit(tx, { workspaceId, actor: "chrona", kind: "run_finished", subjectId: runId, details: { status } });
      return { deadlineMessage };
    });
    if (!finalized) return;
    liveRuns.delete(runId);
    if (finalized.deadlineMessage) {
      const message = finalized.deadlineMessage;
      try {
        const adapter = ports.deliveries.find(d => d.channel === message.channel);
        const delivery = adapter ? await adapter.send({ idempotencyKey: `reply:${message.id}`, title: "", body: message.text, link: message.affairId ? `${ports.publicUrl ?? ""}/affairs/${message.affairId}` : null, recipient: null }) : { outcome: "rejected" };
        await audit(db, { workspaceId, actor: "chrona", kind: "deadline_reply_delivery", subjectId: run.id, details: { messageId: message.id, outcome: delivery.outcome } });
      } catch {
        await audit(db, { workspaceId, actor: "chrona", kind: "deadline_reply_delivery", subjectId: run.id, details: { messageId: message.id, outcome: "failed" } });
      }
    }
    await ports.onRunFinished?.(workspaceId, runId);
  }
  async expireLeases(now = this.ports.now()) {
    const { db } = this.ports, { workspaceId } = this;
    const rows = await db.run.findMany({ where: { workspaceId, status: "running", OR: [{ leaseUntil: { lte: now } }, { deadlineAt: { lte: now } }] } });
    for (const row of rows) {
      // Never commit while the Provider may still be writing.
      await liveRuns.get(row.id)?.abort();
      await this.finish(row.id, { outcome: "timed_out", sessionId: null, error: "Run lease expired" });
    }
    return rows.length;
  }
  private finishState(run: RunWithAffair, outcome: RunOutcome, now: Date) {
    // An abort can settle the provider promise before expireLeases calls finish.
    // Persist the timeout rather than misclassifying that race as provider failure.
    const expired = (run.deadlineAt && run.deadlineAt <= now) || (run.leaseUntil && run.leaseUntil <= now);
    const error = expired ? "Run lease expired" : outcome.error;
    const status = expired ? "timed_out" : outcome.outcome === "unavailable" ? "provider_unavailable" : outcome.outcome;
    const foregroundDeadline = run.lane === "foreground" && status === "timed_out" &&
      (!expired || !!(run.deadlineAt && run.deadlineAt <= now));
    return { error, status, foregroundDeadline };
  }
  private async commitMessage(run: RunWithAffair) {
    const reply = run.conversationKey ? await this.ports.db.message.findFirst({ where: { workspaceId: this.workspaceId, conversationKey: run.conversationKey, direction: "out", at: { gte: run.startedAt! } }, orderBy: { at: "asc" } }) : null;
    // Shown in the affair's revision history: say what the work was, not which trigger ran.
    return (run.label ?? reply?.text.split("\n")[0] ?? `Chrona: ${run.trigger}`).slice(0, 500);
  }
  private async recordChanges(tx: Prisma.TransactionClient, run: RunWithAffair, changes: Awaited<ReturnType<RunService["commitChanges"]>>, result: { now: Date; status: string; sessionId: string | null }) {
    for (const change of changes) await this.recordActivity(tx, run, { ...result, sessionId: run.affairId ? result.sessionId : null, ...change });
  }
  private async commitChanges(run: RunWithAffair, result: ReturnType<RunService["finishState"]>) {
    const { ports, workspaceId } = this, { db } = ports;
    const changes: { affairId: string; commit: string | null; paths: string[] }[] = [];
    // A root Provider can create or edit any affair, not only conversation focus.
    const affairs = run.affair ? [run.affair] : await db.affair.findMany({ where: { workspaceId } });
    const message = await this.commitMessage(run);
    for (const affair of affairs) {
      // Another run still writing here commits its own work when it ends; committing now would
      // record its half-finished files under this run's message.
      if (await this.otherRunWriting(run, affair.id, changes)) continue;
      try {
        const files = this.fs.forAffair(affair.dirName);
        const paths = await files.commitAll("chrona", message);
        const commit = paths.length ? (await files.revisions())[0]?.sha ?? null : null;
        if (run.affairId || paths.length || (run.startedAt && affair.createdAt >= run.startedAt)) changes.push({ affairId: affair.id, commit, paths });
      } catch { result.status = "failed"; result.error = "Could not commit affair changes"; }
    }
    return changes;
  }
  /** Records the session without committing when another run is still writing this affair. */
  private async otherRunWriting(run: RunWithAffair, affairId: string, changes: { affairId: string; commit: string | null; paths: string[] }[]) {
    if (!await this.ports.db.run.count({ where: { workspaceId: this.workspaceId, affairId, status: "running", id: { not: run.id } } })) return false;
    if (run.affairId === affairId) changes.push({ affairId, commit: null, paths: [] });
    return true;
  }
  private async recordActivity(tx: Prisma.TransactionClient, run: RunWithAffair, result: { now: Date; status: string; sessionId: string | null; affairId: string; commit: string | null; paths: string[] }) {
    const { workspaceId } = this;
    const { now, status, sessionId, affairId, commit, paths } = result;
    await tx.affair.update({ where: { id: affairId }, data: { lastActivityAt: now, ...(sessionId ? { sessionId } : {}) } });
    await tx.activity.create({ data: { workspaceId, affairId, actor: "chrona", kind: "run", text: `Chrona: ${run.trigger} (${status})`, data: { runId: run.id }, at: now } });
    for (const path of paths) await tx.activity.create({ data: { workspaceId, affairId, actor: "chrona", kind: "edit", text: path, data: { commit, paths: [path] }, at: now } });
  }
  private async deadlineAffair(tx: Prisma.TransactionClient, run: RunWithAffair) {
    const { workspaceId } = this;
    const focus = run.conversationKey ? await tx.audit.findFirst({ where: { workspaceId, kind: "conversation_focus", subjectId: run.conversationKey }, orderBy: { createdAt: "desc" } }) : null;
    const affairId = run.affairId ?? z.object({ affairId: z.string() }).safeParse(focus?.details).data?.affairId;
    return affairId ? await tx.affair.findFirst({ where: { workspaceId, id: affairId, status: "active" } }) : null;
  }
  private async continueAfterDeadline(tx: Prisma.TransactionClient, run: RunWithAffair, now: Date) {
    const { workspaceId } = this;
    const affair = await this.deadlineAffair(tx, run);
    if (affair) await this.enqueue({ affairId: affair.id, conversationKey: run.conversationKey ?? undefined, lane: "background", trigger: run.trigger as RunTrigger, prompt: run.prompt }, tx);
    const replied = await tx.audit.findFirst({ where: { workspaceId, kind: "run_reply", subjectId: run.id } });
    const conversation = !replied && run.conversationKey ? await tx.message.findFirst({ where: { workspaceId, conversationKey: run.conversationKey }, orderBy: { at: "desc" } }) : null;
    if (!conversation) return null;
    const deadlineMessage = await tx.message.create({ data: { workspaceId, conversationKey: run.conversationKey!, channel: conversation.channel, direction: "out", affairId: affair?.id, text: affair ? "这次处理超时了，我会在后台继续。" : "这次处理超时了，尚未关联事务，无法在后台继续。请再试一次。", at: now } });
    await audit(tx, { workspaceId, actor: "chrona", kind: "run_reply", subjectId: run.id, details: { messageId: deadlineMessage.id, reason: "deadline" } });
    return deadlineMessage;
  }
}
