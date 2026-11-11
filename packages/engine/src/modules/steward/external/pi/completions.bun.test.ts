import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ProviderAdapter } from "@chrona/contracts/steward";
import { createPiOperations } from "./operations";
import { completionInput } from "./schema";
import { writeJournal } from "./journal";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const args = { commandKey: "completion", prompt: "private prompt", maxOutputTokens: 10, timeoutMs: 5000 };
type Status = { operationId: string; outcome: { outcome: string } | null; failure: boolean; completion?: unknown };
async function settled(operations: ReturnType<typeof createPiOperations>, id = args.commandKey) {
  for (let count = 0; count < 200; count++) {
    const status = await operations.control("status", { operationId: id }) as Status;
    if (status.outcome || status.failure) return status;
    await Bun.sleep(5);
  }
  throw new Error("Completion failed to settle");
}
async function setup(complete: NonNullable<ProviderAdapter["complete"]> = async () => ({ text: "answer", inputTokens: null, outputTokens: null })) {
  const data = await mkdtemp("/tmp/chrona-pi-completions-"); directories.push(data);
  let launches = 0;
  const provider: ProviderAdapter = { name: "pi", async health() { return { available: true, sandboxed: false, error: null }; },
    start() { throw new Error("Unexpected conversational start"); },
    async complete(input) { launches++; return complete(input); },
  };
  const prepare = async (input: ReturnType<typeof completionInput.parse>) => ({ provider, input: { ...input, model: "fixture/model" } });
  const create = () => createPiOperations(data, async () => { throw new Error("Unexpected conversation"); }, undefined, 64, prepare);
  return { data, prepare, create, launches: () => launches };
}

test("completion returns a durable receipt; status, release and restart preserve the result without another launch", async () => {
  const f = await setup(), operations = f.create();
  expect(await Promise.all([operations.complete(args), operations.complete(args)])).toEqual([{ operationId: args.commandKey }, { operationId: args.commandKey }]);
  expect(await settled(operations)).toMatchObject({ outcome: { outcome: "finished" }, completion: { text: "answer", inputTokens: null, outputTokens: null } });
  await operations.control("release", { operationId: args.commandKey });
  const recovered = f.create();
  expect(await recovered.complete(args)).toEqual({ operationId: args.commandKey });
  expect(await settled(recovered)).toMatchObject({ outcome: { outcome: "finished" }, completion: { text: "answer" } });
  await expect(recovered.complete({ ...args, maxOutputTokens: 9 })).rejects.toMatchObject({ code: "conflict" });
  expect(f.launches()).toBe(1);
});

test("pending completion is controllable through the shared journal and abort acknowledgement cannot release it", async () => {
  let signal!: AbortSignal, close!: () => void;
  const f = await setup(async input => {
    signal = (input as typeof input & { signal: AbortSignal }).signal;
    await new Promise<void>(resolve => { close = resolve; });
    throw Object.assign(new Error("Stopped"), { stopped: true });
  }), operations = f.create();
  expect(await operations.complete(args)).toEqual({ operationId: args.commandKey });
  expect(await operations.control("status", { operationId: args.commandKey })).toMatchObject({ outcome: null, failure: false });
  expect(await operations.control("abort", { operationId: args.commandKey })).toEqual({ requested: true });
  expect(signal.aborted).toBe(true);
  await expect(operations.control("release", { operationId: args.commandKey })).rejects.toMatchObject({ code: "conflict" });
  expect(await operations.complete(args)).toEqual({ operationId: args.commandKey }); expect(f.launches()).toBe(1);
  close();
  expect(await settled(operations)).toMatchObject({ outcome: { outcome: "failed", error: "Pi completion was stopped" } });
  await operations.control("release", { operationId: args.commandKey });
});

test("unverified stop stays unknown, consumes capacity and refuses release or replay across restart", async () => {
  let fail!: () => void;
  const f = await setup(async () => { await new Promise<void>((_, reject) => { fail = () => reject(new Error("private closure uncertainty")); }); throw new Error("unreachable"); });
  const operations = createPiOperations(f.data, async () => { throw new Error("unused"); }, undefined, 1, f.prepare);
  await operations.complete(args); await operations.control("abort", { operationId: args.commandKey }); fail();
  expect(await settled(operations)).toMatchObject({ failure: true, outcome: null });
  await expect(operations.control("release", { operationId: args.commandKey })).rejects.toMatchObject({ code: "conflict" });
  await expect(operations.complete(args)).rejects.toMatchObject({ code: "unknown" });
  const recovered = createPiOperations(f.data, async () => { throw new Error("unused"); }, undefined, 1, f.prepare);
  await expect(recovered.complete(args)).rejects.toMatchObject({ code: "unknown" });
  await expect(recovered.complete({ ...args, commandKey: "next" })).rejects.toMatchObject({ code: "capacity" });
  await expect(operations.stop()).rejects.toThrow(); expect(f.launches()).toBe(1);
});

for (const failure of ["budget", "size"]) test(`closed completion exceeding its ${failure} bound records failure without replay`, async () => {
  const f = await setup(async () => ({ text: failure === "size" ? "a".repeat(2 * 1024 * 1024 + 1) : "answer", inputTokens: null, outputTokens: failure === "budget" ? 11 : null }));
  const operations = f.create(); await operations.complete(args);
  expect(await settled(operations)).toMatchObject({ outcome: { outcome: "failed" } });
  await f.create().complete(args); expect(f.launches()).toBe(1);
});

test("legacy completion claims migrate into the common journal without replaying unresolved work", async () => {
  const f = await setup(), directory = join(f.data, "completions"); await mkdir(directory, { mode: 0o700 });
  const request = completionInput.parse(args);
  await writeJournal(join(directory, `${hash(args.commandKey)}.json`), { digest: hash(request) }, true);
  const operations = f.create();
  expect(await operations.control("status", { operationId: args.commandKey })).toMatchObject({ failure: true, outcome: null });
  await expect(operations.complete(args)).rejects.toMatchObject({ code: "unknown" }); expect(f.launches()).toBe(0);
});

test("recovered unresolved completion claims consume capacity before preparation", async () => {
  const f = await setup(), directory = join(f.data, "operations"); await mkdir(directory, { mode: 0o700 });
  for (let index = 0; index < 64; index++) {
    const input = completionInput.parse({ ...args, commandKey: `uncertain-${index}` });
    await writeJournal(join(directory, `${hash(input.commandKey)}.json`), { digest: hash(input) }, true);
  }
  let prepared = 0;
  const operations = createPiOperations(f.data, async () => { throw new Error("unused"); }, undefined, 64, async input => { prepared++; return f.prepare(input); });
  await expect(operations.complete(args)).rejects.toMatchObject({ code: "capacity" });
  await expect(operations.complete({ ...args, commandKey: "uncertain-0" })).rejects.toMatchObject({ code: "unknown" });
  expect(prepared).toBe(0); expect(f.launches()).toBe(0);
});
