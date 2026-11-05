import { Prisma } from "@chrona/db/generated/prisma/client";
import { createScheduleSchema, updateScheduleSchema, scheduleRuleSchema, moduleScheduleSchema } from "@chrona/contracts/steward";
import { nextOccurrence } from "@chrona/domain/steward/schedule-rule";
import type { StewardPorts } from "./ports";
import { parseInput, StewardError } from "./errors";
import { toSchedule } from "./store";
import { notificationSettings } from "./settings";
import { createRuns, createRunSession } from "./runs";
import { audit } from "./audit";
import { drainSchedules, enqueueSchedule } from "./schedule-delivery";

function beforeDeadline(nextAt: Date | null, until: Date | null): Date | null {
  return until && nextAt && nextAt > until ? null : nextAt;
}
function nextDueOccurrence(rule: Parameters<typeof nextOccurrence>[0], now: Date, zone: string, until: Date | null): Date | null {
  const nextAt = nextOccurrence(rule, now, zone);
  if (until && now > until) return null;
  return beforeDeadline(nextAt, until);
}

async function validateScheduleMode(tx: Prisma.TransactionClient, workspaceId: string, originSessionId: string | undefined) {
  if (originSessionId && !await tx.session.findFirst({ where: { id: originSessionId, workspaceId } })) throw new StewardError("not_found", "Session not found");
  if (!originSessionId) throw new StewardError("invalid", "Wake requires an origin session");
}
export function createSchedules(ports: StewardPorts, workspaceId: string) {
  const { db } = ports, runs = createRuns(ports, workspaceId);
  const timezone = async () => notificationSettings((await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings).timezone;
  async function create(originSessionId: string | undefined, raw: unknown, createdBy: "user" | "chrona" = "user") {
    const input = parseInput(createScheduleSchema, raw), now = ports.now();
    let nextAt = nextOccurrence(input.rule, now, await timezone());
    // "Do it now" one-shots arrive with a time that is already past by the time they are stored: fire on the next tick.
    if (!nextAt && input.rule.kind === "at") nextAt = now;
    const until = input.until ? new Date(input.until) : null;
    nextAt = beforeDeadline(nextAt, until);
    return db.$transaction(async tx => {
      await validateScheduleMode(tx, workspaceId, originSessionId);
      const row = await tx.schedule.create({ data: { ...input, label: input.label ?? null, workspaceId, originSessionId, createdBy, createdAt: now, until, nextAt, status: nextAt ? "active" : "done" } });
      await audit(tx, { workspaceId, actor: createdBy, kind: "schedule_created", subjectId: row.id, details: {} });
      return toSchedule(row);
    });
  }
  async function update(id: string, raw: unknown) {
    const input = parseInput(updateScheduleSchema, raw), zone = await timezone();
    return db.$transaction(async tx => {
      const row = await tx.schedule.findFirst({ where: { id, workspaceId } });
      if (!row) throw new StewardError("not_found", "Schedule not found");
      if (row.mode === "module" && row.payload === null) throw new StewardError("conflict", "Module schedules change only through module activation or rollback; the active version keeps running until a new version is approved");
      let nextAt = row.nextAt;
      if (input.status === "active") nextAt = nextOccurrence(scheduleRuleSchema.parse(row.rule), ports.now(), zone);
      if (row.until && nextAt && nextAt > row.until) nextAt = null;
      if (input.status === "cancelled") await tx.moduleInvocation.updateMany({ where: { workspaceId, mode: "schedule", key: { startsWith: `${id}:` }, status: "queued" }, data: { status: "cancelled", finishedAt: ports.now(), error: "Schedule cancelled before delivery" } });
      const result = await tx.schedule.update({ where: { id }, data: { status: input.status === "active" && !nextAt ? "done" : input.status, nextAt, ...(input.status === "active" ? { failures: 0 } : {}) } });
      await audit(tx, { workspaceId, actor: "user", kind: "schedule_updated", subjectId: id, details: input });
      return toSchedule(result);
    });
  }
  async function fireDue(now = ports.now(), { waitForDelivery = true } = {}) {
    const zone = await timezone();
    const rows = await db.schedule.findMany({ where: { workspaceId, status: "active", nextAt: { lte: now } }, orderBy: { nextAt: "asc" } });
    let fired = 0;
    for (const row of rows) {
      // Advancing and recording delivery are atomic; effects run outside the tick.
      const rule = scheduleRuleSchema.parse(row.rule), delayMs = now.getTime() - row.nextAt!.getTime();
      const nextAt = nextDueOccurrence(rule, now, zone, row.until);
      const expired = !!row.until && now > row.until;
      const claimed = await db.$transaction(async tx => {
        if (row.mode === "module" && await tx.moduleInvocation.count({ where: { workspaceId, mode: "schedule", key: { startsWith: `${row.id}:` }, status: { in: ["queued", "running"] } } })) return false;
        const changed = await tx.schedule.updateMany({ where: { id: row.id, status: "active", nextAt: row.nextAt }, data: { nextAt, status: nextAt ? "active" : "done", ...(!expired ? { lastAt: now, lastResult: `Queued; delay ${delayMs}ms` } : {}) } });
        if (!changed.count || expired) return false;
        if (row.mode === "wake") {
          const session = await createRunSession(tx, workspaceId, "wake", now, { originSessionId: row.originSessionId ?? undefined });
          await runs.enqueue({ sessionId: session.id, lane: "background", trigger: "schedule", label: row.label, prompt: `${row.text}\n\nSchedule ${row.id}; fired ${delayMs}ms late.` }, tx);
        }
        if (row.mode === "module") await enqueueSchedule(tx, workspaceId, row, now);
        await audit(tx, { workspaceId, actor: "chrona", kind: "schedule_fired", subjectId: row.id, details: { delayMs, mode: row.mode } });
        return true;
      });
      if (!claimed) continue;
      fired++;
      if (row.mode === "module") continue;
      await db.schedule.update({ where: { id: row.id }, data: { lastResult: `Fired; delay ${delayMs}ms`, failures: 0 } });
    }
    if (waitForDelivery) await drainSchedules(ports, workspaceId, now);
    return fired;
  }
  return { create, update, cancel: (id: string) => update(id, { status: "cancelled" }), list: async (originSessionId?: string) => (await db.schedule.findMany({ where: { workspaceId, ...(originSessionId ? { originSessionId } : {}) }, orderBy: { createdAt: "desc" } })).map(toSchedule), fireDue, forModule: (moduleId: string, module: string) => moduleTimers(ports, workspaceId, timezone, moduleId, module) };
}
export const MODULE_SCHEDULE_LIMIT = 500;
/**
 * v2-24: a module's own timers (`text` holds the key; they have no triggerId). The key names one
 * timer of the module: creating it again replaces its rule and payload; at the time the module receives a schedule
 * event carrying the payload.
 */
function moduleTimers(ports: StewardPorts, workspaceId: string, timezone: () => Promise<string>, moduleId: string, module: string) {
  const { db } = ports;
  const own = (key: string) => ({ workspaceId, moduleId, mode: "module", triggerId: null, text: key, payload: { not: Prisma.DbNull }, status: { in: ["active", "paused"] } });
  return {
    async create(raw: unknown) {
      const input = parseInput(moduleScheduleSchema, raw), now = ports.now();
      let nextAt = nextOccurrence(input.rule, now, await timezone());
      if (!nextAt && input.rule.kind === "at") nextAt = now;
      const until = input.until ? new Date(input.until) : null;
      nextAt = beforeDeadline(nextAt, until);
      return db.$transaction(async tx => {
        const current = await tx.schedule.findFirst({ where: own(input.key) });
        const prior = await tx.schedule.findMany({ where: { workspaceId, moduleId, mode: "module", text: input.key, triggerId: null }, select: { id: true } });
        for (const schedule of prior) await tx.moduleInvocation.updateMany({ where: { workspaceId, mode: "schedule", key: { startsWith: `${schedule.id}:` }, status: "queued" }, data: { status: "cancelled", finishedAt: now, error: "Timer replaced before delivery" } });
        const data = { rule: input.rule, payload: input.payload as Prisma.InputJsonValue, label: input.label, until, nextAt, status: nextAt ? "active" : "done", failures: 0 };
        if (!current && await tx.schedule.count({ where: { workspaceId, moduleId, payload: { not: Prisma.DbNull }, status: { in: ["active", "paused"] } } }) >= MODULE_SCHEDULE_LIMIT) throw new StewardError("conflict", `A module keeps at most ${MODULE_SCHEDULE_LIMIT} timers; cancel some first`);
        const row = current
          ? await tx.schedule.update({ where: { id: current.id }, data })
          : await tx.schedule.create({ data: { ...data, workspaceId, moduleId, mode: "module", text: input.key, createdBy: "module", createdAt: now } });
        await audit(tx, { workspaceId, actor: `module:${module}`, kind: current ? "schedule_updated" : "schedule_created", subjectId: row.id, details: { key: input.key } });
        return toSchedule(row);
      });
    },
    async cancel(key: string) {
      return db.$transaction(async tx => {
        const current = await tx.schedule.findFirst({ where: { ...own(key), status: { in: ["active", "paused", "done"] } }, orderBy: { createdAt: "desc" } });
        if (!current) return { cancelled: false };
        await tx.moduleInvocation.updateMany({ where: { workspaceId, mode: "schedule", key: { startsWith: `${current.id}:` }, status: "queued" }, data: { status: "cancelled", finishedAt: ports.now(), error: "Timer cancelled before delivery" } });
        await tx.schedule.update({ where: { id: current.id }, data: { status: "cancelled", nextAt: null } });
        await audit(tx, { workspaceId, actor: `module:${module}`, kind: "schedule_updated", subjectId: current.id, details: { key, status: "cancelled" } });
        return { cancelled: true };
      });
    },
    list: async () => (await db.schedule.findMany({ where: { workspaceId, moduleId, payload: { not: Prisma.DbNull }, status: { in: ["active", "paused"] } }, orderBy: { nextAt: "asc" } })).map(row => ({ key: row.text, ...toSchedule(row), payload: row.payload })),
  };
}

