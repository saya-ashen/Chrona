import { z } from "zod";
import { SESSION_SOURCES, SESSION_STATUSES, newSessionSchema, updateSessionSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { parseInput, StewardError } from "./errors";
import { toMessage, toSession } from "./store";

export function createSessions({ db, now }: StewardPorts, workspaceId: string) {
  const include = { runs: { where: { status: "running" }, select: { id: true }, take: 1 } };
  async function owned(id: string) {
    const row = await db.session.findFirst({ where: { id, workspaceId }, include });
    if (!row) throw new StewardError("not_found", "Session not found");
    return row;
  }
  return {
    async list(raw: unknown = {}) {
      const filter = parseInput(z.object({ source: z.enum(SESSION_SOURCES).optional(), status: z.enum(SESSION_STATUSES).optional() }).strict(), raw);
      return (await db.session.findMany({ where: { workspaceId, ...filter }, include, orderBy: [{ lastActivityAt: "desc" }, { id: "asc" }] })).map(toSession);
    },
    get: async (id: string) => toSession(await owned(id)),
    async update(id: string, raw: unknown) {
      const input = parseInput(updateSessionSchema, raw), row = await owned(id);
      return toSession(await db.session.update({ where: { id: row.id }, data: { ...input, ...(input.status === "ended" ? { endedAt: row.endedAt ?? now() } : {}) }, include }));
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
