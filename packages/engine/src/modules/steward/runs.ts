import { createHash, randomBytes } from "node:crypto";
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
    let error = outcome.error, status = outcome.outcome === "unavailable" ? "provider_unavailable" : outcome.outcome;
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
    await db.$transaction(async tx => {
      if (!(await tx.run.updateMany({ where: { id: runId, workspaceId, status: "running" }, data: { status, error: error?.slice(0, 1000), endedAt: now, leaseUntil: null } })).count) return;
      if (run.affairId) {
        await tx.affair.update({ where: { id: run.affairId }, data: { lastActivityAt: now, ...(outcome.sessionId ? { sessionId: outcome.sessionId } : {}) } });
        await tx.activity.create({ data: { workspaceId, affairId: run.affairId, actor: "chrona", kind: "run", text: `Chrona: ${run.trigger} (${status})`, data: { runId }, at: now } });
        for (const path of paths) await tx.activity.create({ data: { workspaceId, affairId: run.affairId, actor: "chrona", kind: "edit", text: path, data: { commit, paths: [path] }, at: now } });
      }
      const history = await tx.run.findMany({ where: { workspaceId, affairId: run.affairId, conversationKey: run.conversationKey, status: { notIn: ["queued", "running"] } }, orderBy: [{ endedAt: "desc" }, { createdAt: "desc" }] });
      let failures = 0;
      for (const prior of history) { if (!["failed", "timed_out", "provider_unavailable"].includes(prior.status)) break; failures++; }
      if (failures === RUN_LIMITS.maxFailures) await enqueueNotification(tx, { workspaceId, affairId: run.affairId ?? undefined, level: "now", title: "处理连续失败", body: "连续三次处理失败，请检查服务状态。", dedupeKey: `run-failed:${runId}` }, { now, chatBound, publicUrl: ports.publicUrl });
      if (status === "provider_unavailable" && (!run.affair || run.affair.status === "active")) {
        await tx.run.create({ data: { workspaceId, affairId: run.affairId, conversationKey: run.conversationKey, lane: run.lane, trigger: "retry", provider: run.provider, prompt: run.prompt, cwd: run.cwd, tokenHash: hash(randomBytes(32).toString("hex")), createdAt: now, leaseUntil: new Date(now.getTime() + Math.min(30, 2 ** Math.min(failures - 1, 5)) * 60000) } });
      }
      await audit(tx, { workspaceId, actor: "chrona", kind: "run_finished", subjectId: runId, details: { status } });
    });
    liveRuns.delete(runId);
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
