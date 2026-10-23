import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Prisma } from "@chrona/db";
import { RUN_LIMITS, type ProviderAdapter, type RunLane, type RunTrigger, type SessionSource } from "@chrona/contracts/steward";
import { localDayKey } from "@chrona/domain/steward/notify-budget";
import type { StewardPorts } from "./ports";
import { notificationSettings } from "./settings";
import { enqueueNotification } from "./notify";
import { audit } from "./audit";
import { StewardError } from "./errors";
import { providerCancelKey } from "./provider-journal";
import { settleBuildAttempt } from "./module-build-lane";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export const liveRuns = new Map<string, ReturnType<ProviderAdapter["start"]>>();
export function nextLocalMidnight(now: Date, timezone: string) {
  const day = localDayKey(now, timezone);
  let lo = now.getTime(), hi = lo + 48 * 3600000;
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (localDayKey(new Date(mid), timezone) === day) lo = mid; else hi = mid; }
  return new Date(hi);
}
export async function authenticateRun(tx: Prisma.TransactionClient, token: string, now: Date, _tool?: string) {
  const row = await tx.run.findUnique({ where: { tokenHash: hash(token) }, include: { session: true } });
  if (!row || row.status !== "running" || !row.deadlineAt || row.deadlineAt <= now || !row.leaseUntil || row.leaseUntil <= now || await tx.audit.findUnique({ where: { id: providerCancelKey(row.id) } })) throw new StewardError("forbidden", "Run capability is no longer valid");
  const { session, ...run } = row;
  return { run, session, workspaceId: row.workspaceId };
}
export type EnqueueRun = { sessionId?: string; lane: RunLane; trigger: RunTrigger; prompt: string; label?: string | null };
type RunRow = Prisma.RunGetPayload<{ include: { session: true } }>;
type RunOutcome = Awaited<ReturnType<ProviderAdapter["start"]>["done"]>;

