import { strict as assert } from "node:assert";
// @ts-expect-error Chrona supplies the test kernel at run time.
import { startModule } from "chrona/testing";

// Offline: without the qq_bot credential the module stays up, reports the channel unready and refuses deliveries.
const module = await startModule("index.ts");
const now = "2026-10-23T00:00:00Z";
try {
  // Startup finishes with the channel report; until then deliveries are refused as retryable.
  for (let i = 0; i < 100 && !module.calls.some((call: { method: string }) => call.method === "channel"); i++) await new Promise(resolve => setTimeout(resolve, 20));
  const reply = await module.send({ trigger: { kind: "deliver", id: "deliver", firedAt: now, message: { idempotencyKey: "n1", title: "t", body: "b", link: null, recipient: null } }, now, params: {} });
  assert.deepEqual(reply.result?.result, { outcome: "rejected", retryable: false, error: "QQ bot is not configured" });
  assert.deepEqual(module.calls.map((call: { method: string }) => call.method), ["secret", "channel"]);
  assert.deepEqual(module.calls[1].params, { ready: false });
} finally { await module.stop(); }
