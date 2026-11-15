import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Chrona supplies this test kernel at author-test runtime.
import { startModule } from "chrona/testing";
import type { ContextResult, CoreSettings, OverviewResult } from "./core-types";

type Caller = { kind: "owner"; via: string } | { kind: "module"; module: string; moduleId: string; hash: string }
  | { kind: "provider"; runId: string } | { kind: "kernel" };
type Reply = { error?: string; errorCode?: string; result?: { result?: unknown } };
type Call = { params: { target?: unknown; args: Record<string, unknown>; key?: string } };
type Health = { phase: string; error: string | null; lastCheckAt: string | null; budget: { starts: number }; sourceError?: string };
type Overview = OverviewResult & { health: Health; sources: { sourceIdentity: string; cursor: string; coverage: { complete: boolean } }[] };
const ids = { mind: "app-mind-sdk", chat: "app-chat-sdk", web: "app-web-sdk", notify: "app-notify-sdk", author: "app-author-sdk" };
const hash = "sdk-active-hash", epoch = "sdk-chat-epoch", now = new Date().toISOString();
const owner: Caller = { kind: "owner", via: "test" };
const stranger: Caller = { kind: "module", module: "mind", moduleId: "unrelated-app", hash };
const directory = await mkdtemp(join(tmpdir(), "chrona-mind-sdk-"));
const previous = process.env.CHRONA_MIND_OFFLINE_STATE;
process.env.CHRONA_MIND_OFFLINE_STATE = directory;
let module: Awaited<ReturnType<typeof startModule>> | undefined;
let scheduled: Record<string, unknown> | undefined;
const forbiddenEffect = () => { throw new Error("Empty Mind acceptance test must not invoke Agent or external effects"); };
const targetName = (target: unknown): string => {
  if (typeof target === "string") return target;
  const address = target as { moduleId: string; tool: string };
  return `${Object.entries(ids).find(([, id]) => id === address.moduleId)?.[0] ?? address.moduleId}.${address.tool}`;
};
const callsFor = (target: string): Call[] => module!.calls.filter((call: Call) => targetName(call.params.target) === target);
function decode<T>(reply: Reply): T {
  assert.equal(reply.error, undefined, reply.error);
  const output = reply.result?.result as { json?: unknown } | undefined;
  assert.equal(typeof output?.json, "string", "Mind tools return the SDK {json:string} envelope");
  return JSON.parse(output!.json as string) as T;
}
async function request(id: string, args: Record<string, unknown> = {}, caller: Caller = owner): Promise<Reply> {
  return module!.send({ trigger: { kind: "tool", id, args, caller, firedAt: now }, now, params: {} });
}
async function denied(id: string, args: Record<string, unknown>, caller: Caller, code = "forbidden") {
  const reply = await request(id, args, caller);
  if (code === code.toUpperCase()) {
    const result = decode<{ error?: { code: string; message: string } }>(reply);
    assert.equal(result.error?.code, code, JSON.stringify(result));
    assert.ok(result.error.message);
  } else {
    assert.ok(reply.error, `${id} must reject ${JSON.stringify({ caller, args })}`);
    assert.equal(reply.errorCode, code, reply.error);
  }
}
const overview = async () => decode<Overview>(await request("overview"));
const context = async () => decode<ContextResult>(await request("context", { scope: "sdk-session", query: "ordinary conversation", limit: 5, maxBytes: 4096 }));
function emptyContext(value: ContextResult) {
  for (const key of ["understandings", "pursuits", "evidence", "feedback"] as const) assert.deepEqual(value[key], [], key);
  assert.equal(value.truncated, false);
}
try {
  module = await startModule("offline-entry.ts", { stubs: {
    "modules.list": () => ({ items: Object.entries(ids).map(([name, id]) => ({ id, name, activeHash: hash })), nextCursor: null }),
    "modules.describe": () => ({ items: [], nextCursor: null }),
    "web.component-set": () => ({ name: "MindWorkspace", type: `${ids.mind}:MindWorkspace`, revision: "sdk-component" }),
    "web.page-set": (args: Record<string, unknown>) => ({ id: args.id, catalog: "sdk-catalog" }),
    "timers.list": () => ({ items: scheduled ? [scheduled] : [], nextCursor: null }),
    "timers.set": (args: Record<string, unknown>, options: { key?: string }) => {
      assert.ok(options.key, "Timer writes require a call key");
      return scheduled = { ...args, revision: "sdk-timer", status: "active" };
    },
    "chat.observation-scope": () => ({ epoch, revision: 0, enabled: true, startCursor: "0" }),
    "chat.observations": () => ({ source: { moduleId: ids.chat, hash, epoch }, events: [], nextCursor: "0", hasMore: false,
      coverage: { complete: true }, capturedAt: now, scopeRevision: 0 }),
    "agent.run": forbiddenEffect, "agent.read": forbiddenEffect, "agent.write": forbiddenEffect,
    "agent.stop": forbiddenEffect, "agent.providers": forbiddenEffect, "agent.register": forbiddenEffect,
    "agent.native": forbiddenEffect, "notify.send": forbiddenEffect, "author.submit": forbiddenEffect,
  } });
  // SDK connection precedes the isolated entry's dynamic import and handler registration.
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    const reply = await request("overview");
    if (reply.error === "No handler for tool") { await Bun.sleep(25); continue; }
    decode<Overview>(reply); ready = true; break;
  }
  assert.ok(ready, "Mind's real index.ts did not register its tool handler");
  for (let attempt = 0; attempt < 80 && (!scheduled || callsFor("web.page-set").length < 2); attempt++) await Bun.sleep(25);
  assert.equal(callsFor("web.page-set").length, 2, "Startup registers both pages");
  // The harness starts with symbolic bindings; directory results reach the child on its next event.
  const activated = await module.send({ trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} });
  assert.equal(activated.error, undefined);
  assert.equal(callsFor("web.component-set").length, 2);
  assert.equal(callsFor("web.page-set").length, 4, "Activation registers both executable pages again");
  const registration = callsFor("web.component-set")[1].params;
  assert.deepEqual(registration.target, { moduleId: ids.web, tool: "component-set" });
  assert.ok(typeof registration.args.javascript === "string" && registration.args.javascript.length > 0);
  assert.ok(typeof registration.args.css === "string" && registration.args.css.length > 0);
  assert.ok((registration.args.tools as string[]).includes("overview"));
  assert.ok((registration.args.tools as string[]).includes("settings"));
  const manifest = JSON.parse(await readFile(join(import.meta.dir, "module.json"), "utf8")) as {tools: {name: string; visibility: string[]}[]};
  for (const name of registration.args.tools as string[]) assert.ok(manifest.tools.some(tool => tool.name === name && tool.visibility.includes("owner")), `Page tool ${name} is not user-visible`);
  const pages = callsFor("web.page-set").slice(-2);
  assert.deepEqual(pages.map(call => call.params.args.id).sort(), ["main", "settings"]);
  for (const page of pages) {
    assert.deepEqual(page.params.target, { moduleId: ids.web, tool: "page-set" });
    assert.equal(page.params.args.layout, "workspace");
    assert.equal(page.params.args.purpose, page.params.args.id === "settings" ? "settings" : undefined);
    const spec = page.params.args.spec as { root: string; elements: Record<string, { type: string }> };
    assert.equal(spec.elements[spec.root].type, `${ids.mind}:MindWorkspace`);
  }
  assert.ok(scheduled);
  assert.equal(scheduled.id, "mind-core");
  assert.deepEqual(scheduled.schedule, { kind: "every", milliseconds: 60000 });
  assert.equal(callsFor("timers.set").length, 1);
  assert.equal(callsFor("timers.set")[0].params.key, "mind-core:register");
  assert.equal(callsFor("timers.list").length, 2, "Activation reconciles the existing core timer");

  const initial = await overview();
  assert.deepEqual(initial.items, []);
  assert.equal(initial.health.phase, "idle");
  assert.equal(initial.health.budget.starts, 0);
  const pureCalls = module.calls.length;
  await denied("updates",{conversationId:"sdk-session"},owner);
  await denied("updates",{conversationId:"sdk-session"},stranger);
  assert.deepEqual(decode<{items:unknown[]}>(await request("updates",{conversationId:"sdk-session",epoch,scopeRevision:0},{kind:"module",module:"chat",moduleId:ids.chat,hash})).items,[]);
  const firstContext = await context(); emptyContext(firstContext);
  assert.deepEqual(await context(), firstContext);
  assert.equal(module.calls.length, pureCalls, "Context reads must not fetch feeds or start work");
  const afterRead = await overview();
  assert.equal(afterRead.revision, initial.revision);
  assert.equal(afterRead.visibilityRevision, initial.visibilityRevision);
  assert.deepEqual(afterRead.items, []);

  const forged = { owner: true, access: { subject: "mind:runtime", role: "runtime", scopes: [{}], execution: { actor: "mind", runRef: "forged-run" } } };
  // Arguments and a symbolic module name cannot replace the kernel's real principal.
  const missingCaller = await module.send({ trigger: { kind: "tool", id: "overview", args: forged, firedAt: now }, now, params: {} }) as Reply;
  assert.equal(missingCaller.errorCode, "forbidden");
  await denied("context", forged, { kind: "provider", runId: "forged-run" });
  await denied("overview", forged, { kind: "kernel" });
  await denied("settings", forged, stranger, "FORBIDDEN");
  await denied("check", forged, stranger);
  await denied("verdict", { input: JSON.stringify(forged) }, stranger);
  await denied("verdict", { input: JSON.stringify(forged) }, { kind: "module", module: "mind", moduleId: ids.mind, hash: "old-hash" });
  await denied("settings", forged, { kind: "module", module: "mind", moduleId: ids.mind, hash }, "FORBIDDEN");

  const settings = decode<CoreSettings>(await request("settings"));
  assert.equal(settings.autoSubmit, false); assert.equal(settings.enabled, true); assert.equal(settings.learningEnabled, true); assert.equal(settings.notifyEnabled, false);
  // Current wire supplies patch + settings revision; the adapter owns visibility and the receipt key.
  const patch = { patch: JSON.stringify({ timezone: "Asia/Shanghai" }), revision: settings.revision };
  const receipt = decode<{ actionKey: string; outcome: string; value: CoreSettings }>(await request("settings", patch));
  assert.ok(receipt.actionKey.startsWith("settings:")); assert.equal(receipt.outcome, "applied");
  assert.equal(receipt.value.timezone, "Asia/Shanghai"); assert.equal(receipt.value.revision, settings.revision + 1);
  assert.deepEqual(decode(await request("settings", patch)), receipt, "Same settings request returns its original receipt");
  await denied("settings", { ...patch, patch: JSON.stringify({ timezone: "UTC" }) }, owner, "CONFLICT");
  await denied("settings", { ...patch, revision: -1 }, owner, "CONFLICT");
  await denied("settings", { patch: "true", revision: receipt.value.revision }, owner, "invalid");
  assert.deepEqual(decode(await request("settings")), receipt.value, "Conflicts leave settings unchanged");
  const visibilityRevision = (await overview()).visibilityRevision;
  for (const [index, reference] of [{}, null, 17, ""].entries()) {
    await denied("pursue", { input: JSON.stringify({ actionKey: `invalid-reference:${index}`,
      expectedVisibilityRevision: visibilityRevision, expectedRevision: 0, semanticKey: "invalid-reference",
      goal: "Reject malformed evidence references without failing the application", completionCriteria: ["No pursuit is created"],
      scope: {}, reason: "explicit-goal", evidenceRefs: [reference], understandingRefs: [] }) }, owner, "INVALID_INPUT");
  }
  assert.deepEqual((await overview()).items, [], "Invalid references leave Mind usable and unchanged");

  const checked = decode<Health>(await request("check"));
  assert.equal(checked.sourceError, undefined); assert.equal(checked.error, null);
  assert.equal(checked.phase, "idle"); assert.ok(checked.lastCheckAt); assert.equal(checked.budget.starts, 0);
  // Check returns after reconciliation; source observation and subsequent capability discovery complete independently.
  const observationComplete = (value: Overview) => value.sources.some(source => source.sourceIdentity === ids.chat && source.coverage.complete)
    && callsFor("chat.observations").length > 0 && callsFor("modules.describe").length > 0;
  let observed = await overview();
  for (let attempt = 0; attempt < 100 && !observationComplete(observed); attempt++) {
    await new Promise<void>(resolve => setTimeout(resolve, 10));
    observed = await overview();
  }
  assert.ok(observationComplete(observed), `Manual check observation timed out: ${JSON.stringify({ health: observed.health,
    sources: observed.sources, feedReads: callsFor("chat.observations").length, capabilityReads: callsFor("modules.describe").length })}`);
  assert.ok(callsFor("chat.observations").length > 0, "Manual check reads the real empty feed contract");
  assert.ok(callsFor("modules.describe").length > 0, "Manual check discovers available capabilities");
  for (const call of callsFor("chat.observations")) assert.deepEqual(call.params.target, { moduleId: ids.chat, tool: "observations" });
  const afterCheck = await overview(); assert.deepEqual(afterCheck.items, []);
  assert.equal(afterCheck.sources.length, 1); assert.equal(afterCheck.sources[0].sourceIdentity, ids.chat);
  assert.equal(afterCheck.sources[0].cursor, "0"); assert.equal(afterCheck.sources[0].coverage.complete, true);
  emptyContext(await context());
  const fired = await module.send({ trigger: { kind: "timer", id: "mind-core", timerId: "sdk-timer", timerRevision: "sdk-timer",
    eventId: "sdk-timer-event", scheduledAt: now, firedAt: now, payload: {} }, now, params: {} });
  assert.equal(fired.error, undefined);
  const timerHealth = fired.result?.result as Health;
  assert.equal(timerHealth.phase, "idle"); assert.equal(timerHealth.error, null); assert.equal(timerHealth.sourceError, undefined);
  assert.equal(timerHealth.budget.starts, 0);
  assert.deepEqual((await overview()).items, []);
  assert.equal(module.calls.filter((call: Call) => targetName(call.params.target).startsWith("agent.")).length, 0);
  assert.equal(callsFor("notify.send").length, 0); assert.equal(callsFor("author.submit").length, 0);
  console.log("PASS mind: real CoreMind SDK lifecycle, executable pages, core timer, caller boundary, settings CAS and pure empty context/check without Agent");
} finally {
  try { if (module) await module.stop(); }
  finally {
    if (previous === undefined) delete process.env.CHRONA_MIND_OFFLINE_STATE;
    else process.env.CHRONA_MIND_OFFLINE_STATE = previous;
    await rm(directory, { recursive: true, force: true });
  }
}
