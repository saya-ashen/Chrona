import { expect, spyOn, test } from "bun:test";
import { chmod, mkdir, mkdtemp, writeFile, readFile, readlink, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createScriptSandbox } from "./script-sandbox";
import { createModuleChannel } from "@chrona/engine";
import { createServer } from "node:net";
const bwrapPath = Bun.which("bwrap") ?? undefined;
const sandbox = createScriptSandbox({ bwrapPath, executionMode: "required-isolation" });
if (!sandbox.health.isolated) console.warn("SKIP script sandbox integration tests: bubblewrap missing or namespaces unavailable");
const sandboxTest = sandbox.health.isolated ? test : test.skip;
sandboxTest("module code is read-only, data writable, JSON stdin, clear environment and network off by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-module-sandbox-"));
  try {
    const codeDir = join(root, "code"), dataDir = join(root, "data"), secret = join(root, "secret");
    await mkdir(codeDir); await mkdir(dataDir); await writeFile(secret, "synthetic secret");
    const network = await readlink("/proc/self/ns/net");
    await writeFile(join(codeDir, "test.py"), `import os,json,sys\nassert os.getcwd() == '/module'\nassert 'HOME' not in os.environ\nassert json.load(sys.stdin)['value'] == 42\nassert os.readlink('/proc/self/ns/net') != ${JSON.stringify(network)}\nassert os.listdir(${JSON.stringify(homedir())}) == []\nassert not os.path.exists(${JSON.stringify(secret)})\ntry:\n open('/module/test.py', 'w')\n raise AssertionError('module writable')\nexcept OSError: pass\nopen('/data/result', 'w').write('ok')\nprint('isolated')`);
    const moduleSandbox = createScriptSandbox({ bwrapPath, executionMode: "required-isolation", dataDir: root });
    expect(await moduleSandbox.runModule({ codeDir, dataDir, entry: "test.py", input: { value: 42 } })).toMatchObject({ status: "succeeded", exitCode: 0, output: "isolated\n" });
    expect(await readFile(join(dataDir, "result"), "utf8")).toBe("ok");
    await writeFile(join(codeDir, "test.py"), `import os\nassert os.readlink('/proc/self/ns/net') == ${JSON.stringify(network)}\nprint('shared')`);
    expect(await moduleSandbox.runModule({ codeDir, dataDir, entry: "test.py", input: {}, network: true })).toMatchObject({ status: "succeeded", output: "shared\n" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
sandboxTest("module interpreters, timeout, output caps and entry validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-module-limits-"));
  try {
    const codeDir = join(root, "code"), dataDir = join(root, "data");
    await mkdir(codeDir); await mkdir(dataDir);
    await writeFile(join(codeDir, "test.sh"), 'printf "%s:%s" "$PWD" "${HOME-unset}"');
    await writeFile(join(codeDir, "test.ts"), 'console.log(JSON.parse(await Bun.stdin.text()).value)');
    expect(await sandbox.runModule({ codeDir, dataDir, entry: "test.sh", input: {} })).toMatchObject({ status: "succeeded", output: "/module:unset" });
    expect(await sandbox.runModule({ codeDir, dataDir, entry: "test.ts", input: { value: 42 } })).toMatchObject({ status: "succeeded", output: "42\n" });
    await writeFile(join(codeDir, "test.sh"), 'while :; do :; done');
    expect(await sandbox.runModule({ codeDir, dataDir, entry: "test.sh", input: {}, timeoutMs: 100 })).toMatchObject({ status: "timed_out" });
    await writeFile(join(codeDir, "test.py"), "import sys; print('x'*10000); print('y'*10000,file=sys.stderr)");
    const result = await sandbox.runModule({ codeDir, dataDir, entry: "test.py", input: {}, maxOutputBytes: 100 });
    expect(result.status).toBe("succeeded");
    expect(Buffer.byteLength(result.output)).toBe(100);
    expect(Buffer.byteLength(result.error!)).toBe(100);
    await expect(sandbox.runModule({ codeDir, dataDir, entry: "../test.py", input: {} })).rejects.toThrow("Invalid module entry");
  } finally { await rm(root, { recursive: true, force: true }); }
});
sandboxTest("trusted author-test memory overrides stay bounded and do not change the default sandbox limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-test-memory-"));
  try {
    const codeDir = join(root, "code"), dataDir = join(root, "data");
    await mkdir(codeDir); await mkdir(dataDir);
    await writeFile(join(codeDir, "test.sh"), 'ulimit -v');
    expect(await sandbox.runModule({ codeDir, dataDir, entry: "test.sh", input: {}, memoryMb: 2048 })).toMatchObject({ status: "succeeded", output: "2097152\n" });
    expect(await sandbox.runModule({ codeDir, dataDir, entry: "test.sh", input: {} })).toMatchObject({ status: "succeeded", output: "1048576\n" });
    await expect(sandbox.runModule({ codeDir, dataDir, entry: "test.sh", input: {}, memoryMb: 0 })).rejects.toThrow("Invalid sandbox limit");
  } finally { await rm(root, { recursive: true, force: true }); }
});
// v2-21: a module's manifest may raise its own address-space cap; the default stays for everyone else.
sandboxTest("a long-running module gets the memory cap it declared", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-start-memory-"));
  const channel = await createModuleChannel(join(root, "s"), { onCall: async call => ({ id: call.id, result: { output: null } }) });
  const lines: string[] = [];
  const write = spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write);
  let handle: ReturnType<typeof sandbox.startModule> | undefined;
  try {
    const codeDir = join(root, "code"), dataDir = join(root, "data");
    await mkdir(codeDir); await mkdir(dataDir);
    await writeFile(join(codeDir, "index.sh"), "ulimit -v >&2");
    handle = createScriptSandbox({ dataDir: root }).startModule({ codeDir, dataDir, entry: "index.sh", socketPath: join(root, "s"), memoryMb: 4096 });
    expect(await handle.exited).toEqual({ code: 0, signal: null });
    expect(handle.limits).toEqual({ virtualMemoryMb: 4096 });
    expect(lines.join("")).toContain("4194304");
    expect(() => createScriptSandbox({ dataDir: root }).startModule({ codeDir, dataDir, entry: "index.sh", socketPath: join(root, "s"), memoryMb: 0 })).toThrow("Invalid sandbox limit");
  } finally { write.mockRestore(); handle?.kill(); await channel.close(); await rm(root, { recursive: true, force: true }); }
});
sandboxTest("long-running SDK module exchanges events and calls, stays isolated, and can be killed", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-module-channel-"));
  const codeDir = join(root, "code"), dataDir = join(root, "data"), secret = join(root, "secret");
  await mkdir(codeDir); await mkdir(dataDir); await writeFile(secret, "synthetic secret");
  const network = await readlink("/proc/self/ns/net");
  const calls: unknown[] = [];
  const channel = await createModuleChannel(join(root, "channel.sock"), { onCall: async call => {
    calls.push(call);
    return call.method === "call" && call.params.target === "provider.wake" ? { id: call.id, error: { code: "undeclared", message: "Not allowed" } } : { id: call.id, result: { callId: "c1", status: "queued" } };
  } });
  // An actual host listener distinguishes isolated loopback from an unused port.
  const listener = createServer(socket => socket.destroy());
  await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as { port: number }).port;
  let handle: ReturnType<typeof sandbox.startModule> | undefined;
  try {
    await writeFile(join(codeDir, "index.ts"), `import { on, chrona } from "chrona";
import { readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
on("schedule", async ev => {
  if (readdirSync(${JSON.stringify(homedir())}).length) throw new Error("home visible");
  try { readFileSync(${JSON.stringify(secret)}); throw new Error("secret visible"); } catch (e) { if (e.message === "secret visible") throw e; }
  if (readlinkSync("/proc/self/ns/net") === ${JSON.stringify(network)}) throw new Error("network shared");
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: ${port} });
    socket.on("connect", () => { socket.destroy(); reject(new Error("host network visible")); });
    socket.on("error", resolve);
    socket.setTimeout(500, () => { socket.destroy(); resolve(undefined); });
  });
  for (const path of ["/module/index.ts", "/node_modules/chrona/sdk.ts", "/chrona/new-file", "/new-file"]) {
    try { writeFileSync(path, "bad"); throw new Error("writable: " + path); } catch (e) { if (e.message.startsWith("writable:")) throw e; }
  }
  if (chrona.paths.data !== "/data") throw new Error("paths: " + chrona.paths.data);
  writeFileSync("/data/result", "ok");
  const reply = await chrona.notify({ key: ev.id, level: "now", title: "test", body: "hello" });
  try { await chrona.wakeProvider({ key: "wake", prompt: "hello" }); throw new Error("error reply resolved"); }
  catch (e) { if (e.message !== "Not allowed") throw e; }
  return { handled: true, result: reply.status };
});
on("tool", () => { throw new Error("handler failed"); });`);
    handle = createScriptSandbox({ bwrapPath, executionMode: "required-isolation", dataDir: root }).startModule({ codeDir, dataDir, entry: "index.ts", socketPath: join(root, "channel.sock") });
    await Promise.race([channel.ready, handle.exited.then(exit => { throw new Error(JSON.stringify(exit) + ": " + handle!.stderr()); })]);
    const now = "2026-10-22T09:00:00.000Z";
    expect(await channel.send({ trigger: { kind: "schedule", id: "daily", firedAt: now }, now, params: {} }, 2000)).toMatchObject({ result: { handled: true, result: "executed" } });
    // The SDK shorthands are routed calls (v2-10).
    expect(calls).toMatchObject([{ method: "call", params: { target: "notify.send", mode: "async", key: `daily:${now}:daily`, args: { key: `daily:${now}:daily`, body: "hello" } } }, { method: "call", params: { target: "provider.wake" } }]);
    expect(await channel.send({ trigger: { kind: "tool", id: "test", firedAt: now, args: {} }, now, params: {} }, 2000)).toMatchObject({ error: "handler failed" });
    expect(await readFile(join(dataDir, "result"), "utf8")).toBe("ok");
    expect(handle.pid).toBeGreaterThan(0);
    handle.kill();
    expect(await handle.exited).toMatchObject({ signal: "SIGKILL" });
  } finally {
    handle?.kill(); if (handle) await handle.exited;
    await channel.close();
    await new Promise<void>(resolve => listener.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("execution mode defaults to trusted local and required isolation fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-execution-mode-"));
  const dataDir = join(root, "data"), codeDir = join(root, "code"), unusableBwrap = join(root, "bwrap");
  try {
    await mkdir(dataDir); await mkdir(codeDir);
    await writeFile(join(codeDir, "test.sh"), "printf local");
    await writeFile(unusableBwrap, "#!/bin/sh\nexit 1", { mode: 0o755 });
    const local = createScriptSandbox({ dataDir: root, bwrapPath: unusableBwrap, executionMode: "trusted-local" });
    expect(local.health).toEqual({ available: true, isolated: false });
    expect(await local.runModule({ codeDir, dataDir, entry: "test.sh", input: {} })).toMatchObject({ status: "succeeded", output: "local" });
    const required = createScriptSandbox({ dataDir: root, bwrapPath: unusableBwrap, executionMode: "required-isolation" });
    expect(required.health).toEqual({ available: false, isolated: false });
    expect(await required.runModule({ codeDir, dataDir, entry: "test.sh", input: {} })).toMatchObject({ status: "unavailable", error: "要求隔离执行，但 bubblewrap 不可用" });
    expect(() => required.startModule({ codeDir, dataDir, entry: "test.sh", socketPath: join(root, "module.sock") })).toThrow("要求隔离执行，但 bubblewrap 不可用");
    const defaultLocal = createScriptSandbox({ dataDir: root, bwrapPath: unusableBwrap });
    expect(defaultLocal.health).toEqual({ available: true, isolated: false });
    expect(await defaultLocal.runModule({ codeDir, dataDir, entry: "test.sh", input: {} })).toMatchObject({ status: "succeeded", output: "local" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("default per-process virtual address limit is 1 GiB without requiring namespaces", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-default-memory-"));
  try {
    const codeDir = join(root, "code"), dataDir = join(root, "data");
    await mkdir(codeDir); await mkdir(dataDir);
    await writeFile(join(codeDir, "limit.sh"), "ulimit -v");
    const local = createScriptSandbox({ dataDir: root });
    expect(await local.runModule({ codeDir, dataDir, entry: "limit.sh", input: {} })).toMatchObject({ status: "succeeded", output: "1048576\n" });
    expect(await local.runModule({ codeDir, dataDir, entry: "limit.sh", input: {}, memoryMb: 2048 })).toMatchObject({ status: "succeeded", output: "2097152\n" });
    await expect(local.runModule({ codeDir, dataDir, entry: "limit.sh", input: {}, memoryMb: 0 })).rejects.toThrow("Invalid sandbox limit");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a threaded Bun module stays within the default 1 GiB address limit (glibc arenas capped)", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-module-threads-"));
  try {
    const codeDir = join(root, "code"), dataDir = join(root, "data");
    await mkdir(codeDir); await mkdir(dataDir);
    // Twelve workers and a full GC start the JSC helper threads that aborted the web module under ulimit -v.
    await writeFile(join(codeDir, "threads.ts"), `const workers = Array.from({ length: 12 }, () => new Worker(URL.createObjectURL(new Blob(["setInterval(() => {}, 1000)"]))));
await Bun.sleep(300); Bun.gc(true); console.log(process.env.MALLOC_ARENA_MAX, workers.length); process.exit(0);`);
    const sandbox = createScriptSandbox({ dataDir: root });
    for (let run = 0; run < 5; run++) expect(await sandbox.runModule({ codeDir, dataDir, entry: "threads.ts", input: {} })).toMatchObject({ status: "succeeded", output: "2 12\n" });
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

test("long-running stderr is attributed and credentials split across chunks are redacted", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-module-logs-"));
  const codeDir = join(root, "code"), dataDir = join(root, "data");
  await mkdir(codeDir); await mkdir(dataDir);
  const channel = await createModuleChannel(join(root, "channel.sock"), { onCall: async call => ({ id: call.id, result: { output: null } }) });
  const lines: string[] = [];
  const write = spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write);
  let handle: ReturnType<typeof sandbox.startModule> | undefined;
  try {
    await writeFile(join(codeDir, "index.sh"), "printf 'pass' >&2; sleep 0.05; printf 'word=synthetic-private\\npanic: example\\n' >&2; exit 1");
    handle = createScriptSandbox({ dataDir: root }).startModule({ codeDir, dataDir, entry: "index.sh", socketPath: join(root, "channel.sock") });
    expect(await handle.exited).toEqual({ code: 1, signal: null });
    expect(handle.limits).toEqual({ virtualMemoryMb: 1024 });
    const output = lines.join("");
    expect(output).not.toContain("synthetic-private");
    expect(output).toContain("[Redacted]");
    expect(output).toContain('"moduleId":"data"');
    expect(output).toContain('"hash":"code"');
    expect(output).toContain("panic: example");
  } finally {
    write.mockRestore(); handle?.kill(); if (handle) await handle.exited;
    await channel.close(); await rm(root, { recursive: true, force: true });
  }
});

test("live stderr snapshots omit incomplete credentials until the line is complete", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-module-partial-log-"));
  const codeDir = join(root, "code"), dataDir = join(root, "data");
  await mkdir(codeDir); await mkdir(dataDir);
  const channel = await createModuleChannel(join(root, "channel.sock"), { onCall: async call => ({ id: call.id, result: { output: null } }) });
  const key = "CHRONA_DIAGNOSTIC_TEST_TOKEN", previous = process.env[key];
  process.env[key] = "synthetic-chunked-credential";
  const lines: string[] = [];
  const write = spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write);
  let handle: ReturnType<typeof sandbox.startModule> | undefined;
  try {
    await writeFile(join(codeDir, "index.sh"), 'printf "synthetic-chunked-" >&2; while [ ! -f "$CHRONA_DATA/release" ]; do sleep 0.01; done; printf "credential\\n" >&2');
    handle = createScriptSandbox({ dataDir: root }).startModule({ codeDir, dataDir, entry: "index.sh", socketPath: join(root, "channel.sock") });
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
    write.mockRestore(); await channel.close(); await rm(root, { recursive: true, force: true });
  }
});

test("without bubblewrap the same SDK module runs as a plain process and kill ends its process group", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-module-plain-"));
  const dataDir = join(root, "data"), codeDir = join(root, "platform", "store", "v1");
  await mkdir(dataDir); await mkdir(codeDir, { recursive: true });
  const plain = createScriptSandbox({ dataDir: root });
  expect(plain.health).toEqual({ available: true, isolated: false });
  const channel = await createModuleChannel(join(root, "channel.sock"), { onCall: async call => ({ id: call.id, result: { callId: "c1", status: "queued" } }) });
  let handle: ReturnType<typeof plain.startModule> | undefined;
  try {
    await writeFile(join(codeDir, "index.ts"), `import { on, chrona } from "chrona";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
on("schedule", async () => {
  writeFileSync(chrona.paths.data + "/result", process.cwd() + "|" + chrona.paths.module + "|" + (process.env.API_KEY ?? "none"));
  const child = spawn("sleep", ["30"], { stdio: "ignore" });
  writeFileSync(chrona.paths.data + "/child", String(child.pid));
  return { result: (await chrona.notify({ key: "k", level: "now", title: "t", body: "b" })).status };
});`);
    process.env.API_KEY = "must-not-leak";
    handle = plain.startModule({ codeDir, dataDir, entry: "index.ts", socketPath: join(root, "channel.sock") });
    delete process.env.API_KEY;
    await Promise.race([channel.ready, handle.exited.then(exit => { throw new Error(JSON.stringify(exit) + ": " + handle!.stderr()); })]);
    const now = "2026-10-23T09:00:00.000Z";
    expect(await channel.send({ trigger: { kind: "schedule", id: "daily", firedAt: now }, now, params: {} }, 5000)).toMatchObject({ result: { result: "executed" } });
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
