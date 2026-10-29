import { Prisma } from "@chrona/db/generated/prisma/client";
import { createScheduleSchema, updateScheduleSchema, scheduleRuleSchema, moduleManifestSchema, moduleScheduleSchema } from "@chrona/contracts/steward";
import { nextOccurrence } from "@chrona/domain/steward/schedule-rule";
import type { StewardPorts } from "./ports";
import { parseInput, StewardError } from "./errors";
import { toSchedule } from "./store";
import { notificationSettings } from "./settings";
import { createRuns, createRunSession } from "./runs";
import { audit } from "./audit";
import { moduleSupervisor } from "./module-supervisor";

function beforeDeadline(nextAt: Date | null, until: Date | null): Date | null {
  return until && nextAt && nextAt > until ? null : nextAt;
}
function nextDueOccurrence(rule: Parameters<typeof nextOccurrence>[0], now: Date, zone: string, until: Date | null): Date | null {
  const nextAt = nextOccurrence(rule, now, zone);
  if (until && now > until) return null;
  return beforeDeadline(nextAt, until);
}

async function runScheduledModule(ports: StewardPorts, row: Prisma.ScheduleGetPayload<object>, moduleId: string, hash: string, now: Date) {
  let error: string | null = null, exitCode = -1;
  try {
    await moduleSupervisor(ports).deliver(moduleId, hash, { trigger: { id: row.triggerId ?? `s-${row.id}`, kind: "schedule", firedAt: row.nextAt!.toISOString(), ...(row.payload !== null ? { scheduleId: row.id, payload: row.payload as Record<string, unknown> } : {}) }, now: now.toISOString(), params: {} });
    exitCode = 0;
  } catch (cause) {
    error = (cause instanceof Error ? cause.message : String(cause)).slice(0, 2000);
  }
  return { error, exitCode };
}
function moduleResultSummary(exitCode: number, effectCount: number, delayMs: number, error: string | null) {
  return `Module exit ${exitCode}; effects ${effectCount}; delay ${delayMs}ms${error ? `; ${error}` : ""}`.slice(0, 2000);
}

