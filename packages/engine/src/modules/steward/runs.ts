import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@chrona/db";
import { RUN_LIMITS } from "@chrona/contracts/steward";
import { localDayKey } from "@chrona/domain/steward/notify-budget";
import type { StewardPorts } from "./service";
import { notificationSettings } from "./settings";
import { enqueueNotification } from "./notify";
import { audit } from "./audit";
import { StewardError } from "./errors";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const stopped = (status: string) => status === "paused" || status === "done";
/** Find the next local date boundary, including DST and non-hour timezone offsets. */
export function nextLocalMidnight(now: Date, timezone: string) {
  const day = localDayKey(now, timezone);
  let lo = now.getTime(), hi = lo + 48 * 3600000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDayKey(new Date(mid), timezone) === day) lo = mid; else hi = mid;
  }
  return new Date(hi);
}
export async function authenticateRun(tx: Prisma.TransactionClient, token: string, now: Date) {
  const run = await tx.affairRun.findUnique({ where: { tokenHash: hash(token) }, include: { affair: true } });
  if (!run || run.status !== "running" || run.deadlineAt <= now || stopped(run.affair.status)) throw new StewardError("forbidden", "Run capability is no longer valid");
  const { affair, ...record } = run;
  return { run: record, affair, workspaceId: run.workspaceId };
}
export function createRuns(ports: Pick<StewardPorts, "db" | "now" | "chat" | "publicUrl">) {
  const { db } = ports;
  return {
    authenticate: (token: string, now = ports.now()) => authenticateRun(db, token, now),
    claimNext: (now = ports.now()) => db.$transaction(async tx => {
      const candidates = await tx.affair.findMany({ where: { agentState: "queued", nextRunAt: { lte: now }, status: { notIn: ["paused", "done"] }, runs: { none: { status: "running" } } }, include: { workspace: true }, orderBy: [{ nextRunAt: "asc" }, { id: "asc" }] });
      for (const affair of candidates) {
        const timezone = notificationSettings(affair.workspace.settings).timezone, day = localDayKey(now, timezone);
        const recent = await tx.affairRun.findMany({ where: { affairId: affair.id, startedAt: { gte: new Date(now.getTime() - 48 * 3600000), lte: now } }, select: { startedAt: true } });
        if (recent.filter(r => localDayKey(r.startedAt, timezone) === day).length >= RUN_LIMITS.maxRunsPerAffairPerDay) {
          await tx.affair.update({ where: { id: affair.id }, data: { nextRunAt: nextLocalMidnight(now, timezone) } });
          const key = `run-cap:${affair.id}:${day}`;
          await tx.affairEntry.upsert({ where: { workspaceId_idempotencyKey: { workspaceId: affair.workspaceId, idempotencyKey: key } }, update: {}, create: { workspaceId: affair.workspaceId, affairId: affair.id, actor: "chrona", kind: "note", text: "今天的处理次数已用完，明天继续", idempotencyKey: key, at: now } });
          await audit(tx, { workspaceId: affair.workspaceId, kind: "run_daily_cap", actor: "chrona", subjectId: affair.id, details: { day } });
          continue;
        }
        const deadlineAt = new Date(now.getTime() + RUN_LIMITS.affairTimeoutMs);
        const claimed = await tx.affair.updateMany({ where: { id: affair.id, agentState: "queued", revision: affair.revision, status: { notIn: ["paused", "done"] } }, data: { agentState: "running", leaseUntil: deadlineAt, nextRunAt: null } });
        if (!claimed.count) continue;
        const previous = await tx.affairRun.findFirst({ where: { affairId: affair.id }, orderBy: { number: "desc" } });
        const token = randomBytes(32).toString("hex");
        const run = await tx.affairRun.create({ data: { workspaceId: affair.workspaceId, affairId: affair.id, number: (previous?.number ?? 0) + 1, wakeReason: affair.wakeReason, affairRevision: affair.revision, tokenHash: hash(token), leaseUntil: deadlineAt, deadlineAt, startedAt: now } });
        await audit(tx, { workspaceId: affair.workspaceId, kind: "run_claimed", actor: "chrona", subjectId: run.id, details: { affairId: affair.id } });
        return { runId: run.id, affairId: affair.id, token, deadlineAt };
      }
      return null;
    }),
    async finishRun(runId: string, input: { outcome: "exited" | "timeout" | "unavailable" | "killed"; note: string }) {
      const now = ports.now(), chatBound = ports.chat ? await ports.chat.bound() : false;
      return db.$transaction(async tx => {
        const run = await tx.affairRun.findUnique({ where: { id: runId }, include: { affair: true } });
        if (!run) throw new StewardError("not_found", "Run not found");
        if (run.status !== "running") {
          if (!run.endedAt) {
            await tx.affairRun.update({ where: { id: runId }, data: { endedAt: now } });
            await audit(tx, { workspaceId: run.workspaceId, kind: "run_ended", actor: "chrona", subjectId: runId, details: { status: run.status } });
          }
          return;
        }
        const affair = run.affair;
        const status = stopped(affair.status) || input.outcome === "killed" ? "cancelled" : input.outcome === "unavailable" ? "agent_unavailable" : input.outcome === "timeout" ? "timed_out" : "no_outcome";
        const failure = status === "timed_out" || status === "no_outcome";
        const failures = affair.failures + Number(failure);
        const failed = failure && failures >= RUN_LIMITS.maxFailures;
        const retry = status !== "cancelled" && !failed;
        const history = status === "agent_unavailable" ? await tx.affairRun.findMany({ where: { affairId: affair.id, number: { lt: run.number } }, orderBy: { number: "desc" }, select: { status: true } }) : [];
        let unavailable = 0;
        for (const prior of history) { if (prior.status !== "agent_unavailable") break; unavailable++; }
        const delay = status === "agent_unavailable" ? Math.min(30, 2 ** Math.min(unavailable, 5)) * 60000 : 0;
        await tx.affairRun.update({ where: { id: runId }, data: { status, endedAt: now, error: input.note.slice(0, 500) } });
        await tx.affair.update({ where: { id: affair.id }, data: { failures, agentState: failed ? "failed" : retry ? "queued" : "idle", nextRunAt: retry ? new Date(now.getTime() + delay) : null, leaseUntil: null, wakeReason: "retry", lastError: failure ? input.note.slice(0, 500) : affair.lastError } });
        if (failed) {
          const title = `「${affair.title}」处理失败，需要你看一下`;
          await tx.affairEntry.create({ data: { workspaceId: affair.workspaceId, affairId: affair.id, actor: "chrona", kind: "note", text: title, at: now } });
          await enqueueNotification(tx, { workspaceId: affair.workspaceId, affairId: affair.id, level: "now", title, body: "连续处理失败，已停止重试。请打开事务检查并补充说明。", dedupeKey: `run-failed:${runId}` }, { now, chatBound, publicUrl: ports.publicUrl });
        }
        await audit(tx, { workspaceId: affair.workspaceId, kind: "run_finished", actor: "chrona", subjectId: runId, details: { status, failures } });
      });
    },
    expireLeases: (now = ports.now()) => db.$transaction(async tx => {
      const rows = await tx.affairRun.findMany({ where: { status: "running", leaseUntil: { lte: now } }, include: { affair: true } });
      for (const run of rows) {
        await tx.affairRun.update({ where: { id: run.id }, data: { status: "lease_expired", endedAt: now } });
        const stop = stopped(run.affair.status);
        await tx.affair.update({ where: { id: run.affairId }, data: { agentState: stop ? "idle" : "queued", nextRunAt: stop ? null : now, leaseUntil: null, wakeReason: "retry" } });
        await audit(tx, { workspaceId: run.workspaceId, kind: "run_lease_expired", actor: "chrona", subjectId: run.id, details: {} });
      }
      return rows.length;
    }),
    async shouldStop(runId: string) {
      const run = await db.affairRun.findUnique({ where: { id: runId }, include: { affair: true } });
      return !run || run.status !== "running" || stopped(run.affair.status);
    },
  };
}