/** Called by module wakeProvider; every invocation starts an independent context. */
export async function enqueueModuleWake(ports: StewardPorts, workspaceId: string, moduleId: string, prompt: string) {
  if (!await ports.db.module.findFirst({ where: { id: moduleId, workspaceId, status: "active" } })) throw new StewardError("not_found", "Active module not found");
  return ports.db.$transaction(async tx => {
    const session = await createRunSession(tx, workspaceId, "module", ports.now(), { moduleId });
    return createRuns(ports, workspaceId).enqueue({ sessionId: session.id, lane: "background", trigger: "source", prompt }, tx);
  });
}
export function createRunSession(tx: Prisma.TransactionClient, workspaceId: string, source: SessionSource, now: Date, origin: { originSessionId?: string; moduleId?: string } = {}) {
  return tx.session.create({ data: { workspaceId, key: `${source}:${randomUUID()}`, source, ...origin, createdAt: now, lastActivityAt: now } });
}
export function createRuns(ports: StewardPorts, workspaceId: string) {
  const runs = new RunService(ports, workspaceId);
  return { enqueue: runs.enqueue.bind(runs), claimNext: runs.claimNext.bind(runs), finish: runs.finish.bind(runs), expireLeases: runs.expireLeases.bind(runs), authenticate: (token: string) => authenticateRun(ports.db, token, ports.now()) };
}
class RunService {
  constructor(private readonly ports: StewardPorts, private readonly workspaceId: string) {}
  async enqueue(input: EnqueueRun, tx: Prisma.TransactionClient = this.ports.db) {
    const { ports, workspaceId } = this;
    const session = input.sessionId ? await tx.session.findFirst({ where: { id: input.sessionId, workspaceId, status: "active" } }) : null;
    if (input.sessionId && !session) throw new StewardError("not_found", "Active session not found");
    if (!session && input.lane !== "build") throw new StewardError("invalid", "Run requires a session");
    const cwd = join(ports.dataDir, "sessions", session?.id ?? randomUUID());
    await mkdir(cwd, { recursive: true });
    return tx.run.create({ data: { ...input, workspaceId, provider: ports.provider?.name ?? "unconfigured", tokenHash: hash(randomBytes(32).toString("hex")), cwd, createdAt: ports.now() } });
  }
  async claimNext(lane: RunLane, now = this.ports.now()) {
    return this.ports.db.$transaction(async tx => {
      const { workspaceId } = this;
      if (await tx.run.count({ where: { workspaceId, lane, status: "running" } })) return null;
      const eligible = { workspaceId, status: "queued", OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] };
      if (lane === "background" && !await tx.run.count({ where: { workspaceId, lane: "foreground", status: "running" } }) && await tx.run.count({ where: { ...eligible, lane: "foreground" } })) return null;
      const timezone = notificationSettings((await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings).timezone;
      const recent = await tx.run.findMany({ where: { workspaceId, startedAt: { gte: new Date(now.getTime() - 48 * 3600000), lte: now } }, select: { startedAt: true, sessionId: true } });
      const today = recent.filter(r => r.startedAt && localDayKey(r.startedAt, timezone) === localDayKey(now, timezone));
      for (const run of await tx.run.findMany({ where: { ...eligible, lane }, include: { session: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })) {
        if ((run.session && run.session.status !== "active") || await tx.audit.findUnique({ where: { id: providerCancelKey(run.id) } })) {
          await tx.run.update({ where: { id: run.id }, data: { status: "cancelled", endedAt: now } }); continue;
        }
        if (today.length >= RUN_LIMITS.maxRunsPerDay || (run.sessionId && today.filter(r => r.sessionId === run.sessionId).length >= RUN_LIMITS.maxRunsPerSessionPerDay)) {
          await tx.run.update({ where: { id: run.id }, data: { leaseUntil: nextLocalMidnight(now, timezone) } }); continue;
        }
        if (run.sessionId && await tx.run.count({ where: { workspaceId, sessionId: run.sessionId, status: "running" } })) continue;
        const token = randomBytes(32).toString("hex"), deadlineAt = new Date(now.getTime() + { foreground: RUN_LIMITS.foregroundTimeoutMs, background: RUN_LIMITS.backgroundTimeoutMs, build: RUN_LIMITS.buildTimeoutMs }[lane]);
        if (!(await tx.run.updateMany({ where: { id: run.id, status: "queued" }, data: { status: "running", tokenHash: hash(token), startedAt: now, deadlineAt, leaseUntil: deadlineAt } })).count) continue;
        await audit(tx, { workspaceId, actor: "chrona", kind: "run_claimed", subjectId: run.id, details: { lane } });
        return { ...run, status: "running", startedAt: now, deadlineAt, leaseUntil: deadlineAt, token, runId: run.id };
      }
      return null;
    });
  }
  async finish(runId: string, outcome: RunOutcome) {
    const { ports, workspaceId } = this, { db } = ports, now = ports.now();
    const run = await db.run.findFirst({ where: { id: runId, workspaceId }, include: { session: true } });
    if (!run) throw new StewardError("not_found", "Run not found");
    if (run.status !== "running") return;
    const expired = !!((run.deadlineAt && run.deadlineAt <= now) || (run.leaseUntil && run.leaseUntil <= now));
    const chatBound = ports.chat ? await ports.chat.bound() : false;
    const finalized = await db.$transaction(async tx => {
      const cancelled = !!await tx.audit.findUnique({ where: { id: providerCancelKey(runId) } });
      const status = cancelled ? "cancelled" : expired ? "timed_out" : outcome.outcome === "unavailable" ? "provider_unavailable" : outcome.outcome;
      const error = cancelled ? "Cancelled by owner" : expired ? "Run lease expired" : outcome.error;
      if (!(await tx.run.updateMany({ where: { id: runId, workspaceId, status: "running" }, data: { status, error: error?.slice(0, 1000), endedAt: now, leaseUntil: null } })).count) return false;
      if (run.sessionId) await tx.session.update({ where: { id: run.sessionId }, data: { lastActivityAt: now, ...(outcome.sessionId ? { providerSessionId: outcome.sessionId } : {}) } });
      if (run.lane !== "build") {
        if (status === "finished") await this.deliverResult(tx, run, now, chatBound);
        await this.followUp(tx, run, status, now, chatBound);
      }
      await audit(tx, { workspaceId, actor: "chrona", kind: "run_finished", subjectId: runId, details: { status } });
      return true;
    });
    if (!finalized) return;
    liveRuns.delete(runId);
    await settleBuildAttempt(ports, workspaceId, runId);
    await ports.onRunFinished?.(workspaceId, runId);
  }
  private async deliverResult(tx: Prisma.TransactionClient, run: RunRow, now: Date, chatBound: boolean) {
    const session = run.session;
    if (!session || !["wake", "module"].includes(session.source)) return;
    const receipts = await tx.audit.findMany({ where: { workspaceId: this.workspaceId, kind: "run_reply", subjectId: run.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const ids = receipts.flatMap(receipt => {
      const details = receipt.details as { messageId?: unknown } | null;
      return typeof details?.messageId === "string" ? [details.messageId] : [];
    });
    const replies = await tx.message.findMany({ where: { workspaceId: this.workspaceId, sessionId: session.id, id: { in: ids } } });
    const ordered = ids.flatMap(id => replies.filter(reply => reply.id === id));
    if (!ordered.length) return;
    if (session.originSessionId) {
      const origin = await tx.session.findFirst({ where: { id: session.originSessionId, workspaceId: this.workspaceId } });
      if (!origin) throw new StewardError("not_found", "Origin session not found");
      const latest = await tx.message.findFirst({ where: { sessionId: origin.id }, orderBy: [{ at: "desc" }, { id: "desc" }] });
      for (const reply of ordered) await tx.message.create({ data: { workspaceId: this.workspaceId, sessionId: origin.id, channel: latest?.channel ?? "in_app", direction: "out", text: reply.text, attachments: reply.attachments as Prisma.InputJsonValue, at: now } });
      await tx.session.update({ where: { id: origin.id }, data: { lastActivityAt: now } });
    }
    const notification = await enqueueNotification(tx, { workspaceId: this.workspaceId, level: "now", title: session.title ?? run.label ?? "后台处理完成", body: ordered.map(reply => reply.text).join("\n\n").slice(0, 4000), dedupeKey: `session-result:${run.id}` }, { now, chatBound, publicUrl: this.ports.publicUrl });
    await tx.notification.update({ where: { id: notification.id }, data: { sessionId: session.originSessionId ?? session.id, moduleId: session.moduleId } });
  }
  private async followUp(tx: Prisma.TransactionClient, run: RunRow, status: string, now: Date, chatBound: boolean) {
    const { workspaceId, ports } = this;
    if (["failed", "timed_out", "provider_unavailable"].includes(status)) {
      const history = await tx.run.findMany({ where: { workspaceId, sessionId: run.sessionId, status: { notIn: ["queued", "running"] } }, orderBy: [{ endedAt: "desc" }, { createdAt: "desc" }] });
      let failures = 0;
      for (const prior of history) { if (!["failed", "timed_out", "provider_unavailable"].includes(prior.status)) break; failures++; }
      if (failures === RUN_LIMITS.maxFailures) await enqueueNotification(tx, { workspaceId, level: "now", title: "处理连续失败", body: "连续三次处理失败，请检查服务状态。", dedupeKey: `run-failed:${run.id}` }, { now, chatBound, publicUrl: ports.publicUrl });
      const retry = await tx.run.create({ data: { workspaceId, sessionId: run.sessionId, lane: run.lane, trigger: run.trigger, provider: run.provider, prompt: run.prompt, label: run.label, cwd: run.cwd, tokenHash: hash(randomBytes(32).toString("hex")), createdAt: now, leaseUntil: new Date(now.getTime() + Math.min(30, 2 ** Math.min(failures - 1, 5)) * 60000) } });
      await audit(tx, { workspaceId, actor: "chrona", kind: "run_continuation", subjectId: run.id, details: { runId: retry.id } });
      const source = await tx.audit.findFirst({ where: { workspaceId, kind: "chat_run_input", subjectId: run.id } });
      if (source) await audit(tx, { workspaceId, actor: "chrona", kind: "chat_run_input", subjectId: retry.id, details: source.details as Prisma.InputJsonObject });
    }
  }
  async expireLeases(now = this.ports.now()) {
    const rows = await this.ports.db.run.findMany({ where: { workspaceId: this.workspaceId, status: "running", OR: [{ leaseUntil: { lte: now } }, { deadlineAt: { lte: now } }] } });
    for (const row of rows) {
      await liveRuns.get(row.id)?.abort();
      await this.finish(row.id, { outcome: "timed_out", sessionId: null, error: "Run lease expired" });
    }
    return rows.length;
  }
}
