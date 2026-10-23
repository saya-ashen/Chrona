import { strict as assert } from "node:assert";
// @ts-expect-error Chrona supplies the test kernel at this at run time.
import { startModule } from "chrona/testing";

const module = await startModule("index.ts");
const now = "2026-10-22T00:00:00Z";
try {
  for (const [scheduleId, text] of [["first", "喝水"], ["second", "Take a break"]]) {
    const reply = await module.send({ trigger: { kind: "schedule", id: scheduleId, scheduleId, firedAt: now, payload: { text } }, now, params: {} });
    assert.equal(reply.error, undefined);
    const call = module.calls.at(-1);
    assert.equal(call.method, "notify");
    assert.deepEqual(call.params, { key: `${scheduleId}:${now}`, level: "now", title: "提醒", body: text });
  }
  assert.equal(module.calls.length, 2);
} finally { await module.stop(); }
