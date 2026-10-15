import { z } from "zod";
import { DELIVERY_CHANNELS } from "@chrona/contracts/steward";
import { requireAffair, type RecordContext } from "./affairs";
import { parseInput } from "./errors";
import { toChatMessage } from "./store";
const inputSchema = z.object({ direction: z.enum(["in", "out"]), channel: z.enum(DELIVERY_CHANNELS), text: z.string().max(4000), affairId: z.string().nullable().optional(), externalId: z.string().min(1).optional() }).strict();
export function createChatLog({ db, workspaceId, now }: RecordContext) {
  return {
    append: (raw: unknown) => db.$transaction(async tx => {
      const input = parseInput(inputSchema, raw);
      if (input.affairId) await requireAffair(tx, workspaceId, input.affairId);
      const externalId = input.direction === "in" ? input.externalId : undefined;
      if (externalId) {
        const existing = await tx.chatMessage.findUnique({ where: { workspaceId_channel_externalId: { workspaceId, channel: input.channel, externalId } } });
        if (existing) return toChatMessage(existing);
      }
      return toChatMessage(await tx.chatMessage.create({ data: { ...input, externalId, workspaceId, at: now() } }));
    }),
    recent: async (n = 20) => (await db.chatMessage.findMany({ where: { workspaceId }, orderBy: [{ at: "desc" }, { id: "desc" }], take: Math.max(1, Math.min(100, Math.trunc(n) || 20)) })).reverse().map(toChatMessage),
  };
}
