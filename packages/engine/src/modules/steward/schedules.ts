import type { Prisma } from "@chrona/db";
import { createScheduleSchema, updateScheduleSchema, scheduleRuleSchema } from "@chrona/contracts/steward";
import { nextOccurrence } from "@chrona/domain/steward/schedule-rule";
import type { StewardPorts } from "./ports";
import { requireAffair } from "./affairs";
import { parseInput, StewardError } from "./errors";
import { toSchedule } from "./store";
import { notificationSettings } from "./settings";
import { enqueueNotification } from "./notify";
import { createRuns } from "./runs";
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
    await moduleSupervisor(ports).deliver(moduleId, hash, { trigger: { id: row.triggerId!, kind: "schedule", firedAt: row.nextAt!.toISOString() }, now: now.toISOString(), params: {} });
    exitCode = 0;
  } catch (cause) {
    error = (cause instanceof Error ? cause.message : String(cause)).slice(0, 2000);
  }
  return { error, exitCode };
}
function moduleResultSummary(exitCode: number, effectCount: number, delayMs: number, error: string | null) {
  return `Module exit ${exitCode}; effects ${effectCount}; delay ${delayMs}ms${error ? `; ${error}` : ""}`.slice(0, 2000);
}

export function createSchedules(ports: StewardPorts, workspaceId: string) {
  const { db } = ports, runs = createRuns(ports, workspaceId);
  const timezone = async () => notificationSettings((await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings).timezone;
  async function create(affairId: string, raw: unknown, createdBy: "user" | "chrona" = "user") {
    const input = parseInput(createScheduleSchema, raw), now = ports.now();
    let nextAt = nextOccurrence(input.rule, now, await timezone());
    // "Do it now" one-shots arrive with a time that is already past by the time they are stored: fire on the next tick.
    if (!nextAt && input.rule.kind === "at") nextAt = now;
    const until = input.until ? new Date(input.until) : null;
    nextAt = beforeDeadline(nextAt, until);
    return db.$transaction(async tx => {
      const affair = await requireAffair(tx, workspaceId, affairId);
      if (affair.status !== "active") throw new StewardError("conflict", "Affair is not active");
      const row = await tx.schedule.create({ data: { ...input, label: input.label ?? null, workspaceId, affairId, createdBy, createdAt: now, until, nextAt, status: nextAt ? "active" : "done" } });
      await audit(tx, { workspaceId, actor: createdBy, kind: "schedule_created", subjectId: row.id, details: {} });
      return toSchedule(row);
    });
  }
  async function update(id: string, raw: unknown) {
    const input = parseInput(updateScheduleSchema, raw), zone = await timezone();
    return db.$transaction(async tx => {
      const row = await tx.schedule.findFirst({ where: { id, workspaceId } });
      if (!row) throw new StewardError("not_found", "Schedule not found");
      if (row.mode === "module") throw new StewardError("conflict", "Module schedules change only through module activation or rollback; the active version keeps running until a new version is approved");
      const affair = await requireAffair(tx, workspaceId, row.affairId);
      if (input.status === "active" && affair.status !== "active") throw new StewardError("conflict", "Affair is not active");
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
    const callCount = await db.moduleCall.count({ where: { moduleId: module.id, hash, eventKey: `${row.triggerId}:${row.nextAt!.toISOString()}` } });
    await db.schedule.update({ where: { id: row.id }, data: { failures: error ? { increment: 1 } : 0, lastResult: moduleResultSummary(exitCode, callCount, delayMs, error) } });
  }
  async function fireDue(now = ports.now()) {
    const zone = await timezone(), chatBound = ports.chat ? await ports.chat.bound() : false;
    const context = { now, chatBound, publicUrl: ports.publicUrl };
    const rows = await db.schedule.findMany({ where: { workspaceId, status: "active", nextAt: { lte: now }, affair: { status: "active" } }, include: { affair: true }, orderBy: { nextAt: "asc" } });
    let fired = 0;
    for (const row of rows) {
      // Advance before external execution: concurrent ticks/downtime fire at most once.
      // A crash leaves lastResult at "Firing" for inspection; it does not rerun external work.
      const rule = scheduleRuleSchema.parse(row.rule), delayMs = now.getTime() - row.nextAt!.getTime();
      const nextAt = nextDueOccurrence(rule, now, zone, row.until);
      const expired = !!row.until && now > row.until;
      const claimed = await db.$transaction(async tx => {
        const changed = await tx.schedule.updateMany({ where: { id: row.id, status: "active", nextAt: row.nextAt, affair: { status: "active" } }, data: { nextAt, status: nextAt ? "active" : "done", ...(!expired ? { lastAt: now, lastResult: `Firing; delay ${delayMs}ms` } : {}) } });
        if (!changed.count || expired) return false;
        if (row.mode === "remind") await enqueueNotification(tx, { workspaceId, affairId: row.affairId, level: "now", title: row.affair.title, body: row.text, dedupeKey: `schedule:${row.id}:${row.nextAt!.toISOString()}` }, context);
        if (row.mode === "wake") await runs.enqueue({ affairId: row.affairId, lane: "background", trigger: "schedule", label: row.label, prompt: `${row.text}\n\nSchedule ${row.id}; fired ${delayMs}ms late.` }, tx);
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
  return { create, update, cancel: (id: string) => update(id, { status: "cancelled" }), list: async (affairId: string) => { await requireAffair(db, workspaceId, affairId); return (await db.schedule.findMany({ where: { workspaceId, affairId }, orderBy: { createdAt: "desc" } })).map(toSchedule); }, fireDue };
}
