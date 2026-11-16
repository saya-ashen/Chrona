import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { moduleManifestSchema, timerSetInput, wakeBudgetSchema, type ModuleEvent } from "@chrona/contracts/steward";
import { Prisma } from "@chrona/db/generated/prisma/client";
import type { StewardPorts } from "./ports";
import type { Caller } from "./module-call-types";
import { CallError } from "./module-call-error";
import { moduleSupervisor } from "./module-supervisor";
import { isModulePaused } from "./module-availability";
import { withTimerLock } from "./timer-lock";
import { apiPage } from "./api-page";

import { storedTimerRule as storedRule, nextTimerAt, wakeAllowance, dispatchTimer, recoverTimers } from "./timer-delivery";
const timerIdentity = (workspaceId: string, moduleId: string, id: string) => `timer:${createHash("sha256").update(JSON.stringify([workspaceId, moduleId, id])).digest("hex")}`;
async function owner(db: Prisma.TransactionClient, workspaceId: string, caller: Caller) {
  if (caller.kind !== "module" || isModulePaused(caller.module)) throw new CallError("forbidden", "Timers require an active application");
  const module = await db.module.findFirst({ where: { workspaceId, id: caller.moduleId, activeHash: caller.hash, status: "active" } });
  const version = module && await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: caller.hash } } });
  if (!module || version?.status !== "approved" || moduleManifestSchema.parse(version.manifest).name !== caller.module) throw new CallError("forbidden", "Timer caller changed");
  return module;
}
const view = (row: { timerId: string; rule: Prisma.JsonValue; status: string; nextAt: Date | null; lastResult: string | null }) => {
  const rule = storedRule.parse(row.rule);
  return { id: row.timerId, revision: rule.revision, schedule: rule.schedule, status: row.status, nextAt: row.nextAt?.toISOString() ?? null, lastResult: row.lastResult };
};
async function listTimers(tx: Prisma.TransactionClient, workspaceId: string, moduleId: string, hash: string, args: Record<string, unknown>) {
  const rows = await tx.timer.findMany({ where: { workspaceId, moduleId } });
  for (const row of rows) {
    if (storedRule.parse(row.rule).hash === hash || row.status === "stale") continue;
    await tx.timer.update({ where: { id: row.id }, data: { status: "stale", nextAt: null } });
    row.status = "stale"; row.nextAt = null;
  }
  return apiPage(rows.map(row => view(row)), args, `timers:${workspaceId}:${moduleId}`, row => row.id);
}
export async function timerTool(ports: StewardPorts, workspaceId: string, caller: Caller, name: string, args: Record<string, unknown>) {
  return withTimerLock(ports, workspaceId, () => ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
    const module = await owner(tx, workspaceId, caller);
    if (name === "list") return listTimers(tx, workspaceId, module.id, module.activeHash!, args);
    const id = timerIdentity(workspaceId, module.id, String(args.id)), now = ports.now();
    if (name === "cancel") {
      await tx.timer.updateMany({ where: { id, workspaceId, moduleId: module.id }, data: { status: "cancelled", nextAt: null } });
      return { id: String(args.id), status: "cancelled" };
    }
    const input = timerSetInput.parse(args), workspace = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const wake = wakeBudgetSchema.parse((workspace.settings as { wake?: unknown } | null)?.wake ?? {});
    if (input.schedule.kind === "every" && input.schedule.milliseconds < wake.minIntervalMs) throw new CallError("invalid", "Timer interval is below the kernel minimum");
    const existing = await tx.timer.findUnique({ where: { id } });
    if (!existing && await tx.timer.count({ where: { workspaceId, moduleId: module.id } }) >= 100) throw new CallError("conflict", "An application may hold at most 100 timers");
    const nextAt = input.schedule.kind === "at" ? new Date(input.schedule.at) : new Date(now.getTime() + input.schedule.milliseconds);
    if (nextAt <= now) throw new CallError("invalid", "Timer time must be in the future");
    const data = { rule: { revision: randomUUID(), hash: module.activeHash!, schedule: input.schedule }, payload: input.payload ?? Prisma.JsonNull, status: "active", nextAt, lastResult: null };
    const row = await tx.timer.upsert({ where: { id }, create: { id, workspaceId, moduleId: module.id, timerId: input.id, ...data }, update: data });
    return view(row);
  }));
}

