import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { moduleSupervisor, type DeliveryStage } from "./module-supervisor";
import { randomUUID } from "node:crypto";
import { notifyLifecycle } from "./notify-user";
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

type Row = Prisma.ModuleInvocationGetPayload<object>;
type Settled = "queued" | "succeeded" | "failed" | "unknown" | "cancelled";

async function settle(ports: StewardPorts, row: Row, token: string, now: Date, outcome: { status: Settled; error: string | null; effects?: number }) {
  const { status, error, effects = 0 } = outcome, occurrence = row.args as unknown as Occurrence;
  await ports.db.$transaction(async tx => {
    const changed = await tx.moduleInvocation.updateMany({ where: { id: row.id, status: "running", leaseToken: token }, data: { status, error, leaseToken: null, leaseUntil: null, finishedAt: status === "queued" ? null : ports.now(), nextAttemptAt: status === "queued" ? new Date(now.getTime() + Math.min(3600_000, 30_000 * 2 ** row.attempts)) : null } });
    if (!changed.count) return;
    if (status === "failed" || status === "unknown") await notifyLifecycle(tx, ports, row.workspaceId, `schedule-delivery:${row.id}`, { kind: "schedule-failed", target: row.target, status, error });
    const delay = Date.parse(occurrence.claimedAt) - Date.parse(occurrence.firedAt);
    await tx.schedule.updateMany({ where: { id: occurrence.scheduleId, lastAt: new Date(occurrence.claimedAt) }, data: {
      lastResult: `Module exit ${status === "succeeded" ? 0 : -1}; effects ${effects}; delay ${delay}ms${error ? `; ${error}` : ""}`.slice(0, 2000),
      failures: status === "succeeded" ? 0 : { increment: 1 },
    } });
  });
}

type Block = { blocked: true; status: "cancelled" | "failed" | "unavailable"; reason: string };
const block = (status: Block["status"], reason: string): Block => ({ blocked: true, status, reason });
/** The occurrence is bound to one version and activation; anything else is never replayed. */
async function staleVersion(db: StewardPorts["db"], row: Row, occurrence: Occurrence, module: { id: string; activeHash: string | null }) {
  if (module.activeHash !== occurrence.hash) return block("cancelled", "Module version changed; occurrence was not replayed");
  const activationId = module.activeHash ? (await latestModuleEvolution(db, row.workspaceId, module.id, module.activeHash))?.activationId ?? null : null;
  return module.activeHash && activationId !== occurrence.activationId ? block("cancelled", "Module activation changed; occurrence was not replayed") : null;
}
/** Why this occurrence must not be delivered now; "unavailable" is retried with backoff. */
async function blocked(db: StewardPorts["db"], row: Row, occurrence: Occurrence) {
  const schedule = await db.schedule.findUnique({ where: { id: occurrence.scheduleId } });
  const module = occurrence.moduleId ? await db.module.findFirst({ where: { id: occurrence.moduleId, workspaceId: row.workspaceId } }) : null;
  if (!schedule || schedule.status === "cancelled") return block("cancelled", "Module schedule replaced");
  if (!module) return block("failed", "Module missing");
  const stale = await staleVersion(db, row, occurrence, module);
  if (stale) return stale;
  if (module.status !== "active" || schedule.status === "paused") return block("unavailable", "Module is paused");
  if (!module.activeHash) return block("unavailable", "Module has no active hash");
  return { blocked: false as const, module: { id: module.id, hash: module.activeHash }, schedule };
}

async function deliver(ports: StewardPorts, row: Row, now: Date) {
  const { db } = ports, token = randomUUID(), occurrence = row.args as unknown as Occurrence;
  const claimed = await db.moduleInvocation.updateMany({ where: { id: row.id, status: "queued" }, data: { status: "running", attempts: { increment: 1 }, leaseToken: token, leaseUntil: new Date(now.getTime() + 660_000) } });
  if (!claimed.count) return;
  const done = (status: Settled, error: string | null, effects?: number) => settle(ports, row, token, now, { status, error, effects });
  const unavailable = (reason: string) => done(row.attempts + 1 < MAX_ATTEMPTS ? "queued" : "failed", reason);
  try {
    const target = await blocked(db, row, occurrence);
    if (target.blocked) return target.status === "unavailable" ? unavailable(target.reason) : done(target.status, target.reason);
    const { module, schedule } = target, triggerId = occurrence.triggerId ?? `s-${schedule.id}`;
    await moduleSupervisor(ports).deliver(module.id, module.hash, { trigger: { id: triggerId, kind: "schedule", firedAt: occurrence.firedAt, ...(occurrence.payload !== null ? { scheduleId: schedule.id, payload: occurrence.payload as Record<string, unknown> } : {}) }, now: now.toISOString(), params: {} }, { activationId: occurrence.activationId });
    const effects = await db.moduleCall.count({ where: { moduleId: module.id, hash: module.hash, eventKey: `${triggerId}:${occurrence.firedAt}` } });
    await done("succeeded", null, effects);
  } catch (cause) {
    const error = String(cause instanceof Error ? cause.message : cause).slice(0, 1800), stage = (cause as { stage?: DeliveryStage } | null)?.stage;
    if (stage === "unavailable") await unavailable(error);
    else await done(stage === "handler" ? "failed" : "unknown", stage === "handler" ? error : `Outcome unknown: ${error}`);
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
          await notifyLifecycle(tx, ports, workspaceId, `schedule-delivery:${row.id}`, { kind: "schedule-failed", target: row.target, status: "unknown", disconnected: true });
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
