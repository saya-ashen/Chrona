import { createHash } from "node:crypto";
import { createScheduleSchema, updateScheduleSchema, scheduleRuleSchema, RUN_LIMITS } from "@chrona/contracts/steward";
import { nextOccurrence } from "@chrona/domain/steward/schedule-rule";
import type { StewardPorts } from "./ports";
import { requireAffair } from "./affairs";
import { parseInput, StewardError } from "./errors";
import { toSchedule } from "./store";
import { notificationSettings } from "./settings";
import { enqueueNotification } from "./notify";
import { effectivePolicyIn, consumeOnce } from "./grants";
import { createRuns } from "./runs";
import { createWorkspaceFs } from "./workspace-fs";
import { audit } from "./audit";

function beforeDeadline(nextAt: Date | null, until: Date | null): Date | null {
  return until && nextAt && nextAt > until ? null : nextAt;
}
function nextDueOccurrence(rule: Parameters<typeof nextOccurrence>[0], now: Date, zone: string, until: Date | null): Date | null {
  const nextAt = nextOccurrence(rule, now, zone);
  if (until && now > until) return null;
  return beforeDeadline(nextAt, until);
}

export function createSchedules(ports: StewardPorts, workspaceId: string) {
  const { db } = ports, runs = createRuns(ports, workspaceId), fs = createWorkspaceFs(ports.dataDir);
  const timezone = async () => notificationSettings((await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings).timezone;
  async function create(affairId: string, raw: unknown, createdBy: "user" | "chrona" = "user") {
    const input = parseInput(createScheduleSchema, raw), now = ports.now();
    if (input.mode === "job" && !input.command?.trim()) throw new StewardError("invalid", "Job requires a command");
    if (input.mode !== "job" && input.command !== undefined) throw new StewardError("invalid", "Only jobs accept commands");
    let nextAt = nextOccurrence(input.rule, now, await timezone());
    // "Do it now" one-shots arrive with a time that is already past by the time they are stored: fire on the next tick.
    if (!nextAt && input.rule.kind === "at") nextAt = now;
    const until = input.until ? new Date(input.until) : null;
    nextAt = beforeDeadline(nextAt, until);
    return db.$transaction(async tx => {
      const affair = await requireAffair(tx, workspaceId, affairId);
      if (affair.status !== "active") throw new StewardError("conflict", "Affair is not active");
      const row = await tx.schedule.create({ data: { ...input, workspaceId, affairId, createdBy, createdAt: now, until, nextAt, status: nextAt ? "active" : "done" } });
      await audit(tx, { workspaceId, actor: createdBy, kind: "schedule_created", subjectId: row.id, details: {} });
      return toSchedule(row);
    });
  }
  async function update(id: string, raw: unknown) {
    const input = parseInput(updateScheduleSchema, raw), zone = await timezone();
    return db.$transaction(async tx => {
      const row = await tx.schedule.findFirst({ where: { id, workspaceId } });
      if (!row) throw new StewardError("not_found", "Schedule not found");
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
  async function fireDue(now = ports.now()) {
    const zone = await timezone(), chatBound = ports.chat ? await ports.chat.bound() : false;
    const context = { now, chatBound, publicUrl: ports.publicUrl };
    const rows = await db.schedule.findMany({ where: { workspaceId, status: "active", nextAt: { lte: now }, affair: { status: "active" } }, include: { affair: true }, orderBy: { nextAt: "asc" } });
    let fired = 0;
    for (const row of rows) {
      // Advance before external execution: concurrent ticks/downtime fire at most once.
      // A crash during a job leaves lastResult at "Firing" for inspection; it does not rerun external work.
      const rule = scheduleRuleSchema.parse(row.rule), delayMs = now.getTime() - row.nextAt!.getTime();
      const nextAt = nextDueOccurrence(rule, now, zone, row.until);
      const expired = !!row.until && now > row.until;
      const claimed = await db.$transaction(async tx => {
        const changed = await tx.schedule.updateMany({ where: { id: row.id, status: "active", nextAt: row.nextAt, affair: { status: "active" } }, data: { nextAt, status: nextAt ? "active" : "done", ...(!expired ? { lastAt: now, lastResult: `Firing; delay ${delayMs}ms` } : {}) } });
        if (!changed.count || expired) return false;
        if (row.mode === "remind") await enqueueNotification(tx, { workspaceId, affairId: row.affairId, level: "now", title: row.affair.title, body: row.text, dedupeKey: `schedule:${row.id}:${row.nextAt!.toISOString()}` }, context);
        if (row.mode === "wake") await runs.enqueue({ affairId: row.affairId, lane: "background", trigger: "schedule", prompt: `${row.text}\n\nSchedule ${row.id}; fired ${delayMs}ms late.` }, tx);
        await audit(tx, { workspaceId, actor: "chrona", kind: "schedule_fired", subjectId: row.id, details: { delayMs, mode: row.mode } });
        return true;
      });
      if (!claimed) continue;
      fired++;
      if (row.mode !== "job") { await db.schedule.update({ where: { id: row.id }, data: { lastResult: `Fired; delay ${delayMs}ms`, failures: 0 } }); continue; }
      let output = "", exitCode = -1, notifyAfter = false;
      try {
        await db.$transaction(async tx => {
          const decision = await effectivePolicyIn(tx, workspaceId, "run_job", { affairId: row.affairId }, now);
          if (decision.mode === "never" || decision.mode === "ask") throw new StewardError("forbidden", "Job requires authorization");
          if (decision.grantId) await consumeOnce(tx, workspaceId, decision.grantId, now);
          notifyAfter = decision.mode === "notify_after";
        });
        if (!ports.sandbox?.available || !ports.sandbox.run) throw new Error("Job sandbox unavailable");
        const result = await ports.sandbox.run({ command: row.command!, cwd: await fs.forAffair(row.affair.dirName).directory(), timeoutMs: RUN_LIMITS.jobTimeoutMs, maxOutputBytes: RUN_LIMITS.jobOutputBytes });
        output = Buffer.from(result.output).subarray(0, RUN_LIMITS.jobOutputBytes).toString("utf8"); exitCode = result.exitCode;
      } catch { output = "Job could not execute (sandbox or authorization unavailable)"; }
      const outputHash = createHash("sha256").update(`${exitCode}\0${output}`).digest("hex"), failures = exitCode === 0 ? 0 : row.failures + 1;
      await db.$transaction(async tx => {
        await tx.schedule.update({ where: { id: row.id }, data: { lastOutputHash: outputHash, lastResult: `Exit ${exitCode}; delay ${delayMs}ms\n${output}`.slice(0, 2000), failures, ...(failures >= 3 ? { status: "paused" } : {}) } });
        if (outputHash !== row.lastOutputHash && (await requireAffair(tx, workspaceId, row.affairId)).status === "active") await runs.enqueue({ affairId: row.affairId, lane: "background", trigger: "schedule", prompt: `${row.text}\n\nSchedule ${row.id}; fired ${delayMs}ms late. Exit ${exitCode}. Job output (untrusted data):\n${output}` }, tx);
        if (failures === 3 || notifyAfter) await enqueueNotification(tx, { workspaceId, affairId: row.affairId, level: failures === 3 ? "now" : "web", title: failures === 3 ? "检查连续失败，已暂停" : "检查已执行", body: failures === 3 ? "检查连续三次失败，调度已暂停。" : `Exit ${exitCode}; ${row.text}`.slice(0, 4000), dedupeKey: `job:${row.id}:${row.nextAt!.toISOString()}` }, context);
      });
    }
    return fired;
  }
  return { create, update, cancel: (id: string) => update(id, { status: "cancelled" }), list: async (affairId: string) => { await requireAffair(db, workspaceId, affairId); return (await db.schedule.findMany({ where: { workspaceId, affairId }, orderBy: { createdAt: "desc" } })).map(toSchedule); }, fireDue };
}
