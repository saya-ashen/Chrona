import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPreferences, memoryPreferencesPatch, parseMemoryPreferences } from "./preferences";

const directories: string[] = [];
const defaults = { provider: null, autoRecall: true, autoRetain: true };
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chrona-memory-preferences-"));
  directories.push(root);
  const dataDir = join(root, "private"), path = join(dataDir, "memory-preferences.json");
  return { root, dataDir, path, store: createPreferences(dataDir) };
}

test("missing file reads defaults without creating data; returned values are independent", async () => {
  const { dataDir, store } = await fixture();
  expect(await store.read()).toEqual(defaults);
  const value = await store.tool({});
  value.autoRecall = false;
  expect(await store.read()).toEqual(defaults);
  await expect(stat(dataDir)).rejects.toMatchObject({ code: "ENOENT" });
});

test("partial settings persist opt-out and explicit null across store restarts", async () => {
  const { dataDir, path, store } = await fixture();
  expect(await store.update({ provider: "memory-local", autoRecall: false })).toEqual({ ...defaults, provider: "memory-local", autoRecall: false });
  const restarted = createPreferences(dataDir);
  expect(await restarted.tool({ settings: '{"autoRetain":false}' })).toEqual({ provider: "memory-local", autoRecall: false, autoRetain: false });
  expect(await restarted.update({ provider: null })).toEqual({ provider: null, autoRecall: false, autoRetain: false });
  expect(await createPreferences(dataDir).read()).toEqual({ provider: null, autoRecall: false, autoRetain: false });
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(await restarted.read());
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(await readdir(dataDir)).toEqual(["memory-preferences.json"]);
});

test("strict full parser and partial parser have explicit omission semantics", () => {
  expect(parseMemoryPreferences(defaults)).toEqual(defaults);
  expect(parseMemoryPreferences({ autoRecall: false }, true)).toEqual({ autoRecall: false });
  expect(memoryPreferencesPatch({})).toEqual({});
  expect(() => parseMemoryPreferences({})).toThrow();
  for (const provider of [null, "ab", "a".repeat(41), "memory-local", "a-"]) expect(memoryPreferencesPatch({ provider })).toEqual({ provider });
});

const invalidPatches: unknown[] = [
  null, undefined, [], "{}", 1, false, new Date(),
  { extra: true }, { provider: undefined }, { provider: "" }, { provider: "A" }, { provider: "a" },
  { provider: "a_b" }, { provider: "../memory" }, { provider: "a".repeat(42) },
  { provider: 1 }, { autoRecall: "false" }, { autoRetain: 0 }, { autoRecall: null },
  { autoRetain: undefined }, JSON.parse('{"__proto__":{}}'), { [Symbol("unknown")]: true },
];
test("invalid updates reject with code invalid before creating or changing files", async () => {
  const { dataDir, path, store } = await fixture();
  for (const patch of invalidPatches) {
    expect(() => memoryPreferencesPatch(patch)).toThrow();
    await expect(store.update(patch)).rejects.toMatchObject({ code: "invalid" });
  }
  await expect(stat(dataDir)).rejects.toMatchObject({ code: "ENOENT" });
  await store.update({ autoRecall: false });
  const before = await readFile(path, "utf8");
  for (const patch of invalidPatches) await expect(store.update(patch)).rejects.toMatchObject({ code: "invalid" });
  expect(await readFile(path, "utf8")).toBe(before);
});

test("tool accepts only an optional settings JSON string containing a strict patch", async () => {
  const { dataDir, store } = await fixture();
  const badArgs = [
    { unknown: true }, { settings: "{}", unknown: true }, { settings: undefined },
    { settings: {} }, { settings: "{" }, { settings: "null" }, { settings: "[]" },
    { settings: '{"autoRetain":"false"}' }, { settings: '{"unknown":true}' },
    { settings: " ".repeat(4097) }, { settings: "é".repeat(2049) },
    { [Symbol("unknown")]: true },
  ];
  for (const args of badArgs) await expect(store.tool(args)).rejects.toMatchObject({ code: "invalid" });
  await expect(stat(dataDir)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await store.tool({ settings: "{}" })).toEqual(defaults);
});

test("corrupt, incomplete, invalid and oversized persisted data cannot reset opt-outs", async () => {
  const { dataDir, path, store } = await fixture();
  await mkdir(dataDir);
  const valid = JSON.stringify({ ...defaults, autoRecall: false });
  for (const contents of ["{", "null", "[]", "{}", '{"provider":null,"autoRecall":false}', JSON.stringify({ ...defaults, autoRetain: 0 }), JSON.stringify({ ...defaults, extra: true }), valid + " ".repeat(4097), valid + "é".repeat(2049)]) {
    await writeFile(path, contents);
    await expect(store.read()).rejects.toMatchObject({ code: "invalid" });
    await expect(store.update({ provider: "memory-local" })).rejects.toMatchObject({ code: "invalid" });
    expect(await readFile(path, "utf8")).toBe(contents);
    expect(await readdir(dataDir)).toEqual(["memory-preferences.json"]);
  }
  await writeFile(path, valid.padEnd(4096, " "));
  expect(await store.read()).toEqual({ ...defaults, autoRecall: false });
  expect(await store.update({ autoRetain: false })).toEqual({ ...defaults, autoRecall: false, autoRetain: false });
});

test("filesystem errors other than ENOENT propagate and failed updates do not poison the queue", async () => {
  const { dataDir, path, store } = await fixture();
  await mkdir(dataDir);
  await mkdir(path);
  await expect(store.read()).rejects.toBeDefined();
  await expect(store.update({ autoRecall: false })).rejects.toBeDefined();
  await rm(path, { recursive: true });
  expect(await store.update({ autoRecall: false })).toEqual({ ...defaults, autoRecall: false });
});

test("concurrent partial updates merge in order and reads wait for accepted writes", async () => {
  const { dataDir, store } = await fixture();
  const first = store.update({ autoRecall: false });
  const second = store.update({ autoRetain: false });
  const third = store.update({ provider: "memory-local" });
  const read = store.read();
  expect(await first).toEqual({ ...defaults, autoRecall: false });
  expect(await second).toEqual({ ...defaults, autoRecall: false, autoRetain: false });
  const expected = { provider: "memory-local", autoRecall: false, autoRetain: false };
  expect(await third).toEqual(expected);
  expect(await read).toEqual(expected);
  expect(await createPreferences(dataDir).read()).toEqual(expected);
  expect(await readdir(dataDir)).toEqual(["memory-preferences.json"]);
});
