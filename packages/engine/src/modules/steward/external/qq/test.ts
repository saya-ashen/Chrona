import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error Chrona supplies the test kernel at run time.
import { startModule, paths } from "chrona/testing";

// Offline: without the qq_bot credential the module stays up, reports the channel unready to notify and refuses deliveries.
const registrations: Record<string, unknown>[] = [], pages: Record<string, unknown>[] = [];
let webAvailable = false;
const module = await startModule("unconfigured-harness.ts", { stubs: {
  "web.page-set": (args: Record<string, unknown>) => { if (!webAvailable) return { error: { code: "unavailable", message: "Web unavailable" } }; pages.push(args); return { registered: true }; },
  "notify.channel": (args: Record<string, unknown>) => { registrations.push(args); return { registered: true }; },
} });
const now = "2026-10-23T00:00:00Z";
try {
  for (let i = 0; i < 100 && !existsSync(join(paths.data, "unconfigured-ready")); i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(existsSync(join(paths.data, "unconfigured-ready")));
  // Startup finishes after the readiness report is answered; until then deliveries are refused as retryable.
  const deliver = () => module.send({ trigger: { kind: "tool", id: "deliver", firedAt: now, args: { key: "n1", title: "t", body: "b" }, caller: { kind: "module", module: "notify", moduleId: "m", hash: "h" } }, now, params: {} });
  let reply = await deliver();
  for (let i = 0; i < 100 && reply.result?.result?.error === "QQ bot is starting"; i++) { await new Promise(resolve => setTimeout(resolve, 20)); reply = await deliver(); }
  assert.deepEqual(reply.result?.result, { outcome: "rejected", retryable: false, error: "QQ bot is not configured" });
  // Credentials are a routed call too (secrets.get, v2-10).
  assert.deepEqual(module.calls.map((call: { params: { target: string } }) => call.params.target), ["secrets.get", "notify.channel"]);
  assert.equal(module.calls[1].params.target, "notify.channel");
  assert.equal(module.calls[1].params.mode, "sync");
  assert.deepEqual(module.calls[1].params.args, { channel: "chrona_qqbot", tool: "deliver", ready: false, at: module.calls[1].params.args.at });
  assert.equal((await module.send({ trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} })).error, undefined, "absent Web must not break QQ");
  webAvailable = true;
  assert.equal(module.calls[2].params.target, "notify.channel");
  assert.equal(module.calls[2].params.args.tool, "deliver");
  assert.equal(module.calls[2].params.args.ready, false);
  const activated = () => module.send({ trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} });
  assert.equal((await activated()).error, undefined);
  assert.equal((await activated()).error, undefined);
  assert.equal(registrations.length, 4);
  assert.equal(pages.length, 2, "activation re-registers after Web starts or changes");
  assert.equal(pages[0].purpose, "settings");
  assert.equal(pages[0].id, "settings");
  for (const { at, ...registration } of registrations) {
    assert.equal(typeof at, "string");
    assert.deepEqual(registration, { channel: "chrona_qqbot", tool: "deliver", ready: false });
  }
  const unconfiguredReply = await module.send({ trigger: { kind: "tool", id: "reply", firedAt: now, args: { session: "s", message: "m", text: "hello", workspace: "w" } }, now, params: {} });
  assert.equal(unconfiguredReply.error, undefined);
  assert.deepEqual(unconfiguredReply.result?.result, { delivered: "unconfigured" });
  assert.deepEqual((await deliver()).result?.result, { outcome: "rejected", retryable: false, error: "QQ bot is not configured" });
  const settings = (args: Record<string, unknown>, caller: unknown = { kind: "owner" }) => module.send({ trigger: { kind: "tool", id: "settings", firedAt: now, args, caller }, now, params: {} });
  assert.deepEqual((await settings({})).result?.result, { provider: null, autoRecall: true, autoRetain: true });
  assert.deepEqual((await settings({ settings: JSON.stringify({ provider: "memory-local", autoRecall: false, autoRetain: false }) })).result?.result, { provider: "memory-local", autoRecall: false, autoRetain: false });
  assert.deepEqual((await settings({})).result?.result, { provider: "memory-local", autoRecall: false, autoRetain: false });
  assert.ok((await settings({ settings: JSON.stringify({ provider: "../bad" }) })).error);
  assert.deepEqual((await settings({}, null)).result?.result, { ignored: "no caller" });
  const ui = (args: Record<string, unknown>, caller: unknown = { kind: "owner" }) => module.send({ trigger: { kind: "tool", id: "ui-settings", firedAt: now, args, caller }, now, params: {} });
  assert.deepEqual((await ui({})).result?.result, { provider: "memory-local", autoRecall: false, autoRetain: false });
  assert.deepEqual((await ui({ "auto-recall": true })).result?.result, { provider: "memory-local", autoRecall: true, autoRetain: false });
  for (const args of [{ provider: "../bad" }, { "auto-recall": "false" }, { "auto-retain": 1 }, { caller: { kind: "owner" } }]) assert.ok((await ui(args)).error);
  assert.deepEqual((await ui({ provider: "" }, null)).result?.result, { ignored: "no caller" });
  assert.equal((await settings({})).result?.result.provider, "memory-local");
  assert.deepEqual((await ui({ provider: "" })).result?.result, { provider: "", autoRecall: true, autoRetain: false });
  assert.deepEqual((await settings({})).result?.result, { provider: null, autoRecall: true, autoRetain: false });
  assert.equal(module.calls.some((call: { params: { target: string } }) => /modules\.(settings|contributions)/.test(call.params.target)), false);
  assert.equal(existsSync(join(paths.data, "network-attempts")), false);
} finally { await module.stop(); }
