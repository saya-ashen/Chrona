import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startModule } from "../../app-sdk/testing";

const targets = ["agent.register", "agent.providers", "agent.run", "agent.read", "agent.write", "agent.stop", "agent.native"];
const cleanups: (() => void | Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(source: string) {
  const root = await mkdtemp(join(tmpdir(), "chrona-sdk-agent-")), sdk = join(root, "node_modules/chrona");
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "node_modules"));
  await cp(join(import.meta.dirname, "../../app-sdk"), sdk, { recursive: true });
  await writeFile(join(root, "module.json"), JSON.stringify({ entry: "index.ts", effects: [], uses: targets }));
  await writeFile(join(root, "index.ts"), source);
  return { root, sdk };
}
async function launch(root: string, stubs: NonNullable<Parameters<typeof startModule>[1]>["stubs"] = {}) {
  const before = process.env.CHRONA_MODULE;
  process.env.CHRONA_MODULE = root;
  cleanups.push(() => { if (before === undefined) delete process.env.CHRONA_MODULE; else process.env.CHRONA_MODULE = before; });
  const module = await startModule(join(root, "index.ts"), { stubs });
  cleanups.push(() => module.stop());
  return module;
}
const event = (args: Record<string, unknown>) => ({ trigger: { kind: "tool" as const, id: "exercise", firedAt: new Date().toISOString(), args }, now: new Date().toISOString(), params: {} });
const caller = `import { chrona, on } from "chrona";
on("tool", async event => {
  const { target, mode, key, args = {}, poll = false, explicit = false } = event.args;
  const output = explicit
    ? await chrona.call<{ callId: string }>(target, args, { mode, key })
    : await chrona.call(target, args, { mode, key });
  if (poll) return { result: await chrona.callStatus(output.callId) };
  return { result: output };
});`;

test("real SDK rejects Chat's async Agent-then-callStatus pattern before sending or invoking stubs", async () => {
  const { root } = await fixture(caller);
  let invoked = 0;
  const module = await launch(root, Object.fromEntries(targets.map(target => [target, () => { invoked++; return {}; }])));
  for (const target of targets) {
    for (const explicit of [false, true]) {
      expect(await module.send(event({ target, mode: "async", key: "operation", poll: true, explicit }))).toMatchObject({
        error: `${target} is called synchronously (its arguments are never stored)`, errorCode: "invalid",
      });
    }
  }
  expect(invoked).toBe(0);
  expect(module.calls).toEqual([]);
});

test("real SDK preserves sync admission and read/control results, and async application targets named run", async () => {
  const { root } = await fixture(caller);
  const run = { runId: "run-1", contextId: "context-1", status: "queued", active: true };
  let reads = 0;
  const module = await launch(root, {
    "agent.run": (_args, options) => { expect(options).toEqual({ mode: "sync", key: "start" }); return run; },
    "agent.read": () => ({ run: { ...run, status: ++reads === 1 ? "running" : "finished", active: reads === 1 }, items: [], nextCursor: null, ended: reads > 1, interactions: [] }),
    "agent.write": () => ({ accepted: true }),
    "agent.stop": () => ({ ...run, status: "cancelled", active: false, stopConfirmed: true }),
  });
  expect((await module.send(event({ target: "agent.run", key: "start" }))).result).toEqual({ result: run });
  expect(await module.send(event({ target: "agent.read", mode: "sync", args: { runId: run.runId } }))).toMatchObject({ result: { result: { run: { status: "running" }, ended: false } } });
  expect(await module.send(event({ target: "agent.read", args: { runId: run.runId } }))).toMatchObject({ result: { result: { run: { status: "finished" }, ended: true } } });
  expect((await module.send(event({ target: "agent.write", mode: "sync", key: "message", args: { runId: run.runId, input: { kind: "message", text: "hello" } } }))).result).toEqual({ result: { accepted: true } });
  expect(await module.send(event({ target: "agent.stop", key: "stop", args: { runId: run.runId } }))).toMatchObject({ result: { result: { stopConfirmed: true } } });
  // An object target is an ordinary application, even when its ID and tool resemble the kernel namespace.
  expect(await module.send(event({ target: { moduleId: "agent", tool: "run" }, mode: "async", key: "application" }))).toMatchObject({ result: { result: { status: "queued", callId: expect.any(String) } } });
  expect(module.calls.some(call => call.method === "callStatus")).toBe(false);
});

