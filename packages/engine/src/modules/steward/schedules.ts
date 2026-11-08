import { Prisma } from "@chrona/db/generated/prisma/client";
import { updateScheduleSchema, scheduleRuleSchema, moduleScheduleSchema, isEntryModule, moduleManifestSchema } from "@chrona/contracts/steward";
import { z } from "zod";
import { nextOccurrence } from "@chrona/domain/steward/schedule-rule";
import type { StewardPorts } from "./ports";
import { parseInput, StewardError } from "./errors";
import { toSchedule } from "./store";
import { budgetTimezone } from "./settings";
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

export function createSchedules(ports: StewardPorts, workspaceId: string) {
  const { db } = ports;
  const timezone = async () => budgetTimezone((await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings);
  async function update(id: string, raw: unknown) {
    const input = parseInput(updateScheduleSchema, raw), zone = await timezone();
    return db.$transaction(async tx => {
      const row = await tx.schedule.findFirst({ where: { id, workspaceId } });
      if (!row) throw new StewardError("not_found", "Schedule not found");
      if (row.mode === "wake" && input.status === "active") throw new StewardError("conflict", "Legacy wake timers require stopped-service migration to their entry application");
      if (row.mode === "module" && row.payload === null) throw new StewardError("conflict", "Module schedules change only through module activation or rollback; the active version keeps running until a new version is approved");
      let nextAt = row.nextAt;
      if (input.status === "active") nextAt = nextOccurrence(scheduleRuleSchema.parse(row.rule), ports.now(), zone);
      nextAt = beforeDeadline(nextAt, row.until);
      if (input.status === "cancelled") await tx.moduleInvocation.updateMany({ where: { workspaceId, mode: "schedule", key: { startsWith: `${id}:` }, status: "queued" }, data: { status: "cancelled", finishedAt: ports.now(), error: "Schedule cancelled before delivery" } });
      const result = await tx.schedule.update({ where: { id }, data: { status: input.status === "active" && !nextAt ? "done" : input.status, nextAt, ...(input.status === "active" ? { failures: 0 } : {}) } });
      await audit(tx, { workspaceId, actor: "user", kind: "schedule_updated", subjectId: id, details: input });
      return toSchedule(result);
    });
  }
  async function fireDue(now = ports.now(), { waitForDelivery = true } = {}) {
    const zone = await timezone();
    const rows = await db.schedule.findMany({ where: { workspaceId, status: "active", nextAt: { lte: now } }, orderBy: { nextAt: "asc" } });
    if (rows.some(row => row.mode === "wake")) throw new StewardError("conflict", "Legacy wake timers require stopped-service migration to their entry application");
    let fired = 0;
    for (const row of rows) {
      // Advancing and recording delivery are atomic; effects run outside the tick.
      const rule = scheduleRuleSchema.parse(row.rule), delayMs = now.getTime() - row.nextAt!.getTime();
      const nextAt = nextDueOccurrence(rule, now, zone, row.until);
      const expired = !!row.until && now > row.until;
      const claimed = await db.$transaction(async tx => {
        if (await tx.moduleInvocation.count({ where: { workspaceId, mode: "schedule", key: { startsWith: `${row.id}:` }, status: { in: ["queued", "running"] } } })) return false;
        const changed = await tx.schedule.updateMany({ where: { id: row.id, status: "active", nextAt: row.nextAt }, data: { nextAt, status: nextAt ? "active" : "done", ...(!expired ? { lastAt: now, lastResult: `Queued; delay ${delayMs}ms` } : {}) } });
        if (!changed.count || expired) return false;
        await enqueueSchedule(tx, workspaceId, row, now);
        await audit(tx, { workspaceId, actor: "chrona", kind: "schedule_fired", subjectId: row.id, details: { delayMs, mode: row.mode } });
        return true;
      });
      if (!claimed) continue;
      fired++;
    }
    if (waitForDelivery) await drainSchedules(ports, workspaceId, now);
    return fired;
  }
  return { update, cancel: (id: string) => update(id, { status: "cancelled" }), list: async (originSessionId?: string, timersOnly = false) => (await db.schedule.findMany({ where: { workspaceId, ...(originSessionId ? { originSessionId } : {}), ...(timersOnly ? { OR: [{ mode: "wake" as const }, { mode: "module" as const, payload: { not: Prisma.DbNull } }] } : {}) }, orderBy: { createdAt: "desc" } })).map(toSchedule), fireDue, forModule: (moduleId: string, module: string) => moduleTimers(ports, workspaceId, timezone, moduleId, module) };
}
export const MODULE_SCHEDULE_LIMIT = 500;

/** Follow only persisted origin links; never accept a caller-supplied replacement owner. */
async function legacyWakeOwner(tx: Prisma.TransactionClient, workspaceId: string, originSessionId: string | null) {
  const seen = new Set<string>();
  let id = originSessionId;
  while (id && seen.size < 32 && !seen.has(id)) {
    seen.add(id);
    const origin = await tx.session.findFirst({ where: { id, workspaceId } });
    if (!origin) break;
    if (origin.entryModuleId) return tx.module.findFirst({ where: { id: origin.entryModuleId, workspaceId } });
    const module = await tx.module.findFirst({ where: { workspaceId, ...(origin.source === "module" && origin.moduleId ? { id: origin.moduleId } : { name: origin.source }) } });
    if (module) return module;
    id = origin.originSessionId;
  }
  return null;
}
const wakeMigrationSchema = z.object({ stopped: z.literal(true), limit: z.number().int().min(1).max(500), owners: z.array(z.object({ moduleId: z.string().min(1), hash: z.string().min(1) }).strict()).max(100) }).strict();
async function approvedLegacyWakeOwner(tx: Prisma.TransactionClient, workspaceId: string, row: { id: string; originSessionId: string | null }, owners: z.infer<typeof wakeMigrationSchema>["owners"]) {
  const module = await legacyWakeOwner(tx, workspaceId, row.originSessionId);
  const error = () => new StewardError("conflict", `Wake ${row.id} requires its actual approved entry owner and a checked handler`);
  if (!module || !module.activeHash) throw error();
  const approved = owners.find(owner => owner.moduleId === module.id && owner.hash === module.activeHash);
  if (!approved) throw error();
  const version = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: approved.moduleId, hash: approved.hash } } });
  const manifest = moduleManifestSchema.safeParse(version?.manifest).data;
  if (!version || version.status !== "approved" || !manifest || !isEntryModule(manifest) || !["active", "paused"].includes(module.status)) throw error();
  return { module, approved };
}
/** Explicit offline operation. owners pins the approved entry versions whose legacy-wake handlers were checked by the operator. */
export async function migrateLegacyWakeTimers(ports: StewardPorts, workspaceId: string, raw: z.input<typeof wakeMigrationSchema>) {
  const input = parseInput(wakeMigrationSchema, raw);
  return ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
    if (await tx.run.count({ where: { workspaceId, OR: [{ status: { in: ["queued", "running"] } }, { error: "Execution stop is unconfirmed" }, { startedAt: { not: null }, execution: { stopConfirmedAt: null } }] } }) ||
        await tx.moduleInvocation.count({ where: { workspaceId, status: { in: ["queued", "running", "unknown"] } } })) throw new StewardError("conflict", "Stop and reconcile outstanding work before wake migration");
    const rows = await tx.schedule.findMany({ where: { workspaceId, mode: "wake", status: { in: ["active", "paused"] } }, orderBy: { id: "asc" }, take: input.limit + 1 });
    if (rows.length > input.limit) throw new StewardError("conflict", "Wake migration exceeds the explicit limit; nothing migrated");
    const migrated: { scheduleId: string; moduleId: string; hash: string }[] = [];
    for (const row of rows) {
      const { module, approved } = await approvedLegacyWakeOwner(tx, workspaceId, row, input.owners);
      if (row.status === "active" && module.status !== "active") throw new StewardError("conflict", `Wake ${row.id} has a paused owner`);
      if (await tx.schedule.count({ where: { workspaceId, moduleId: module.id, mode: "module", payload: { not: Prisma.DbNull }, status: { in: ["active", "paused"] } } }) >= MODULE_SCHEDULE_LIMIT) throw new StewardError("conflict", `Wake owner ${module.name} has reached its timer limit`);
      const payload = { kind: "legacy-wake", originSessionId: row.originSessionId, text: row.text };
      if (JSON.stringify(payload).length > 4000) throw new StewardError("conflict", `Wake ${row.id} exceeds module timer payload bounds`);
      await tx.schedule.update({ where: { id: row.id }, data: { mode: "module", moduleId: module.id, triggerId: null, text: `legacy-wake:${row.id}`, payload } });
      await audit(tx, { workspaceId, actor: "user", kind: "wake_timer_migrated", subjectId: row.id, details: { moduleId: module.id, hash: approved.hash, originSessionId: row.originSessionId } });
      migrated.push({ scheduleId: row.id, moduleId: module.id, hash: approved.hash });
    }
    return { migrated };
  });
}
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

