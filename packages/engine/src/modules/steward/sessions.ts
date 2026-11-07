import { z } from "zod";
import { SESSION_SOURCES, SESSION_STATUSES, newSessionSchema, updateSessionSchema, isEntryModule, moduleManifestSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { parseInput, StewardError } from "./errors";
import { toMessage, toSession } from "./store";

/** Entry identity is kernel metadata, independent of memory or page policy. */
export async function entryConversations(db: StewardPorts["db"], workspaceId: string) {
  const modules = await db.module.findMany({ where: { workspaceId, activeHash: { not: null } } });
  const entries: { id: string; name: string }[] = [];
  for (const module of modules) {
    const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } } });
    const manifest = moduleManifestSchema.safeParse(version?.manifest).data;
    if (manifest && isEntryModule(manifest)) entries.push(module);
  }
  return { OR: [{ entryModuleId: { in: entries.map(entry => entry.id) } },
    { entryModuleId: null, source: { in: entries.map(entry => entry.name) } }] };
}

export function createSessions({ db, now }: StewardPorts, workspaceId: string) {
  const include = { runs: { where: { status: "running" }, select: { id: true }, take: 1 } };
  async function owned(id: string) {
    const row = await db.session.findFirst({ where: { id, workspaceId }, include });
    if (!row) throw new StewardError("not_found", "Session not found");
    return row;
  }
  return {
    async list(raw: unknown = {}) {
      const { entries, limit, ...filter } = parseInput(z.object({ source: z.enum(SESSION_SOURCES).optional(), status: z.enum(SESSION_STATUSES).optional(), entries: z.boolean().optional(), limit: z.number().int().min(1).max(200).optional() }).strict(), raw);
      return (await db.session.findMany({ where: { workspaceId, ...filter, ...(entries ? await entryConversations(db, workspaceId) : {}) }, include, orderBy: [{ lastActivityAt: "desc" }, { id: "asc" }], ...(limit ? { take: limit } : {}) })).map(toSession);
    },
    get: async (id: string) => toSession(await owned(id)),
    async update(id: string, raw: unknown) {
      const input = parseInput(updateSessionSchema, raw), row = await owned(id);
      return toSession(await db.session.update({ where: { id: row.id }, data: { ...input, ...(input.status === "ended" ? { endedAt: row.endedAt ?? now() } : {}) }, include }));
    },
    /** Apply an app's idle-end intent only while the observed session is unchanged and no work is queued or running. */
    async endIdle(id: string, lastActivityAt: string) {
      const observed = parseInput(z.iso.datetime(), lastActivityAt);
      return db.$transaction(async tx => {
        await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
        const row = await tx.session.findFirst({ where: { id, workspaceId, status: "active", lastActivityAt: new Date(observed) } });
        if (!row || await tx.run.count({ where: { workspaceId, sessionId: id, OR: [{ status: { in: ["queued", "running"] } }, { startedAt: { not: null }, execution: { stopConfirmedAt: null } }] } })) return { ended: false };
        const ended = await tx.session.updateMany({ where: { id, workspaceId, status: "active", lastActivityAt: row.lastActivityAt }, data: { status: "ended", endedAt: now() } });
        return { ended: ended.count === 1 };
      });
    },
    /** End the key's active session; the next chat message creates its replacement. */
    async new(raw: unknown) {
      const { key } = parseInput(newSessionSchema, raw);
      const row = await db.session.findFirst({ where: { workspaceId, key, status: "active" } });
      if (!row) throw new StewardError("not_found", "Active session not found");
      return this.update(row.id, { status: "ended" });
    },
    async messages(id: string, rawLimit: unknown = 50) {
      await owned(id);
      const limit = parseInput(z.coerce.number().int().min(1).max(200), rawLimit);
      return (await db.message.findMany({ where: { workspaceId, sessionId: id }, orderBy: [{ at: "desc" }, { id: "desc" }], take: limit })).reverse().map(toMessage);
    },
  };
}
