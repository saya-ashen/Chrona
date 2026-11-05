import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Prisma } from "@chrona/db";
import { RUN_LIMITS, type ProviderAdapter, type RunLane, type RunTrigger, type SessionSource } from "@chrona/contracts/steward";
import { localDayKey } from "@chrona/domain/steward/local-day";
import type { StewardPorts } from "./ports";
import { buildSettings, notificationSettings } from "./settings";
import { notifyUser } from "./notify-user";
import { pushReply } from "./chat-replies";
import { audit } from "./audit";
import { StewardError } from "./errors";
import { providerCancelKey } from "./provider-journal";
import { assertBuildProvider, buildExecution } from "./build-execution";
import { appendBuildOutcome, buildOutcomeLine } from "./module-build-outcome";

const BUILD_IDLE_MS = 7 * 24 * 3600_000, MCP_IDLE_MS = 24 * 3600_000;

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
/** Consecutive build results that wake their conversation before the user speaks again. */
const BUILD_WAKES = 5;
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
  return { enqueue: runs.enqueue.bind(runs), claimNext: runs.claimNext.bind(runs), finish: runs.finish.bind(runs), expireLeases: runs.expireLeases.bind(runs), endIdleBuilds: runs.endIdleBuilds.bind(runs), authenticate: (token: string) => authenticateRun(ports.db, token, ports.now()) };
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
  private async claimQueued(tx: Prisma.TransactionClient, run: RunRow, lane: RunLane, now: Date, builds: ReturnType<typeof buildSettings> | null) {
    const execution = lane === "build" ? await buildExecution(tx, run.id) : null;
    if (execution) {
      try { assertBuildProvider(this.ports, execution); }
      catch {
        await tx.run.update({ where: { id: run.id }, data: { status: "failed", endedAt: now, error: "Authorized build Provider/model pin is unavailable" } });
        return null;
      }
      builds = { ...builds!, timeoutMinutes: execution.timeoutMinutes, maxSubmissions: execution.maxSubmissions };
    }
    const token = randomBytes(32).toString("hex"), deadlineAt = new Date(now.getTime() + (builds ? builds.timeoutMinutes * 60_000 : { foreground: RUN_LIMITS.foregroundTimeoutMs, background: RUN_LIMITS.backgroundTimeoutMs, build: RUN_LIMITS.buildTimeoutMs }[lane]));
    const prompt = builds ? `${run.prompt}\n\nCurrent kernel limits for this run (override earlier numeric build limits): at most ${builds.maxSubmissions} candidate submissions; deadline ${deadlineAt.toISOString()} (${builds.timeoutMinutes} minutes). Report before the deadline; do not start an automatic continuation.` : run.prompt;
    if (!(await tx.run.updateMany({ where: { id: run.id, status: "queued" }, data: { status: "running", tokenHash: hash(token), startedAt: now, deadlineAt, leaseUntil: deadlineAt, prompt } })).count) return null;
    await audit(tx, { workspaceId: this.workspaceId, actor: "chrona", kind: "run_claimed", subjectId: run.id, details: { lane, ...(builds ? { builds } : {}), ...(execution ? { execution } : {}) } });
    return { ...run, status: "running", startedAt: now, deadlineAt, leaseUntil: deadlineAt, prompt, token, runId: run.id, ...(execution ? { model: execution.model } : {}) };
  }
  private async foregroundHasPriority(tx: Prisma.TransactionClient, now: Date) {
    const { workspaceId } = this;
    return !await tx.run.count({ where: { workspaceId, lane: "foreground", status: "running" } }) && await tx.run.count({ where: { workspaceId, status: "queued", OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }], lane: "foreground" } });
  }
  async claimNext(lane: RunLane, now = this.ports.now()) {
    return this.ports.db.$transaction(async tx => {
      const { workspaceId } = this;
      if (await tx.run.count({ where: { workspaceId, lane, status: "running" } })) return null;
      const eligible = { workspaceId, status: "queued", OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] };
      if (lane === "background" && await this.foregroundHasPriority(tx, now)) return null;
      const settings = (await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings;
      const timezone = notificationSettings(settings).timezone, builds = lane === "build" ? buildSettings(settings) : null;
      const recent = await tx.run.findMany({ where: { workspaceId, startedAt: { gte: new Date(now.getTime() - 48 * 3600000), lte: now } }, select: { startedAt: true, sessionId: true } });
      const today = recent.filter(r => r.startedAt && localDayKey(r.startedAt, timezone) === localDayKey(now, timezone));
      const waiting = lane === "build" ? { workspaceId, status: "queued" } : eligible;
      for (const run of await tx.run.findMany({ where: { ...waiting, lane }, include: { session: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })) {
        const admission = await this.admitQueued(tx, run, now, { lane, today, timezone });
        if (admission === "blocked") return null;
        if (admission === "skip") continue;
        if (run.sessionId && await tx.run.count({ where: { workspaceId, sessionId: run.sessionId, status: "running" } })) continue;
        const claimed = await this.claimQueued(tx, run, lane, now, builds);
        if (claimed) return claimed;
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
    const finalized = await db.$transaction(async tx => {
      const cancelled = !!await tx.audit.findUnique({ where: { id: providerCancelKey(runId) } });
      const status = cancelled ? "cancelled" : expired ? "timed_out" : outcome.outcome === "unavailable" ? "provider_unavailable" : outcome.outcome;
      const error = cancelled ? "Cancelled by owner" : expired ? "Run lease expired" : outcome.error;
      if (!(await tx.run.updateMany({ where: { id: runId, workspaceId, status: "running" }, data: { status, error: error?.slice(0, 1000), endedAt: now, leaseUntil: null } })).count) return false;
      if (run.sessionId) await tx.session.update({ where: { id: run.sessionId }, data: { lastActivityAt: now, ...(outcome.sessionId ? { providerSessionId: outcome.sessionId } : {}) } });
      if (status === "finished") await this.deliverResult(tx, run, now);
      await this.followUp(tx, run, status, now, error);
      if (status === "finished") await this.endIfDone(tx, run, now);
      await audit(tx, { workspaceId, actor: "chrona", kind: "run_finished", subjectId: runId, details: { status } });
      return true;
    });
    if (!finalized) return;
    liveRuns.delete(runId);
    await ports.onRunFinished?.(workspaceId, runId);
  }
  // eslint-disable-next-line complexity -- Preserve origin wake, entry delivery and notification fallback ordering without duplicate delivery.
  private async deliverResult(tx: Prisma.TransactionClient, run: RunRow, now: Date) {
    const session = run.session;
    if (!session || !["wake", "module", "build"].includes(session.source)) return;
    const receipts = await tx.audit.findMany({ where: { workspaceId: this.workspaceId, kind: "run_reply", subjectId: run.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const ids = receipts.flatMap(receipt => {
      const details = receipt.details as { messageId?: unknown } | null;
      return typeof details?.messageId === "string" ? [details.messageId] : [];
    });
    const replies = await tx.message.findMany({ where: { workspaceId: this.workspaceId, sessionId: session.id, id: { in: ids } } });
    const ordered: { text: string; attachments: unknown }[] = ids.flatMap(id => replies.filter(reply => reply.id === id));
    const line = session.source === "build" ? await buildOutcomeLine(tx, this.workspaceId, session.id) : null;
    const replyText = ordered.map(reply => reply.text).join("\n\n");
    const body = line ? appendBuildOutcome(replyText, line, 4000) : replyText;
    if (line) {
      const last = ordered.at(-1);
      if (last) last.text = appendBuildOutcome(last.text, line);
      else ordered.push({ text: line, attachments: [] });
    }
    if (!ordered.length) return;
    // Pushed into the original conversation (e.g. QQ): the result needs no separate notice there.
    if (session.originSessionId && session.source === "build") await this.wakeOrigin(tx, run, session.originSessionId, body);
    if (session.originSessionId && await this.pushResult(tx, session.originSessionId, ordered, now)) return;
    const module = session.moduleId ? await tx.module.findUnique({ where: { id: session.moduleId } }) : null;
    await notifyUser(tx, this.ports, this.workspaceId, { level: "now", title: session.title ?? run.label ?? "后台处理完成", body, key: `session-result:${run.id}`,
      session: session.originSessionId ?? session.id, ...(module ? { module: module.id, app: module.name } : {}) });
  }
  /** A wake or module conversation ends with its work: nothing queued and no approval it asked for still open (its decision resumes it). */
  private async endIfDone(tx: Prisma.TransactionClient, run: RunRow, now: Date) {
    const session = run.session, { workspaceId } = this;
    if (!session || !["wake", "module"].includes(session.source)) return;
    if (await tx.run.count({ where: { workspaceId, sessionId: session.id, status: { in: ["queued", "running"] } } })) return;
    const open = await tx.approval.findMany({ where: { workspaceId, status: "open" }, select: { payload: true } });
    if (open.some(row => (row.payload as { sessionId?: unknown } | null)?.sessionId === session.id)) return;
    await tx.session.update({ where: { id: session.id }, data: { status: "ended", endedAt: now } });
  }
  /** Build conversations stay open for revisions; one left idle for a week ends (the user can ask for a new build). An owner-MCP conversation idle for a day ends too. */
  async endIdleBuilds(now = this.ports.now()) {
    const { db } = this.ports, { workspaceId } = this;
    const idle = await db.session.findMany({ where: { workspaceId, status: "active", OR: [{ source: "build", lastActivityAt: { lt: new Date(now.getTime() - BUILD_IDLE_MS) } }, { source: "mcp", lastActivityAt: { lt: new Date(now.getTime() - MCP_IDLE_MS) } }] } });
    for (const session of idle) {
      if (await db.run.count({ where: { workspaceId, sessionId: session.id, status: { in: ["queued", "running"] } } })) continue;
      await db.session.updateMany({ where: { id: session.id, status: "active" }, data: { status: "ended", endedAt: now } });
    }
  }
  private async pushResult(tx: Prisma.TransactionClient, originSessionId: string, ordered: { text: string; attachments: unknown }[], now: Date) {
    const origin = await tx.session.findFirst({ where: { id: originSessionId, workspaceId: this.workspaceId } });
    if (!origin) throw new StewardError("not_found", "Origin session not found");
    const latest = await tx.message.findFirst({ where: { sessionId: origin.id }, orderBy: [{ at: "desc" }, { id: "desc" }] });
    for (const reply of ordered) {
      const copy = await tx.message.create({ data: { workspaceId: this.workspaceId, sessionId: origin.id, channel: latest?.channel ?? "in_app", direction: "out", text: reply.text, attachments: reply.attachments as Prisma.InputJsonValue, at: now } });
      await pushReply(tx, this.ports, copy, null);
    }
    await tx.session.update({ where: { id: origin.id }, data: { lastActivityAt: now } });
    return !!origin.entryModuleId;
  }
  /** The conversation that asked for a build learns how it ended; without this it waits for a reply that never comes. True when its entry delivered it. */
  private async tellBuildOrigin(tx: Prisma.TransactionClient, run: RunRow, status: string, now: Date, error: string | null | undefined) {
    if (!run.session?.originSessionId || !["failed", "timed_out", "provider_unavailable", "cancelled"].includes(status)) return false;
    const why = { timed_out: "已达到时限", cancelled: "已被取消", provider_unavailable: "模型服务不可用" }[status] ?? "未完成";
    const text = appendBuildOutcome(`构建「${run.session.title ?? run.label ?? "模块"}」结束：${why}${error ? `（${error.slice(0, 200)}）` : ""}。未提交新版本的部分不会自动重试，已有文件保留在构建会话中。`, await buildOutcomeLine(tx, this.workspaceId, run.session.id), 4000);
    // A deleted origin falls back to the notice; it never blocks finishing the run (it throws before writing).
    const told = await this.pushResult(tx, run.session.originSessionId, [{ text, attachments: [] }], now).catch(() => false);
    await this.wakeOrigin(tx, run, run.session.originSessionId, text).catch(() => {});
    return told;
  }
  /**
   * The conversation that asked for a build runs once more with its result, so work queued behind the build goes on
   * without the user asking again. At most BUILD_WAKES in a row without a user message; then it waits for the user.
   */
  private async wakeOrigin(tx: Prisma.TransactionClient, run: RunRow, originSessionId: string, result: string) {
    const { workspaceId } = this;
    const origin = await tx.session.findFirst({ where: { id: originSessionId, workspaceId, status: "active" } });
    if (!origin || !["web", "qq", "mcp", "rescue", "wake", "module"].includes(origin.source)) return;
    if (await tx.run.count({ where: { workspaceId, sessionId: origin.id, status: "queued" } })) return;
    const lastUser = await tx.message.findFirst({ where: { sessionId: origin.id, direction: "in" }, orderBy: [{ at: "desc" }, { id: "desc" }] });
    // Runs carry Chrona's clock (audits do not): count the wakes since the user last spoke.
    const wakes = await tx.run.count({ where: { workspaceId, sessionId: origin.id, lane: "foreground", trigger: "build", ...(lastUser ? { createdAt: { gt: lastUser.at } } : {}) } });
    if (wakes >= BUILD_WAKES) return;
    const title = run.session?.title ?? run.label ?? "模块";
    const prompt = `[Chrona] 你发起的构建「${title}」已结束，结果如下（也已显示在本对话中）：\n${result.slice(0, 4000)}\n\n如果本对话里用户交代的任务还有排在它之后、尚未开始的，现在继续下一项；没有就用一句话告诉用户结果，不要再发起构建。`;
    const woken = await this.enqueue({ sessionId: origin.id, lane: "foreground", trigger: "build", prompt, label: `构建结束：${title}`.slice(0, 120) }, tx);
    await audit(tx, { workspaceId, actor: "chrona", kind: "build_origin_wake", subjectId: origin.id, details: { buildRunId: run.id, runId: woken.id } });
  }
  private async followUp(tx: Prisma.TransactionClient, run: RunRow, status: string, now: Date, error: string | null | undefined) {
    const { workspaceId, ports } = this;
    if (run.lane === "build" && await this.tellBuildOrigin(tx, run, status, now, error)) return;
    if (["failed", "timed_out", "provider_unavailable"].includes(status)) {
      if (run.lane === "build") {
        await notifyUser(tx, ports, workspaceId, { level: "now", title: "模块构建已暂停", body: appendBuildOutcome(`${status === "timed_out" ? "本轮构建已达到时限" : "本轮构建未完成"}，已有文件和过程已保留。请查看构建会话，决定是否修改需求并继续；不会自动重试。`, run.sessionId ? await buildOutcomeLine(tx, workspaceId, run.sessionId) : "未启用：本次构建未提交版本", 4000), key: `build-paused:${run.id}`, ...(run.sessionId ? { session: run.sessionId } : {}) });
        return;
      }
      await this.retryFailed(tx, run, status, now, error);
    }
  }
  private async retryFailed(tx: Prisma.TransactionClient, run: RunRow, status: string, now: Date, error: string | null | undefined) {
      const { workspaceId, ports } = this;
      const history = await tx.run.findMany({ where: { workspaceId, sessionId: run.sessionId, status: { notIn: ["queued", "running"] } }, orderBy: [{ endedAt: "desc" }, { createdAt: "desc" }], take: RUN_LIMITS.maxFailures });
      let failures = 0;
      for (const prior of history) { if (!["failed", "timed_out", "provider_unavailable"].includes(prior.status)) break; failures++; }
      const uncertain = await tx.moduleInvocation.count({ where: { workspaceId, caller: `provider:${run.id}`, status: { in: ["unknown", "running"] } } });
      if (failures >= RUN_LIMITS.maxFailures || status === "provider_unavailable" || uncertain > 0) {
        const reason = uncertain ? "有操作的结果尚未确认，请先核对实际结果，避免重复执行。" : status === "provider_unavailable" ? "模型服务不可用，请检查配置后再继续。" : "连续三次处理失败，请检查服务状态后再继续。";
        await notifyUser(tx, ports, workspaceId, { level: "now", title: "处理已暂停", body: `${reason}本次不会自动重试。${error ? `\n最近一次原因：${error.slice(0, 300)}` : ""}`, key: `run-failed:${run.id}`, ...(run.sessionId ? { session: run.sessionId } : {}) });
        return;
      }
      const recovery = "[Recovery] Inspect conversation history, saved files and actual external state before continuing. Previous actions may already have happened, including native Provider tools. Do not repeat an external action with an uncertain outcome; report it for verification.\n\n";
      const prompt = run.prompt.startsWith(recovery) ? run.prompt : recovery + run.prompt;
      const retry = await tx.run.create({ data: { workspaceId, sessionId: run.sessionId, lane: run.lane, trigger: run.trigger, provider: run.provider, prompt, label: run.label, cwd: run.cwd, tokenHash: hash(randomBytes(32).toString("hex")), createdAt: now, leaseUntil: new Date(now.getTime() + Math.min(30, 2 ** Math.min(failures - 1, 5)) * 60000) } });
      await audit(tx, { workspaceId, actor: "chrona", kind: "run_continuation", subjectId: run.id, details: { runId: retry.id } });
      const source = await tx.audit.findFirst({ where: { workspaceId, kind: "chat_run_input", subjectId: run.id } });
      if (source) await audit(tx, { workspaceId, actor: "chrona", kind: "chat_run_input", subjectId: retry.id, details: source.details as Prisma.InputJsonObject });
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
