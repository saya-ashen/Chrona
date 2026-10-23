import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile, readFile, readlink, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createScriptSandbox } from "./script-sandbox";
import { createModuleChannel } from "@chrona/engine";
import { createServer } from "node:net";
const bwrapPath = Bun.which("bwrap") ?? undefined;
const sandbox = createScriptSandbox({ bwrapPath });
if (!sandbox.health.isolated) console.warn("SKIP script sandbox integration tests: bubblewrap missing or namespaces unavailable");
const sandboxTest = sandbox.health.isolated ? test : test.skip;
sandboxTest("module code is read-only, data writable, JSON stdin, clear environment and network off by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-module-sandbox-"));
  try {
    const codeDir = join(root, "code"), dataDir = join(root, "data"), secret = join(root, "secret");
    await mkdir(codeDir); await mkdir(dataDir); await writeFile(secret, "synthetic secret");
    const network = await readlink("/proc/self/ns/net");
    await writeFile(join(codeDir, "test.py"), `import os,json,sys\nassert os.getcwd() == '/module'\nassert 'HOME' not in os.environ\nassert json.load(sys.stdin)['value'] == 42\nassert os.readlink('/proc/self/ns/net') != ${JSON.stringify(network)}\nassert os.listdir(${JSON.stringify(homedir())}) == []\nassert not os.path.exists(${JSON.stringify(secret)})\ntry:\n open('/module/test.py', 'w')\n raise AssertionError('module writable')\nexcept OSError: pass\nopen('/data/result', 'w').write('ok')\nprint('isolated')`);
    const moduleSandbox = createScriptSandbox({ bwrapPath, dataDir: root });
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
sandboxTest("long-running SDK module exchanges events and calls, stays isolated, and can be killed", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-module-channel-"));
  const codeDir = join(root, "code"), dataDir = join(root, "data"), secret = join(root, "secret");
  await mkdir(codeDir); await mkdir(dataDir); await writeFile(secret, "synthetic secret");
  const network = await readlink("/proc/self/ns/net");
  const calls: unknown[] = [];
  const channel = await createModuleChannel(join(root, "channel.sock"), { onCall: async call => {
    calls.push(call);
    return call.method === "wakeProvider" ? { id: call.id, error: { code: "undeclared", message: "Not allowed" } } : { id: call.id, result: { status: "executed" } };
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
    handle = createScriptSandbox({ bwrapPath, dataDir: root }).startModule({ codeDir, dataDir, entry: "index.ts", socketPath: join(root, "channel.sock") });
    await Promise.race([channel.ready, handle.exited.then(exit => { throw new Error(JSON.stringify(exit) + ": " + handle!.stderr()); })]);
    const now = "2026-10-22T09:00:00.000Z";
    expect(await channel.send({ trigger: { kind: "schedule", id: "daily", firedAt: now }, now, params: {} }, 2000)).toMatchObject({ result: { handled: true, result: "executed" } });
    expect(calls).toMatchObject([{ method: "notify", params: { key: "daily", body: "hello" } }, { method: "wakeProvider" }]);
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

test("without bubblewrap the same SDK module runs as a plain process and kill ends its process group", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-module-plain-"));
  const dataDir = join(root, "data"), codeDir = join(root, "platform", "store", "v1");
  await mkdir(dataDir); await mkdir(codeDir, { recursive: true });
  const plain = createScriptSandbox({ dataDir: root });
  expect(plain.health).toEqual({ available: true, isolated: false });
  const channel = await createModuleChannel(join(root, "channel.sock"), { onCall: async call => ({ id: call.id, result: { status: "executed" } }) });
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