/** Claim and advance before I/O. A process loss is unknown and never automatically redelivered. */
async function claimTimer(ports: StewardPorts, workspaceId: string, timerId: string, now: Date) {
  return ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
    const row = await tx.timer.findFirst({ where: { id: timerId, workspaceId, status: "active", nextAt: { lte: now } } });
    if (!row?.moduleId || !row.nextAt) return null;
    const module = await tx.module.findFirst({ where: { id: row.moduleId, workspaceId, status: "active" } });
    if (!module?.activeHash || isModulePaused(module.name)) return null;
    const rule = storedRule.parse(row.rule);
    if (rule.hash !== module.activeHash) {
      await tx.timer.update({ where: { id: row.id }, data: { status: "stale", nextAt: null } });
      return null;
    }
    if (!(await wakeAllowance(tx, workspaceId, now))(module.id)) return null;
    const eventId = `timer-event:${createHash("sha256").update(JSON.stringify([row.id, rule.revision, row.nextAt.toISOString()])).digest("hex")}`;
    const nextAt = nextTimerAt(rule.schedule, row.nextAt, now);
    const event: ModuleEvent = { trigger: { kind: "timer", id: row.timerId, timerId: row.timerId, timerRevision: rule.revision, eventId, scheduledAt: row.nextAt.toISOString(), firedAt: now.toISOString(), payload: z.json().parse(row.payload) }, now: now.toISOString(), params: {} };
    await tx.timer.update({ where: { id: row.id }, data: { nextAt, lastAt: now, status: "running" } });
    await tx.moduleInvocation.upsert({ where: { id: eventId }, create: { id: eventId, workspaceId, caller: "kernel", target: module.name, targetIdentity: module.id, targetBound: true, targetModuleId: module.id, targetHash: module.activeHash, tool: "timer", args: { timerId: row.id, revision: rule.revision }, key: eventId, mode: "timer", status: "running", attempts: 1, createdAt: now }, update: { status: "running", error: null, finishedAt: null, createdAt: now, attempts: { increment: 1 } } });
    return { row, module, event, eventId, nextAt };
  });
}
const drains = new WeakMap<StewardPorts["db"], Map<string, Promise<void>>>();
export function drainTimers(ports: StewardPorts, workspaceId: string, now = ports.now()) {
  let workspaceDrains = drains.get(ports.db);
  if (!workspaceDrains) { workspaceDrains = new Map(); drains.set(ports.db, workspaceDrains); }
  const previous = workspaceDrains.get(workspaceId);
  if (previous) return previous;
  const work = (async () => {
    let recovered = timerRecovered.get(ports.db);
    if (!recovered) { recovered = new Set(); timerRecovered.set(ports.db, recovered); }
    if (!recovered.has(workspaceId)) {
      await recoverTimers(ports, workspaceId);
      recovered.add(workspaceId);
    }
    const allowed = await wakeAllowance(ports.db, workspaceId, now);
    const active = await ports.db.module.findMany({ where: { workspaceId, status: "active", activeHash: { not: null } }, select: { id: true, name: true } });
    const eligible = active.filter(module => !isModulePaused(module.name) && allowed(module.id)).map(module => module.id);
    const due = await ports.db.timer.findMany({ where: { workspaceId, moduleId: { in: eligible }, status: "active", nextAt: { lte: now } }, orderBy: [{ nextAt: "asc" }, { id: "asc" }], take: 100 });
    for (const timer of due) {
      const claim = await claimTimer(ports, workspaceId, timer.id, ports.now());
      if (!claim) continue;
      let status = "succeeded", error: string | null = null, deferred = false;
      try {
        await moduleSupervisor(ports).deliver(claim.module.id, claim.module.activeHash!, claim.event, { dispatch: send => dispatchTimer(ports, workspaceId, { timerId: timer.id, revision: storedRule.parse(claim.row.rule).revision, eventId: claim.eventId, scheduledAt: claim.row.nextAt! }, send) });
      } catch (cause) {
        deferred = !!(cause as { timerDeferred?: boolean }).timerDeferred;
        const stage = (cause as { stage?: string }).stage;
        status = stage === "handler" || stage === "unavailable" ? "failed" : "unknown";
        error = status === "unknown" ? "Timer delivery outcome unknown" : "Timer delivery failed";
      }
      await ports.db.$transaction(async tx => {
        await tx.moduleInvocation.update({ where: { id: claim.eventId }, data: { status: deferred ? "deferred" : status, error, finishedAt: ports.now() } });
        const current = await tx.timer.findUnique({ where: { id: timer.id } });
        if (current?.status !== "running" || storedRule.parse(current.rule).revision !== storedRule.parse(claim.row.rule).revision) return;
        if (deferred) return deferTimer(tx, timer.id, claim.module.id, claim.module.activeHash!, claim.row.nextAt, error);
        await tx.timer.update({ where: { id: timer.id }, data: { status: status === "succeeded" ? current.nextAt ? "active" : "done" : status, nextAt: status === "succeeded" ? current.nextAt : null, lastResult: error ?? "delivered" } });
      });
    }
  })().catch(error => { timerRecovered.get(ports.db)?.delete(workspaceId); throw error; }).finally(() => workspaceDrains.delete(workspaceId));
  workspaceDrains.set(workspaceId, work);
  return work;
}
const timerRecovered = new WeakMap<StewardPorts["db"], Set<string>>();

export async function timersSettled(ports: StewardPorts) { await Promise.all(drains.get(ports.db)?.values() ?? []); }

async function deferTimer(tx: Prisma.TransactionClient, timerId: string, moduleId: string, hash: string, nextAt: Date | null, error: string | null) {
  const module = await tx.module.findUnique({ where: { id: moduleId } });
  const stale = module?.activeHash !== hash;
  await tx.timer.update({ where: { id: timerId }, data: { status: stale ? "stale" : "active", nextAt: stale ? null : nextAt, lastResult: error } });
}
