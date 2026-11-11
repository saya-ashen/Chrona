import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeStartSchema, type ProviderAdapter, type ProviderRunInput } from "@chrona/contracts/steward";
import { createPiOperations } from "./operations";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function setup(capacity = 64) {
  const data = await mkdtemp("/tmp/chrona-pi-operations-"); directories.push(data);
  let starts = 0, aborts = 0, injections = 0, native = 0;
  const finishers: ((outcome: { outcome: "finished"; sessionId: null; error: null }) => void)[] = [];
  const provider: ProviderAdapter = { name: "fake", async health() { return { available: true, sandboxed: false, error: null }; }, start() {
    starts++; return { done: new Promise(resolve => { finishers.push(resolve); }), async abort() { aborts++; }, async inject() { injections++; }, async native(request) { native++; return { echoed: request }; } };
  } };
  const prepare = async (raw: unknown) => ({ provider, input: { ...raw as object, deadline: null } as ProviderRunInput });
  const operations = createPiOperations(data, prepare, undefined, capacity);
  const request = { operationId: "one", runId: "run-one", token: "launch-private-token", callbacks: "00000000-0000-4000-8000-000000000001", lane: "foreground", cwd: data, sessionDir: data, sessionId: null, prompt: "private-prompt", systemPrompt: "", resources: "configured", deadline: null };
  return { data, operations, prepare, request, counts: () => ({ starts, aborts, injections, native }), finish: (index = 0) => finishers[index]!({ outcome: "finished", sessionId: null, error: null }) };
}
async function terminal(operations: ReturnType<typeof createPiOperations>, operationId = "one") {
  for (let i = 0; i < 200; i++) {
    const status = await operations.control("status", { operationId }) as { outcome: unknown };
    if (status.outcome) return status;
    await Bun.sleep(5);
  }
  throw new Error("Fake process outcome was not committed");
}
test("concurrent retries launch once; identity, native handle and durable release are enforced", async () => {
  const f = await setup();
  await Promise.all(Array.from({ length: 8 }, () => f.operations.start(f.request)));
  expect(f.counts().starts).toBe(1);
  await expect(f.operations.start({ ...f.request, callbacks: "00000000-0000-4000-8000-000000000002" })).rejects.toMatchObject({ code: "conflict" });
  await expect(f.operations.start({ ...f.request, token: "different" })).rejects.toMatchObject({ code: "conflict" });
  expect(await f.operations.control("native", { operationId: "one", request: { type: "future_native_extension", nested: { "preserve-key": null } } })).toEqual({ response: { echoed: { type: "future_native_extension", nested: { "preserve-key": null } } } });
  await f.operations.control("inject", { operationId: "one", message: "continue" });
  await f.operations.control("abort", { operationId: "one" });
  expect(await f.operations.control("status", { operationId: "one" })).toMatchObject({ outcome: null, failure: false });
  await expect(f.operations.control("release", { operationId: "one" })).rejects.toMatchObject({ code: "conflict" });
  f.finish(); await terminal(f.operations);
  await f.operations.control("release", { operationId: "one" });
  await f.operations.start(f.request);
  const restarted = createPiOperations(f.data, f.prepare);
  await restarted.start(f.request);
  expect(f.counts()).toEqual({ starts: 1, native: 1, injections: 1, aborts: 1 });
  const journals = await Promise.all((await readdir(join(f.data, "operations"))).map(name => readFile(join(f.data, "operations", name), "utf8")));
  expect(journals.join()).not.toContain("private-prompt"); expect(journals.join()).not.toContain("launch-private-token");
});
test("restart preserves unknown launch capacity and refuses replay without trusted stop evidence", async () => {
  const f = await setup(1); await f.operations.start(f.request);
  const restarted = createPiOperations(f.data, f.prepare, undefined, 1);
  expect(await restarted.control("status", { operationId: "one" })).toMatchObject({ outcome: null, failure: true });
  await expect(restarted.start(f.request)).rejects.toMatchObject({ code: "unknown" });
  await expect(restarted.start({ ...f.request, operationId: "two", runId: "two" })).rejects.toMatchObject({ code: "capacity" });
  await expect(restarted.control("native", { operationId: "one", request: { type: "get_state" } })).rejects.toMatchObject({ code: "unknown" });
  f.finish(); await terminal(f.operations);
});
test("trusted old-host descendant receipt permits failed settlement, never replay", async () => {
  if (process.platform !== "linux") return;
  const f = await setup(), generation = "a".repeat(64), digest = createHash("sha256").update(JSON.stringify(runtimeStartSchema.parse(f.request))).digest("hex");
  await mkdir(join(f.data, "operations")); await mkdir(join(f.data, ".host-stops"));
  const key = createHash("sha256").update(JSON.stringify("one")).digest("hex");
  await writeFile(join(f.data, "operations", `${key}.json`), JSON.stringify({ digest, hostGeneration: generation }), { mode: 0o600 });
  const stopped = join(f.data, ".host-stops", `${generation}.json`);
  await writeFile(stopped, JSON.stringify({ version: 1, generation, state: "stopped", scope: "descendants", treeClean: false }), { mode: 0o600 });
  const operations = createPiOperations(f.data, f.prepare);
  expect(await operations.control("status", { operationId: "one" })).toMatchObject({ outcome: null, failure: true });
  await writeFile(stopped, JSON.stringify({ version: 1, generation, state: "stopped", scope: "descendants", treeClean: true }));
  expect(await operations.control("status", { operationId: "one" })).toMatchObject({ outcome: { outcome: "failed" }, failure: false });
  await operations.start(f.request); expect(f.counts().starts).toBe(0);
});
test("missing callbacks fail before claiming or launching; synchronous launch failures remain unknown", async () => {
  const f = await setup(); const { callbacks: _callbacks, ...unbound } = f.request;
  await expect(f.operations.start(unbound)).rejects.toMatchObject({ code: "forbidden" });
  expect(f.counts().starts).toBe(0);
  const failing = createPiOperations(f.data, async raw => ({ provider: { ...((await f.prepare(raw)).provider), start() { throw new Error("private backend details"); } }, input: (await f.prepare(raw)).input }));
  await expect(failing.start(f.request)).rejects.toMatchObject({ code: "unknown" });
  await expect(failing.start(f.request)).rejects.toMatchObject({ code: "unknown" });
});
test("shutdown waits for process stop evidence and durable outcome", async () => {
  const f = await setup(); await f.operations.start(f.request);
  let stopped = false; const stop = f.operations.stop().then(() => { stopped = true; });
  await Bun.sleep(5); expect(stopped).toBe(false);
  f.finish(); await stop; expect(stopped).toBe(true);
  expect(await createPiOperations(f.data, f.prepare).control("status", { operationId: "one" })).toMatchObject({ outcome: { outcome: "finished" }, failure: false });
});
