import { strict as assert } from "node:assert";
// @ts-expect-error Chrona supplies the test kernel at run time.
import { startModule } from "chrona/testing";

// Offline: without the qq_bot credential the module stays up, reports the channel unready to notify and refuses deliveries.
const module = await startModule("index.ts");
const now = "2026-10-23T00:00:00Z";
try {
  // Startup finishes after the readiness report is answered; until then deliveries are refused as retryable.
  const deliver = () => module.send({ trigger: { kind: "tool", id: "deliver", firedAt: now, args: { key: "n1", title: "t", body: "b" }, caller: { kind: "module", module: "notify", moduleId: "m", hash: "h" } }, now, params: {} });
  let reply = await deliver();
  for (let i = 0; i < 100 && reply.result?.result?.error === "QQ bot is starting"; i++) { await new Promise(resolve => setTimeout(resolve, 20)); reply = await deliver(); }
  assert.deepEqual(reply.result?.result, { outcome: "rejected", retryable: false, error: "QQ bot is not configured" });
  // Credentials are a routed call too (secrets.get, v2-10).
  assert.deepEqual(module.calls.map((call: { params: { target: string } }) => call.params.target), ["secrets.get", "notify.channel"]);
  assert.equal(module.calls[1].params.target, "notify.channel");
  assert.equal(module.calls[1].params.mode, "async");
  assert.equal(module.calls[1].params.args.ready, false);
} finally { await module.stop(); }
