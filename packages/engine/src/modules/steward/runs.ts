import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { join } from "node:path";
import type { Prisma } from "@chrona/db";
import { RUN_LIMITS, type ProviderAdapter, type RunLane, type RunTrigger } from "@chrona/contracts/steward";
import { localDayKey } from "@chrona/domain/steward/notify-budget";
import type { StewardPorts } from "./service";
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
export async function authenticateRun(tx: Prisma.TransactionClient, token: string, now: Date) {
  const row = await tx.run.findUnique({ where: { tokenHash: hash(token) }, include: { affair: true } });
  if (!row || row.status !== "running" || !row.deadlineAt || row.deadlineAt <= now || !row.leaseUntil || row.leaseUntil <= now || (row.affair && row.affair.status !== "active")) throw new StewardError("forbidden", "Run capability is no longer valid");
  const { affair, ...run } = row;
  return { run, affair, workspaceId: row.workspaceId };
}
export type EnqueueRun = { affairId?: string; lane: RunLane; trigger: RunTrigger; prompt: string; conversationKey?: string };
export function createRuns(ports: StewardPorts, workspaceId: string) {
  const { db } = ports, fs = createWorkspaceFs(ports.dataDir);
  async function enqueue(input: EnqueueRun, tx: Prisma.TransactionClient = db) {
    const affair = input.affairId ? await requireAffair(tx, workspaceId, input.affairId) : null;
    if (affair && affair.status !== "active") throw new StewardError("conflict", "Affair is not active");
    if (input.lane === "background" && !affair) throw new StewardError("invalid", "Background run requires an affair");
    return tx.run.create({ data: { ...input, workspaceId, provider: ports.provider?.name ?? "unconfigured", tokenHash: hash(randomBytes(32).toString("hex")), cwd: affair ? await fs.forAffair(affair.dirName).directory() : join(ports.dataDir, "affairs"), createdAt: ports.now() } });
  }
  async function claimNext(lane: RunLane, now = ports.now()) {
    return db.$transaction(async tx => {
      if (await tx.run.count({ where: { workspaceId, lane, status: "running" } })) return null;
      const eligible = { workspaceId, status: "queued", OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] };
      // Claim foreground first, but a running foreground never blocks background.
      if (lane === "background" && !await tx.run.count({ where: { workspaceId, lane: "foreground", status: "running" } }) && await tx.run.count({ where: { ...eligible, lane: "foreground" } })) return null;
      const timezone = notificationSettings((await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings).timezone;
      for (const run of await tx.run.findMany({ where: { ...eligible, lane }, include: { affair: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })) {
        if (run.affair && run.affair.status !== "active") { await tx.run.update({ where: { id: run.id }, data: { status: "cancelled", endedAt: now } }); continue; }
        if (run.affairId) {
          const recent = await tx.run.findMany({ where: { workspaceId, affairId: run.affairId, startedAt: { gte: new Date(now.getTime() - 48 * 3600000), lte: now } }, select: { startedAt: true } });
          if (recent.filter(r => r.startedAt && localDayKey(r.startedAt, timezone) === localDayKey(now, timezone)).length >= RUN_LIMITS.maxRunsPerAffairPerDay) {
            await tx.run.update({ where: { id: run.id }, data: { leaseUntil: nextLocalMidnight(now, timezone) } }); continue;
          }
        }
        const token = randomBytes(32).toString("hex"), deadlineAt = new Date(now.getTime() + (lane === "foreground" ? RUN_LIMITS.foregroundTimeoutMs : RUN_LIMITS.backgroundTimeoutMs));
        const claimed = await tx.run.updateMany({ where: { id: run.id, status: "queued" }, data: { status: "running", tokenHash: hash(token), startedAt: now, deadlineAt, leaseUntil: deadlineAt } });
        if (!claimed.count) continue;
        await audit(tx, { workspaceId, actor: "chrona", kind: "run_claimed", subjectId: run.id, details: { lane } });
        return { ...run, status: "running", startedAt: now, deadlineAt, leaseUntil: deadlineAt, token, runId: run.id };
      }
      return null;
    });
  }
  async function finish(runId: string, outcome: Awaited<ReturnType<ProviderAdapter["start"]>["done"]>) {
    const now = ports.now(), run = await db.run.findFirst({ where: { id: runId, workspaceId }, include: { affair: true } });
    if (!run) throw new StewardError("not_found", "Run not found");
    if (run.status !== "running") return;
    // An abort can settle the provider promise before expireLeases calls finish.
    // Persist the timeout rather than misclassifying that race as provider failure.
    const expired = (run.deadlineAt && run.deadlineAt <= now) || (run.leaseUntil && run.leaseUntil <= now);
    let error = expired ? "Run lease expired" : outcome.error;
    let status = expired ? "timed_out" : outcome.outcome === "unavailable" ? "provider_unavailable" : outcome.outcome;
    const foregroundDeadline = run.lane === "foreground" && status === "timed_out" &&
      (!expired || !!(run.deadlineAt && run.deadlineAt <= now));
    let commit: string | null = null, paths: string[] = [];
    if (run.affair) {
      try {
        const files = fs.forAffair(run.affair.dirName);
        const reply = run.conversationKey ? await db.message.findFirst({ where: { workspaceId, conversationKey: run.conversationKey, direction: "out", at: { gte: run.startedAt! } }, orderBy: { at: "asc" } }) : null;
        paths = await files.commitAll("chrona", `Chrona: ${run.trigger}${reply ? ` — ${reply.text.split("\n")[0]}` : ""}`.slice(0, 500));
        if (paths.length) commit = (await files.revisions())[0]?.sha ?? null;
      } catch { status = "failed"; error = "Could not commit affair changes"; }
    }
    const chatBound = ports.chat ? await ports.chat.bound() : false;
    const finalized = await db.$transaction(async tx => {
      if (!(await tx.run.updateMany({ where: { id: runId, workspaceId, status: "running" }, data: { status, error: error?.slice(0, 1000), endedAt: now, leaseUntil: null } })).count) return null;
      let deadlineMessage = null;
      if (run.affairId) {
        await tx.affair.update({ where: { id: run.affairId }, data: { lastActivityAt: now, ...(outcome.sessionId ? { sessionId: outcome.sessionId } : {}) } });
        await tx.activity.create({ data: { workspaceId, affairId: run.affairId, actor: "chrona", kind: "run", text: `Chrona: ${run.trigger} (${status})`, data: { runId }, at: now } });
        for (const path of paths) await tx.activity.create({ data: { workspaceId, affairId: run.affairId, actor: "chrona", kind: "edit", text: path, data: { commit, paths: [path] }, at: now } });
      }
      const history = await tx.run.findMany({ where: { workspaceId, affairId: run.affairId, conversationKey: run.conversationKey, status: { notIn: ["queued", "running"] } }, orderBy: [{ endedAt: "desc" }, { createdAt: "desc" }] });
      let failures = 0;
      for (const prior of history) { if (!["failed", "timed_out", "provider_unavailable"].includes(prior.status)) break; failures++; }
      if (failures === RUN_LIMITS.maxFailures) await enqueueNotification(tx, { workspaceId, affairId: run.affairId ?? undefined, level: "now", title: "处理连续失败", body: "连续三次处理失败，请检查服务状态。", dedupeKey: `run-failed:${runId}` }, { now, chatBound, publicUrl: ports.publicUrl });
      if (foregroundDeadline) {
        const focus = run.conversationKey ? await tx.audit.findFirst({ where: { workspaceId, kind: "conversation_focus", subjectId: run.conversationKey }, orderBy: { createdAt: "desc" } }) : null;
        const affairId = run.affairId ?? z.object({ affairId: z.string() }).safeParse(focus?.details).data?.affairId;
        const affair = affairId ? await tx.affair.findFirst({ where: { workspaceId, id: affairId, status: "active" } }) : null;
        if (affair) await enqueue({ affairId: affair.id, conversationKey: run.conversationKey ?? undefined, lane: "background", trigger: run.trigger as RunTrigger, prompt: run.prompt }, tx);
        const replied = await tx.audit.findFirst({ where: { workspaceId, kind: "run_reply", subjectId: run.id } });
        const conversation = !replied && run.conversationKey ? await tx.message.findFirst({ where: { workspaceId, conversationKey: run.conversationKey }, orderBy: { at: "desc" } }) : null;
        if (conversation) {
          deadlineMessage = await tx.message.create({ data: { workspaceId, conversationKey: run.conversationKey!, channel: conversation.channel, direction: "out", affairId: affair?.id, text: affair ? "这次处理超时了，我会在后台继续。" : "这次处理超时了，尚未关联事务，无法在后台继续。请再试一次。", at: now } });
          await audit(tx, { workspaceId, actor: "chrona", kind: "run_reply", subjectId: run.id, details: { messageId: deadlineMessage.id, reason: "deadline" } });
        }
      } else if (["failed", "timed_out", "provider_unavailable"].includes(status) && (!run.affair || run.affair.status === "active")) {
        // Retry identity is immutable; the attempt status already records why it retried.
        const retry = await tx.run.create({ data: { workspaceId, affairId: run.affairId, conversationKey: run.conversationKey, lane: run.lane, trigger: run.trigger, provider: run.provider, prompt: run.prompt, cwd: run.cwd, tokenHash: hash(randomBytes(32).toString("hex")), createdAt: now, leaseUntil: new Date(now.getTime() + Math.min(30, 2 ** Math.min(failures - 1, 5)) * 60000) } });
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
  async function expireLeases(now = ports.now()) {
    const rows = await db.run.findMany({ where: { workspaceId, status: "running", OR: [{ leaseUntil: { lte: now } }, { deadlineAt: { lte: now } }] } });
    for (const row of rows) {
      // Never commit while the Provider may still be writing.
      await liveRuns.get(row.id)?.abort();
      await finish(row.id, { outcome: "timed_out", sessionId: null, error: "Run lease expired" });
    }
    return rows.length;
  }
  return { enqueue, claimNext, finish, expireLeases, authenticate: (token: string) => authenticateRun(db, token, ports.now()) };
}
