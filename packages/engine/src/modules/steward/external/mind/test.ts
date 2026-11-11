import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Chrona supplies this test kernel at author-test runtime.
import { startModule } from "chrona/testing";
import { runOfflineChecks } from "./offline";
import { outputs } from "./schema";

await runOfflineChecks();
// Always isolate business fixtures, including when author checks receive repeated nonempty copied data.
const directory = await mkdtemp(join(tmpdir(), "chrona-mind-sdk-"));
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(join(directory, "retained-private-note"), "nonempty copied-data fixture", { mode: 0o600 });
const previous = process.env.CHRONA_MIND_OFFLINE_STATE;
process.env.CHRONA_MIND_OFFLINE_STATE = directory;
let scheduled: { id: string; revision: string; status: string; schedule: unknown } | null = null;
const module = await startModule("offline-entry.ts", { stubs: {
  "web.page-set": () => ({ ok: true }),
  "timers.list": () => ({ items: scheduled ? [scheduled] : [], nextCursor: null }),
  "timers.set": (args: Record<string, unknown>) => { scheduled = { id: "mind-review", revision: "sdk-revision", status: "active", schedule: args.schedule }; return scheduled; },
  "timers.cancel": () => { if (scheduled) scheduled.status = "cancelled"; return { cancelled: true }; },
  "agent.run": () => ({ contextId: "context-sdk", runId: "run-sdk", status: "running", active: true }),
  "agent.read": () => ({ run: { contextId: "context-sdk", runId: "run-sdk", status: "running", active: true }, items: [], nextCursor: null, ended: false, interactions: [] }),
} });
const now = new Date().toISOString();
const owner = { kind: "owner" as const, via: "test" };
async function send(id: string, args: Record<string, unknown>, caller = owner) {
  const reply = await module.send({ trigger: { kind: "tool", id, firedAt: now, args, caller }, now, params: {} });
  if (reply.error) throw new Error(reply.error);
  return reply.result?.result;
}
try {
  // The socket connects before the dynamic application import finishes; wait for its real tool handler.
  let ready = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    try { outputs["ui-agenda"].parse(await send("ui-agenda", {})); ready = true; break; }
    catch (error) { if (!String(error).includes("No handler for tool")) throw error; }
    await Bun.sleep(25);
  }
  assert.ok(ready, "Mind SDK entry did not become ready");
  // First activation cannot register; a subsequent lifecycle delivery retries both pages safely.
  await module.send({ trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} });
  await module.send({ trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} });
  const pages = module.calls.filter((call: { params: { target?: string } }) => targetName(call.params.target) === "web.page-set");
  assert.equal(pages.length, 2);
  const agenda = outputs["ui-agenda"].parse(await send("ui-agenda", {}));
  assert.equal(agenda.concerns.length, 0); assert.equal(agenda.runtime.phase, "idle");
  const created = outputs.note.parse(await send("note", { "request-key": "sdk-note", title: "SDK concern", project: "SDK" }));
  assert.deepEqual(outputs.note.parse(await send("note", { "request-key": "sdk-note", title: "SDK concern", project: "SDK" })), created);
  // This direct author harness bypasses kernel owner-route admission; verify the
  // modules-visible private read still rejects an unrelated authenticated source.
  const denied = await module.send({ trigger: { kind: "tool", id: "agenda", firedAt: now, args: {}, caller: { kind: "module", module: "source", moduleId: "source-id", hash: "fixture" } }, now, params: {} });
  assert.ok(denied.error);
  outputs["ui-settings"].parse(await send("ui-settings", {}));
  await send("ui-settings", { enabled: true });
  assert.equal((scheduled as { status: string } | null)?.status, "active");
  const fired = await module.send({ trigger: { kind: "timer", id: "mind-review", timerId: "fixture-timer", timerRevision: "sdk-revision", eventId: "fixture-event", scheduledAt: now, firedAt: now, payload: {} }, now, params: {} });
  assert.ok(!fired.error);
  await send("ui-settings", { enabled: false });
  assert.equal((scheduled as { status: string } | null)?.status, "cancelled");
  const checked = outputs.check.parse(await send("check", {})); assert.equal(checked.runtime.phase, "running");
  const starts = module.calls.filter((call: { params: { target?: string } }) => targetName(call.params.target) === "agent.run"); assert.equal(starts.length, 1);
  assert.equal(starts[0].params.target, "agent.run");
  assert.equal(typeof starts[0].params.key, "string");
  assert.ok(starts[0].params.key);
  const input = starts[0].params.args as Record<string, unknown>;
  assert.equal(input.contextId, undefined);
  assert.equal(input["request-key"], undefined);
  assert.equal(input.key, undefined);
  const reads = module.calls.filter((call: { params: { target?: unknown } }) => targetName(call.params.target) === "agent.read");
  assert.ok(reads.length > 0);
  for (const read of reads) {
    assert.equal(read.params.target, "agent.read");
    assert.equal((read.params.args as Record<string, unknown>).runId, "run-sdk");
  }
  const decisions = outputs.decisions.parse(await send("decisions", { limit: 5 })); assert.equal(decisions.decisions.length, 1);
  assert.ok(!module.calls.some((call: { params: { target?: string } }) => targetName(call.params.target) === "notify.send"));
  console.log("PASS mind: actual SDK entry, absent Web retry, caller boundary, output contracts and one Agent run");
} finally {
  await module.stop();
  if (previous === undefined) delete process.env.CHRONA_MIND_OFFLINE_STATE; else process.env.CHRONA_MIND_OFFLINE_STATE = previous;
  await rm(directory, { recursive: true, force: true });
}

function targetName(raw: unknown): string {
  if (typeof raw === "string") return raw;
  const target = raw as { moduleId: string; tool: string };
  const names: Record<string, string> = {};
  return `${names[target.moduleId] ?? target.moduleId.replace(/-id$/, "")}.${target.tool}`;
}
