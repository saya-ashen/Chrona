import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { chmod, mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScriptSandbox } from "./script-sandbox";
import { createModuleChannel } from "../../../engine/src/modules/steward/module-channel";
import { buildProcessHelper } from "../../../process/scripts/build-helper";
const sandbox = createScriptSandbox();
const localTest = process.platform === "linux" ? test : test.skip;
const previousHelper = process.env.CHRONA_PROCESS_HELPER;
let helperDir: string;
beforeAll(async () => {
  if (process.platform !== "linux") return;
  helperDir = await mkdtemp(join(tmpdir(), "chrona-sandbox-guardian-"));
  process.env.CHRONA_PROCESS_HELPER = buildProcessHelper(join(helperDir, "guardian"));
});
afterAll(async () => {
  if (previousHelper === undefined) delete process.env.CHRONA_PROCESS_HELPER; else process.env.CHRONA_PROCESS_HELPER = previousHelper;
  if (helperDir) await rm(helperDir, { recursive: true, force: true });
});

test("removed isolation mode fails explicitly", () => {
  expect(() => createScriptSandbox({ executionMode: "required-isolation" as never })).toThrow("隔离执行模式已移除");
});

localTest("interpreters launch directly with JSON stdin, bounded output and timeout", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-local-runtime-"));
  try {
    const codeDir = join(root, "code"), dataDir = join(root, "data");
    await mkdir(codeDir); await mkdir(dataDir);
    await writeFile(join(codeDir, "test.ts"), 'console.log(JSON.parse(await Bun.stdin.text()).value, process.env.MALLOC_ARENA_MAX ?? "unset");');
    expect(await sandbox.runModule({ codeDir, dataDir, entry: "test.ts", input: { value: 42 } })).toMatchObject({ status: "succeeded", output: "42 unset\n" });
    await writeFile(join(codeDir, "test.ts"), 'console.log("x".repeat(10000)); console.error("y".repeat(10000));');
    const result = await sandbox.runModule({ codeDir, dataDir, entry: "test.ts", input: {}, maxOutputBytes: 100 });
    expect(result.status).toBe("succeeded");
    expect(Buffer.byteLength(result.output)).toBe(100);
    expect(Buffer.byteLength(result.error!)).toBe(100);
    await writeFile(join(codeDir, "test.ts"), 'setInterval(() => {}, 1000);');
    expect(await sandbox.runModule({ codeDir, dataDir, entry: "test.ts", input: {}, timeoutMs: 100 })).toMatchObject({ status: "timed_out" });
    await expect(sandbox.runModule({ codeDir, dataDir, entry: "../test.ts", input: {} })).rejects.toThrow("Invalid module entry");
  } finally { await rm(root, { recursive: true, force: true }); }
});

localTest("long-running stderr is attributed and credentials split across chunks are redacted", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-module-logs-"));
  const codeDir = join(root, "code"), dataDir = join(root, "data");
  await mkdir(codeDir); await mkdir(dataDir);
  const lines: string[] = [];
  const write = spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write);
  let handle: ReturnType<typeof sandbox.startModule> | undefined;
  try {
    await writeFile(join(codeDir, "index.sh"), "printf 'pass' >&2; sleep 0.05; printf 'word=synthetic-private\\npanic: example\\n' >&2; exit 1");
    handle = createScriptSandbox({ dataDir: root }).startModule({ codeDir, dataDir, entry: "index.sh", ipcEndpoint: "tcp://127.0.0.1:12345", ipcToken: "a".repeat(64) });
    expect(await handle.exited).toEqual({ code: 1, signal: null });
    const output = lines.join("");
    expect(output).not.toContain("synthetic-private");
    expect(output).toContain("[Redacted]");
    expect(output).toContain('"moduleId":"data"');
    expect(output).toContain('"hash":"code"');
    expect(output).toContain("panic: example");
  } finally {
    write.mockRestore(); handle?.kill(); if (handle) await handle.exited;
    await rm(root, { recursive: true, force: true });
  }
});