test("testing host rejects raw async Agent requests before both default fixtures and explicit stubs", async () => {
  // Bypass chrona.call to exercise testing.ts independently of the SDK's client-side guard.
  const { root } = await fixture(`import { connectLoopbackChannel } from "./node_modules/chrona/transport";
const pending = new Map();
const channel = connectLoopbackChannel({ endpoint: process.env.CHRONA_IPC_ENDPOINT, token: process.env.CHRONA_IPC_TOKEN,
  onMessage(message) {
    if (message.event) {
      const id = "raw:" + message.id;
      pending.set(id, message.id);
      channel.send({ id, method: "call", params: { ...message.event.trigger.args, mode: "async", key: "operation" } });
    } else if (pending.has(message.id)) {
      channel.send({ id: pending.get(message.id), result: { result: message.error ?? message.result } });
      pending.delete(message.id);
    }
  }
});`);
  for (const stubbed of [false, true]) {
    let invoked = 0;
    const module = await launch(root, stubbed ? Object.fromEntries(targets.map(target => [target, () => { invoked++; return {}; }])) : {});
    for (const target of targets) {
      expect((await module.send(event({ target, args: {} }))).result).toEqual({ result: { code: "invalid", message: `${target} is called synchronously (its arguments are never stored)` } });
    }
    expect(invoked).toBe(0);
    // The raw transport reached the testing host, unlike the client-side rejection above.
    expect(module.calls).toHaveLength(targets.length);
    await module.stop();
  }
});

