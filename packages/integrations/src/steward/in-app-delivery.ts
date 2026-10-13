import type { DeliveryAdapter } from "@chrona/contracts/steward";

/**
 * Accepted means recorded and visible inside Chrona (Today / delivery log),
 * not sent externally or read. The engine owns persistence; this port does no IO.
 */
export function createInAppDelivery(): DeliveryAdapter & { idempotent: true } {
  return {
    channel: "in_app",
    idempotent: true,
    async send({ idempotencyKey }) {
      return { outcome: "accepted", receiptRef: `in_app:${idempotencyKey}` };
    },
  };
}
