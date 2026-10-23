import { moduleManifestSchema, type DeliveryAdapter, type DeliveryChannel, type DeliveryOutcome } from "@chrona/contracts/steward";
import { z } from "zod";
import type { StewardPorts } from "./ports";
import { moduleSupervisor } from "./module-supervisor";
import { channelReady } from "./module-channel-state";

async function channelModule(ports: StewardPorts, channel: DeliveryChannel) {
  for (const module of await ports.db.module.findMany({ where: { status: "active", activeHash: { not: null } }, orderBy: { id: "asc" } })) {
    const version = await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } } });
    const manifest = moduleManifestSchema.safeParse(version?.manifest).data;
    if (manifest?.channel === channel && manifest.effects.includes("owner")) return { module, manifest };
  }
  return null;
}
const outcomeSchema = z.union([
  z.object({ outcome: z.literal("accepted"), receiptRef: z.string().max(500).nullable() }).strict(),
  z.object({ outcome: z.literal("rejected"), retryable: z.boolean(), error: z.string().max(500) }).strict(),
  z.object({ outcome: z.literal("uncertain"), error: z.string().max(500) }).strict(),
]);
/** A chat channel served by an entry module: bound when that module said it is ready; sends go out as `deliver` events. */
export function moduleChannel(ports: StewardPorts, channel: DeliveryChannel): { bound(): Promise<boolean>; delivery: DeliveryAdapter } {
  return {
    async bound() {
      const found = await channelModule(ports, channel);
      return Boolean(found && channelReady(ports, found.module.id));
    },
    delivery: { channel, async send(message): Promise<DeliveryOutcome> {
      const found = await channelModule(ports, channel);
      if (!found) return { outcome: "rejected", retryable: true, error: "Channel module unavailable" };
      const now = ports.now().toISOString();
      let reply;
      try { reply = await moduleSupervisor(ports).deliver(found.module.id, found.module.activeHash!, { trigger: { kind: "deliver", id: "deliver", firedAt: now, message: { idempotencyKey: message.idempotencyKey, title: message.title, body: message.body, link: message.link, recipient: message.recipient, ...(message.approval ? { approval: message.approval } : {}) } }, now, params: {} }); }
      // The module may have reached the transport before failing.
      catch { return { outcome: "uncertain", error: "Channel module failed; receipt unknown" }; }
      if ("error" in reply) return { outcome: "uncertain", error: "Channel module failed; receipt unknown" };
      return outcomeSchema.safeParse(reply.result.result).data ?? { outcome: "uncertain", error: "Channel module returned no delivery outcome" };
    } },
  };
}