async function check(root: string, sdk: string) {
  const child = Bun.spawn([process.execPath, "--no-install", join(import.meta.dirname, "../../app-sdk/typecheck/check.ts"), root, sdk], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(stderr).toBe("");
  return { code, report: JSON.parse(stdout) as { total: number; errors: { line: number; code: number }[] } };
}

test.each([false, true])("SDK types reject known async Agent calls with generated contracts = %s, retaining dynamic targets", async generated => {
  const { root, sdk } = await fixture("");
  await writeFile(join(sdk, "calls.json"), JSON.stringify(generated ? Object.fromEntries(targets.map(target => [target, { input: { type: "object" }, output: { type: "object" } }])) : {}));
  const valid = `import { chrona, type CallTarget, type CallOptions, type CallState, type KernelTarget } from "chrona";
${targets.map(target => `await chrona.call("${target}", {}, { key: "operation" });\nawait chrona.call("${target}", {}, { mode: "sync", key: "operation" });`).join("\n")}
const application: CallState = await chrona.call({ moduleId: "agent", tool: "run" }, {}, { mode: "async", key: "operation" });
async function dynamic(target: CallTarget, kernel: KernelTarget, options: CallOptions) {
  const receipt: CallState = await chrona.call(target, {}, { mode: "async", key: "operation" });
  await chrona.call(kernel, {}, { mode: "async", key: "operation" });
  await chrona.call(target, {}, options);
}
// Match kernel-client wrappers: the result generic is explicit, while target and options stay broad.
function routed<T>(target: string, args: Record<string, unknown>, options: CallOptions): Promise<T> {
  return chrona.call<T>(target as CallTarget, args, options);
}
async function page(target: CallTarget, options: CallOptions) {
  const result = await chrona.call<{ items: unknown[]; nextCursor: string | null }>(target, {}, { ...options, key: undefined });
  return { items: result.items, nextCursor: result.nextCursor };
}
${generated ? "" : targets.map(target => `await chrona.call<{ callId: string }>("${target}", {}, { mode: "async", key: "operation" });`).join("\n")}
await chrona.call<{ value: string }>({ moduleId: "app", tool: "read" }, {}, { expectedTarget: { moduleId: "app", hash: "reviewed-v1" } });
await chrona.call({ moduleId: "app", tool: "read" }, {}, { mode: "async", key: "pinned", expectedTarget: { moduleId: "app", hash: "reviewed-v1" } });
await chrona.call<CallState>({ moduleId: "agent", tool: "run" }, {}, { mode: "async", key: "operation" });
await chrona.call<CallState>("timers.list", {}, { mode: "async", key: "operation" });
await chrona.call("timers.list", {}, { mode: "async", key: "operation" });
`;
  await writeFile(join(root, "index.ts"), valid);
  expect(await check(root, sdk)).toEqual({ code: 0, report: { errors: [], total: 0 } });
  // An explicit result generic defaults the target broadly for compatibility. The runtime tests above cover that escape.
  const invalid = targets.map(target => `await chrona.call("${target}", {}, { mode: "async", key: "operation" });`);
  invalid.push(`const options: CallOptions = { mode: Math.random() ? "sync" : "async" };`, `await chrona.call("agent.run", {}, options);`);
  await writeFile(join(root, "index.ts"), `import { chrona, type CallOptions } from "chrona";\n${invalid.join("\n")}\n`);
  const checked = await check(root, sdk);
  expect(checked.code).toBe(1);
  // Every invalid call must fail TypeScript assignability/overload checks, independently of guessed-result diagnostics.
  for (let index = 0; index < invalid.length; index++) {
    if (invalid[index]!.startsWith("await")) expect(checked.report.errors.some(error => error.line === index + 2 && [2322, 2769].includes(error.code))).toBe(true);
  }
}, 30_000);

test("SDK overlaps handlers and preserves nested call ownership across awaits", async () => {
  const { root } = await fixture(`import { chrona, on } from "chrona";
  on("tool", async event => {
    await chrona.call("agent.providers", { marker: event.args.marker });
    await Promise.resolve();
    return { result: await chrona.call("modules.list", { marker: event.args.marker }) };
  });`);
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const module = await launch(root, {
    "agent.providers": async args => { if (args.marker === "slow") { entered(); await held; } return {}; },
    "modules.list": args => ({ marker: args.marker }),
  });
  const slow = module.send(event({ marker: "slow" }));
  await started;
  try {
    expect(await module.send(event({ marker: "fast" }))).toMatchObject({ result: { result: { marker: "fast" } } });
  } finally { release(); }
  expect(await slow).toMatchObject({ result: { result: { marker: "slow" } } });
  const calls = module.calls as unknown as { eventId?: string; params: { args: { marker: string } } }[];
  const ids = (marker: string) => calls.filter(call => call.params.args.marker === marker).map(call => call.eventId);
  expect(ids("slow")).toHaveLength(2);
  expect(ids("slow")[0]).toBeTruthy();
  expect(new Set(ids("slow")).size).toBe(1);
  expect(new Set(ids("fast")).size).toBe(1);
  expect(ids("slow")[0]).not.toBe(ids("fast")[0]);
});

test("SDK forwards exact expectedTarget versions for sync and async application calls", async () => {
  const { root } = await fixture(`import { chrona, on } from "chrona";
const target = { moduleId: "reviewed-app", tool: "read" };
on("tool", async event => ({ result: await chrona.call(target, {}, {
  mode: event.args.mode, key: "original", expectedTarget: { moduleId: target.moduleId, hash: "reviewed-v1" }
}) }));`);
  const module = await launch(root);
  for (const mode of ["sync", "async"]) {
    await module.send(event({ mode }));
    expect(module.calls.at(-1)).toMatchObject({ method: "call", params: {
      target: { moduleId: "reviewed-app", tool: "read" }, args: {}, mode, key: "original",
      expectedTarget: { moduleId: "reviewed-app", hash: "reviewed-v1" },
    } });
  }
});
