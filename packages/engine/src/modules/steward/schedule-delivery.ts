import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { moduleSupervisor, type DeliveryStage } from "./module-supervisor";
import { randomUUID } from "node:crypto";
import { notifyUser } from "./notify-user";
import { latestModuleEvolution } from "./module-evolution";

type Occurrence = { scheduleId: string; moduleId: string | null; hash: string | null; activationId: string | null; triggerId: string | null; firedAt: string; claimedAt: string; payload: Prisma.JsonValue };
type DeliveryPool = { scan?: Promise<void>; jobs: Map<string, Promise<void>> };
const active = new WeakMap<StewardPorts["db"], Map<string, DeliveryPool>>();
const MAX_ATTEMPTS = 6;

/** Commit the occurrence with the schedule advance; no effect can precede this record. */
export async function enqueueSchedule(tx: Prisma.TransactionClient, workspaceId: string, row: Prisma.ScheduleGetPayload<object>, now: Date) {
  const module = row.moduleId ? await tx.module.findFirst({ where: { id: row.moduleId, workspaceId } }) : null;
  const activationId = module?.activeHash ? (await latestModuleEvolution(tx, workspaceId, module.id, module.activeHash))?.activationId ?? null : null;
  const args: Occurrence = { scheduleId: row.id, moduleId: module?.id ?? null, hash: module?.activeHash ?? null, activationId, triggerId: row.triggerId, firedAt: row.nextAt!.toISOString(), claimedAt: now.toISOString(), payload: row.payload };
  await tx.moduleInvocation.create({ data: { workspaceId, caller: "system:schedules", target: module?.name ?? "missing", tool: "schedule", key: `${row.id}:${args.firedAt}`, mode: "schedule", args, nextAttemptAt: now, createdAt: now } });
}

async function deliver(ports: StewardPorts, row: Prisma.ModuleInvocationGetPayload<object>, now: Date) {
  const { db } = ports, token = randomUUID(), occurrence = row.args as unknown as Occurrence;
  const claimed = await db.moduleInvocation.updateMany({ where: { id: row.id, status: "queued" }, data: { status: "running", attempts: { increment: 1 }, leaseToken: token, leaseUntil: new Date(now.getTime() + 660_000) } });
  if (!claimed.count) return;
  const settle = async (status: string, error: string | null, effects = 0) => {
    await db.$transaction(async tx => {
      const changed = await tx.moduleInvocation.updateMany({ where: { id: row.id, status: "running", leaseToken: token }, data: { status, error, leaseToken: null, leaseUntil: null, finishedAt: status === "queued" ? null : ports.now(), nextAttemptAt: status === "queued" ? new Date(now.getTime() + Math.min(3600_000, 30_000 * 2 ** row.attempts)) : null } });
      if (!changed.count) return;
      if (status === "failed" || status === "unknown") await notifyUser(tx, ports, row.workspaceId, { level: "now", title: "日程未完成", body: `${row.target} 的日程${status === "unknown" ? "结果未知，请核对实际结果；不会自动重放" : "投递失败，已停止自动尝试"}。${error ?? ""}`, key: `schedule-delivery:${row.id}` });
      const delay = Date.parse(occurrence.claimedAt) - Date.parse(occurrence.firedAt);
      await tx.schedule.updateMany({ where: { id: occurrence.scheduleId, lastAt: new Date(occurrence.claimedAt) }, data: {
        lastResult: `Module exit ${status === "succeeded" ? 0 : -1}; effects ${effects}; delay ${delay}ms${error ? `; ${error}` : ""}`.slice(0, 2000),
        failures: status === "succeeded" ? 0 : { increment: 1 },
      } });
    });
  };
  const unavailable = (reason: string) => settle(row.attempts + 1 < MAX_ATTEMPTS ? "queued" : "failed", reason);
  try {
    const schedule = await db.schedule.findUnique({ where: { id: occurrence.scheduleId } });
    const module = occurrence.moduleId ? await db.module.findFirst({ where: { id: occurrence.moduleId, workspaceId: row.workspaceId } }) : null;
    if (!schedule || schedule.status === "cancelled") return settle("cancelled", "Module schedule replaced");
    if (!module) return settle("failed", "Module missing");
    if (module.activeHash !== occurrence.hash) return settle("cancelled", "Module version changed; occurrence was not replayed");
    if (module.activeHash && ((await latestModuleEvolution(db, row.workspaceId, module.id, module.activeHash))?.activationId ?? null) !== occurrence.activationId) return settle("cancelled", "Module activation changed; occurrence was not replayed");
    if (module.status !== "active" || schedule.status === "paused") return unavailable("Module is paused");
    if (!module.activeHash) return unavailable("Module has no active hash");
    await moduleSupervisor(ports).deliver(module.id, module.activeHash, { trigger: { id: occurrence.triggerId ?? `s-${schedule.id}`, kind: "schedule", firedAt: occurrence.firedAt, ...(occurrence.payload !== null ? { scheduleId: schedule.id, payload: occurrence.payload as Record<string, unknown> } : {}) }, now: now.toISOString(), params: {} }, { activationId: occurrence.activationId });
    const effects = await db.moduleCall.count({ where: { moduleId: module.id, hash: module.activeHash, eventKey: `${occurrence.triggerId ?? `s-${schedule.id}`}:${occurrence.firedAt}` } });
    await settle("succeeded", null, effects);
  } catch (cause) {
    const error = String(cause instanceof Error ? cause.message : cause).slice(0, 1800), stage = (cause as { stage?: DeliveryStage } | null)?.stage;
    if (stage === "unavailable") await unavailable(error);
    else await settle(stage === "handler" ? "failed" : "unknown", stage === "handler" ? error : `Outcome unknown: ${error}`);
  }
}