async function validateRemind(tx: Prisma.TransactionClient, workspaceId: string, remind: Awaited<ReturnType<Prisma.TransactionClient["module"]["findFirst"]>>) {
  const version = remind?.activeHash ? await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: remind.id, hash: remind.activeHash } } }) : null;
  const manifest = moduleManifestSchema.safeParse(version?.manifest);
  if (!remind || !manifest.success || !manifest.data.dynamicSchedules) throw new StewardError("conflict", "Built-in remind module does not accept dynamic schedules");
}
async function validateScheduleMode(tx: Prisma.TransactionClient, workspaceId: string, originSessionId: string | undefined, mode: string) {
  if (originSessionId && !await tx.session.findFirst({ where: { id: originSessionId, workspaceId } })) throw new StewardError("not_found", "Session not found");
  if (mode === "wake" && !originSessionId) throw new StewardError("invalid", "Wake requires an origin session");
  const remind = mode === "remind" ? await tx.module.findFirst({ where: { workspaceId, name: "remind", builtin: true } }) : null;
  if (mode === "remind") await validateRemind(tx, workspaceId, remind);
  return remind;
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
      const remind = await validateScheduleMode(tx, workspaceId, originSessionId, input.mode);
      const row = await tx.schedule.create({ data: { ...input, ...(remind ? { mode: "module", moduleId: remind.id, payload: { text: input.text } } : {}), label: input.label ?? null, workspaceId, originSessionId, createdBy, createdAt: now, until, nextAt, status: nextAt ? "active" : "done" } });
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
      const result = await tx.schedule.update({ where: { id }, data: { status: input.status === "active" && !nextAt ? "done" : input.status, nextAt, ...(input.status === "active" ? { failures: 0 } : {}) } });
      await audit(tx, { workspaceId, actor: "user", kind: "schedule_updated", subjectId: id, details: input });
      return toSchedule(result);
    });
  }
  async function executeModule(row: Prisma.ScheduleGetPayload<object>, now: Date, delayMs: number) {
    const module = row.moduleId ? await db.module.findFirst({ where: { id: row.moduleId, workspaceId } }) : null;
    const schedule = await db.schedule.findUnique({ where: { id: row.id } });
    const skip = !module ? "Module missing" : module.status !== "active" ? "Module is paused" : !module.activeHash ? "Module has no active hash" : schedule?.status === "cancelled" ? "Module schedule replaced" : null;
    if (skip || !module?.activeHash) {
      await db.schedule.update({ where: { id: row.id }, data: { lastResult: skip } });
      return;
    }
    const hash = module.activeHash;
    const { error, exitCode } = await runScheduledModule(ports, row, module.id, hash, now);
    const callCount = await db.moduleCall.count({ where: { moduleId: module.id, hash, eventKey: `${row.triggerId ?? `s-${row.id}`}:${row.nextAt!.toISOString()}` } });
    await db.schedule.update({ where: { id: row.id }, data: { failures: error ? { increment: 1 } : 0, lastResult: moduleResultSummary(exitCode, callCount, delayMs, error) } });
  }
  async function fireDue(now = ports.now()) {
    const zone = await timezone();
    const rows = await db.schedule.findMany({ where: { workspaceId, status: "active", nextAt: { lte: now } }, orderBy: { nextAt: "asc" } });
    let fired = 0;
    for (const row of rows) {
      // Advance before external execution: concurrent ticks/downtime fire at most once.
      // A crash leaves lastResult at "Firing" for inspection; it does not rerun external work.
      const rule = scheduleRuleSchema.parse(row.rule), delayMs = now.getTime() - row.nextAt!.getTime();
      const nextAt = nextDueOccurrence(rule, now, zone, row.until);
      const expired = !!row.until && now > row.until;
      const claimed = await db.$transaction(async tx => {
        const changed = await tx.schedule.updateMany({ where: { id: row.id, status: "active", nextAt: row.nextAt }, data: { nextAt, status: nextAt ? "active" : "done", ...(!expired ? { lastAt: now, lastResult: `Firing; delay ${delayMs}ms` } : {}) } });
        if (!changed.count || expired) return false;
        if (row.mode === "wake") {
          const session = await createRunSession(tx, workspaceId, "wake", now, { originSessionId: row.originSessionId ?? undefined });
          await runs.enqueue({ sessionId: session.id, lane: "background", trigger: "schedule", label: row.label, prompt: `${row.text}\n\nSchedule ${row.id}; fired ${delayMs}ms late.` }, tx);
        }
        await audit(tx, { workspaceId, actor: "chrona", kind: "schedule_fired", subjectId: row.id, details: { delayMs, mode: row.mode } });
        return true;
      });
      if (!claimed) continue;
      fired++;
      if (row.mode === "module") {
        await executeModule(row, now, delayMs);
        continue;
      }
      await db.schedule.update({ where: { id: row.id }, data: { lastResult: `Fired; delay ${delayMs}ms`, failures: 0 } });
    }
    return fired;
  }
  return { create, update, cancel: (id: string) => update(id, { status: "cancelled" }), list: async (originSessionId?: string) => (await db.schedule.findMany({ where: { workspaceId, ...(originSessionId ? { originSessionId } : {}) }, orderBy: { createdAt: "desc" } })).map(toSchedule), fireDue, forModule: (moduleId: string, module: string) => moduleTimers(ports, workspaceId, timezone, moduleId, module) };
}
export const MODULE_SCHEDULE_LIMIT = 500;
/**
 * v2-24: a module's own timers (`text` holds the key, like remind's rows they have no triggerId). The key names one
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
        const current = await tx.schedule.findFirst({ where: own(key) });
        if (!current) return { cancelled: false };
        await tx.schedule.update({ where: { id: current.id }, data: { status: "cancelled", nextAt: null } });
        await audit(tx, { workspaceId, actor: `module:${module}`, kind: "schedule_updated", subjectId: current.id, details: { key, status: "cancelled" } });
        return { cancelled: true };
      });
    },
    list: async () => (await db.schedule.findMany({ where: { workspaceId, moduleId, payload: { not: Prisma.DbNull }, status: { in: ["active", "paused"] } }, orderBy: { nextAt: "asc" } })).map(row => ({ key: row.text, ...toSchedule(row), payload: row.payload })),
  };
}

