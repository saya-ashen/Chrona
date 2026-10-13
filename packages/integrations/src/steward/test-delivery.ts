import type { DeliveryAdapter, DeliveryMessage, DeliveryOutcome } from "@chrona/contracts/steward";

export type TestDeliveryScriptOutcome =
  | { outcome: "accepted"; receiptRef?: string | null }
  | Exclude<DeliveryOutcome, { outcome: "accepted" }>
  | { outcome: "throw"; error: unknown };
export type TestDeliveryRecord = DeliveryMessage & { receiptRef: string | null };

/** Local test sink, never a real external send. Only accepted sends enter `sent`. */
export function createTestDelivery() {
  const sent: TestDeliveryRecord[] = [];
  const receipts = new Map<string, Extract<DeliveryOutcome, { outcome: "accepted" }>>();
  let outcomes: TestDeliveryScriptOutcome[] = [];
  const adapter: DeliveryAdapter = {
    channel: "local_test",
    async send(message) {
      const previous = receipts.get(message.idempotencyKey);
      // An accepted retry consumes neither another outcome nor another send.
      if (previous) return { ...previous };
      const scripted = outcomes.shift() ?? { outcome: "accepted" as const };
      if (scripted.outcome === "throw") throw scripted.error;
      if (scripted.outcome !== "accepted") return { ...scripted };
      const accepted: Extract<DeliveryOutcome, { outcome: "accepted" }> = {
        outcome: "accepted",
        receiptRef: scripted.receiptRef === undefined ? `local_test:${sent.length + 1}` : scripted.receiptRef,
      };
      receipts.set(message.idempotencyKey, accepted);
      sent.push({ ...message, receiptRef: accepted.receiptRef });
      return { ...accepted };
    },
  };
  return {
    adapter, sent,
    /** Replace the remaining script, without clearing accepted idempotency receipts. */
    script(next: readonly TestDeliveryScriptOutcome[]) { outcomes = next.map((outcome) => ({ ...outcome })); },
  };
}