/** Four independent modules can progress; a slow module never holds the tick or another module's slot. */
export function drainSchedules(ports: StewardPorts, workspaceId: string, now = ports.now()): Promise<void> {
  let map = active.get(ports.db);
  if (!map) { map = new Map(); active.set(ports.db, map); }
  let pool = map.get(workspaceId);
  if (!pool) { pool = { jobs: new Map() }; map.set(workspaceId, pool); }
  const state = pool;
  state.scan ??= (async () => {
    const interrupted = await ports.db.moduleInvocation.findMany({ where: { workspaceId, mode: "schedule", status: "running", leaseUntil: { lte: now } } });
    for (const row of interrupted) {
      await ports.db.$transaction(async tx => {
        const changed = await tx.moduleInvocation.updateMany({ where: { id: row.id, status: "running", leaseToken: row.leaseToken }, data: { status: "unknown", error: "Delivery interrupted; outcome unknown", leaseToken: null, leaseUntil: null, finishedAt: now } });
        const occurrence = row.args as unknown as Occurrence;
        if (changed.count) {
          await tx.schedule.updateMany({ where: { id: occurrence.scheduleId, lastAt: new Date(occurrence.claimedAt) }, data: { lastResult: "Delivery interrupted; outcome unknown" } });
          await notifyUser(tx, ports, workspaceId, { level: "now", title: "日程结果待核对", body: `${row.target} 的日程在投递中断开，结果未知；不会自动重放，请核对实际结果。`, key: `schedule-delivery:${row.id}` });
        }
      });
    }
    const rows = await ports.db.moduleInvocation.findMany({ where: { workspaceId, mode: "schedule", status: "queued", nextAttemptAt: { lte: now }, target: { notIn: [...state.jobs.keys()] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100 });
    const groups = new Map<string, typeof rows>();
    for (const row of rows) { const group = groups.get(row.target) ?? []; group.push(row); groups.set(row.target, group); }
    for (const [target, rows] of groups) {
      if (state.jobs.has(target)) continue;
      if (state.jobs.size >= 4) break;
      const job = (async () => { for (const row of rows) await deliver(ports, row, now); })().finally(() => state.jobs.delete(target));
      state.jobs.set(target, job);
      // The returned drain promise observes failures; attach now while the scan is still admitting jobs.
      void job.catch(() => {});
    }
  })().finally(() => { state.scan = undefined; });
  return state.scan.then(async () => { await Promise.all([...state.jobs.values()]); });
}
export async function schedulesSettled(ports: StewardPorts) {
  for (const pool of active.get(ports.db)?.values() ?? []) {
    await pool.scan;
    await Promise.all([...pool.jobs.values()]);
  }
}
