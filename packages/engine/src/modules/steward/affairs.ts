import { uiEntry } from "./ui";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, Affair as AffairRow } from "@chrona/db";
import { activitySchema, createAffairSchema, updateAffairSchema, type AffairStatus } from "@chrona/contracts/steward";
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";
import { toActivity, toAffair, toApproval, toMessage, toRun, toSchedule } from "./store";
import type { WorkspaceFs } from "./workspace-fs";
export type RecordContext = { db: PrismaClient; workspaceId: string; now(): Date };
export async function requireAffair(db: Prisma.TransactionClient, workspaceId: string, id: string) {
  const row = await db.affair.findFirst({ where: { id, workspaceId } });
  if (!row) throw new StewardError("not_found", "Affair not found");
  return row;
}
export function createAffairs({ db, workspaceId, now }: RecordContext, fs: WorkspaceFs) {
  async function view(row: AffairRow) {
    const [readme, schedule, running, openApprovals, queued] = await Promise.all([
      fs.forAffair(row.dirName).read("README.md"),
      row.status === "active" ? db.schedule.findFirst({ where: { workspaceId, affairId: row.id, status: "active", nextAt: { not: null } }, orderBy: { nextAt: "asc" } }) : null,
      db.run.findFirst({ where: { workspaceId, affairId: row.id, status: "running" }, orderBy: [{ startedAt: "asc" }, { id: "asc" }] }),
      db.approval.count({ where: { workspaceId, affairId: row.id, status: "open" } }),
      db.run.findFirst({ where: { workspaceId, affairId: row.id, status: "queued", OR: [{ leaseUntil: null }, { leaseUntil: { lte: now() } }] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    ]);
    const summary = readme.content.trim().split(/\r?\n\s*\r?\n/).find(p => p.trim() && !/^#{1,6}\s/.test(p.trim()))?.trim().slice(0, 300) ?? "";
    return toAffair(row, {
      summary, running: !!running, openApprovals,
      nextSchedule: schedule ? { at: schedule.nextAt!.toISOString(), mode: toSchedule(schedule).mode, label: (schedule.label ?? (schedule.mode === "remind" ? schedule.text : null))?.slice(0, 300) ?? null } : null,
      work: running ? { state: "running", since: (running.startedAt ?? running.createdAt).toISOString(), label: running.label } : queued ? { state: "queued", since: queued.createdAt.toISOString(), label: queued.label } : null,
    });
  }
  async function files(id: string) { return fs.forAffair((await requireAffair(db, workspaceId, id)).dirName); }
  return {
    files,
    create: async (raw: unknown) => {
      const input = parseInput(createAffairSchema, raw), id = randomUUID(), dirName = id.replaceAll("-", "");
      // Initialize before publishing the DB row. A failed DB commit leaves an orphan directory,
      // never an apparently healthy affair with missing files; recovery must not delete user files.
      if (!await db.workspace.findUnique({ where: { id: workspaceId } })) throw new StewardError("not_found", "Workspace not found");
      await fs.createAffairDir(dirName, `# ${input.title}\n\n${input.request}\n`);
      const row = await db.$transaction(async tx => {
        const row = await tx.affair.create({ data: { id, dirName, workspaceId, title: input.title, createdAt: now(), lastActivityAt: now() } });
        await audit(tx, { workspaceId, kind: "affair_created", actor: "user", subjectId: id, details: {} });
        return row;
      });
      return view(row);
    },
    list: async (status?: AffairStatus) => (await Promise.all((await db.affair.findMany({ where: { workspaceId, status }, orderBy: { lastActivityAt: "desc" } })).map(view))),
    detail: async (id: string) => {
      const row = await requireAffair(db, workspaceId, id), directory = fs.forAffair(row.dirName);
      const [affair, tree, schedules, approvals, activity, runs, revisions, messages] = await Promise.all([
        view(row), directory.tree(), db.schedule.findMany({ where: { workspaceId, affairId: id }, orderBy: { createdAt: "desc" } }),
        db.approval.findMany({ where: { workspaceId, affairId: id }, include: { affair: true }, orderBy: { createdAt: "desc" } }),
        db.activity.findMany({ where: { workspaceId, affairId: id }, orderBy: { at: "desc" }, take: 100 }),
        db.run.findMany({ where: { workspaceId, affairId: id }, orderBy: { createdAt: "desc" }, take: 100 }), directory.revisions(),
        db.message.findMany({ where: { workspaceId, affairId: id }, orderBy: [{ at: "desc" }, { id: "desc" }], take: 100 }),
      ]);
      return { affair, entry: await uiEntry(directory, tree), files: tree.slice(0, 2000), schedules: schedules.map(toSchedule), approvals: approvals.map(toApproval), activity: activity.map(toActivity), runs: runs.map(toRun), revisions, messages: messages.reverse().map(toMessage) };
    },
    update: async (id: string, raw: unknown) => {
      const input = parseInput(updateAffairSchema, raw);
      const row = await db.$transaction(async tx => {
        await requireAffair(tx, workspaceId, id);
        // Keep rules and nextAt for inspection. Resuming an affair does not silently resume schedules.
        if (input.status && input.status !== "active") await tx.schedule.updateMany({ where: { workspaceId, affairId: id, status: "active" }, data: { status: "paused" } });
        const row = await tx.affair.update({ where: { id }, data: { ...input, lastActivityAt: now(), revision: { increment: 1 } } });
        await tx.activity.create({ data: { workspaceId, affairId: id, actor: "user", kind: "status", text: input.status ?? input.title ?? row.title, at: now() } });
        await audit(tx, { workspaceId, kind: "affair_updated", actor: "user", subjectId: id, details: input });
        return row;
      });
      return view(row);
    },
    appendActivity: (id: string, raw: unknown) => db.$transaction(async tx => {
      await requireAffair(tx, workspaceId, id);
      const input = parseInput(activitySchema.pick({ actor: true, kind: true, text: true, data: true }), raw);
      const row = await tx.activity.create({ data: { ...input, data: input.data === null ? undefined : input.data as Prisma.InputJsonObject, workspaceId, affairId: id, at: now() } });
      await tx.affair.update({ where: { id }, data: { lastActivityAt: now() } });
      return toActivity(row);
    }),
    activity: async (id: string) => { await requireAffair(db, workspaceId, id); return (await db.activity.findMany({ where: { workspaceId, affairId: id }, orderBy: { at: "desc" }, take: 100 })).map(toActivity); },
  };
}