localTest("live stderr snapshots omit incomplete credentials until the line is complete", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-module-partial-log-"));
  const codeDir = join(root, "code"), dataDir = join(root, "data");
  await mkdir(codeDir); await mkdir(dataDir);
  const key = "CHRONA_DIAGNOSTIC_TEST_TOKEN", previous = process.env[key];
  process.env[key] = "synthetic-chunked-credential";
  const lines: string[] = [];
  const write = spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write);
  let handle: ReturnType<typeof sandbox.startModule> | undefined;
  try {
    await writeFile(join(codeDir, "index.sh"), 'printf "synthetic-chunked-" >&2; while [ ! -f "$CHRONA_DATA/release" ]; do sleep 0.01; done; printf "credential\\n" >&2');
    handle = createScriptSandbox({ dataDir: root }).startModule({ codeDir, dataDir, entry: "index.sh", ipcEndpoint: "tcp://127.0.0.1:12345", ipcToken: "a".repeat(64) });
    for (let i = 0; i < 200 && !handle.stderr(); i++) await Bun.sleep(5);
    expect(handle.stderr()).not.toContain("synthetic-chunked-");
    expect(handle.stderr()).toContain("incomplete stderr line omitted");
    await writeFile(join(dataDir, "release"), "");
    expect(await handle.exited).toEqual({ code: 0, signal: null });
    expect(handle.stderr()).toContain("[Redacted]");
    expect(lines.join("")).not.toContain("synthetic-chunked-");
  } finally {
    if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
    handle?.kill(); if (handle) await handle.exited;
    write.mockRestore(); await rm(root, { recursive: true, force: true });
  }
});

localTest("trusted local SDK exchanges calls and cancellation ends its process group", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-module-plain-"));
  const dataDir = join(root, "data"), codeDir = join(root, "platform", "store", "v1");
  await mkdir(dataDir); await mkdir(codeDir, { recursive: true });
  const plain = createScriptSandbox({ dataDir: root });
  expect(plain.health).toEqual({ available: true, isolated: false });
  const channel = await createModuleChannel({ onCall: async call => ({ id: call.id, result: { callId: "c1", status: "queued" } }) });
  let handle: ReturnType<typeof plain.startModule> | undefined;
  try {
    await writeFile(join(codeDir, "index.ts"), `import { on, chrona } from "chrona";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
on("tool", async () => {
  writeFileSync(chrona.paths.data + "/result", process.cwd() + "|" + chrona.paths.module + "|" + (process.env.API_KEY ?? "none"));
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  writeFileSync(chrona.paths.data + "/child", String(child.pid));
  return { result: (await chrona.call('notify.send', { key: "k", level: "now", title: "t", body: "b" }, { mode: 'async', key: 'k' })).status };
});`);
    process.env.API_KEY = "must-not-leak";
    handle = plain.startModule({ codeDir, dataDir, entry: "index.ts", ipcEndpoint: channel.endpoint, ipcToken: channel.token });
    delete process.env.API_KEY;
    await Promise.race([channel.ready, handle.exited.then(exit => { throw new Error(JSON.stringify(exit) + ": " + handle!.stderr()); })]);
    const now = "2026-10-23T09:00:00.000Z";
    expect(await channel.send({ trigger: { kind: "schedule", id: "daily", firedAt: now }, now, params: {} }, 5000)).toMatchObject({ error: "No handler for schedule" });
    expect(await channel.send({ trigger: { kind: "tool", id: "daily", args: {}, firedAt: now }, now, params: {} }, 5000)).toMatchObject({ result: { result: "queued" } });
    expect(await readFile(join(dataDir, "result"), "utf8")).toBe(`${codeDir}|${codeDir}|none`);
    const child = Number(await readFile(join(dataDir, "child"), "utf8"));
    handle.kill();
    await handle.exited;
    await Bun.sleep(100);
    expect(() => process.kill(child, 0)).toThrow();
    await writeFile(join(codeDir, "test.ts"), 'import { paths } from "chrona/testing"; console.log(JSON.parse(await Bun.stdin.text()).value, paths.data === process.env.CHRONA_DATA);');
    expect(await plain.runModule({ codeDir, dataDir, entry: "test.ts", input: { value: 42 } })).toMatchObject({ status: "succeeded", output: "42 true\n" });
  } finally {
    delete process.env.API_KEY;
    handle?.kill(); if (handle) await handle.exited;
    await channel.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("a local start reinstalls a read-only SDK copy left by the previous start", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-sdk-reinstall-"));
  try {
    const sdk = join(root, "sdk");
    await mkdir(sdk); await writeFile(join(sdk, "sdk.ts"), "export {}"); await chmod(join(sdk, "sdk.ts"), 0o444); await chmod(sdk, 0o555);
    createScriptSandbox({ executionMode: "trusted-local", dataDir: root, moduleSdk: sdk });
    createScriptSandbox({ executionMode: "trusted-local", dataDir: root, moduleSdk: sdk });
    expect(await readFile(join(root, "platform/node_modules/chrona/sdk.ts"), "utf8")).toBe("export {}");
  } finally { await chmod(join(root, "sdk"), 0o755).catch(() => {}); await chmod(join(root, "platform/node_modules/chrona"), 0o755).catch(() => {}); await rm(root, { recursive: true, force: true }); }
});
