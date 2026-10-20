import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile, readFile, readlink, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createScriptSandbox, scriptWorkspaceArguments } from "./script-sandbox";
const bwrapPath = Bun.which("bwrap") ?? undefined;
const sandbox = createScriptSandbox({ bwrapPath });
if (!sandbox.health.available) console.warn("SKIP script sandbox integration tests: bubblewrap missing or namespaces unavailable");
const sandboxTest = sandbox.health.available ? test : test.skip;
test("workspace masks precede runtime and writable mounts", () => {
  const dataDir = join(homedir(), "chrona-test-data"), cwd = join(dataDir, "affairs", "fixture");
  const args = scriptWorkspaceArguments(cwd, ["/usr/bin/sh"], dataDir);
  const root = args.findIndex((arg, i) => arg === "--ro-bind" && args[i + 1] === "/");
  for (const path of [homedir(), dataDir]) {
    const mask = args.findIndex((arg, i) => arg === "--tmpfs" && args[i + 1] === path);
    expect(mask).toBeGreaterThan(root + 2);
    expect(mask).toBeLessThan(args.indexOf("--bind"));
    expect(mask).toBeLessThan(args.findIndex((arg, i) => arg === "--ro-bind" && args[i + 1] === "/usr/bin/sh"));
  }
  expect(args).toContain("--share-net");
});
sandboxTest("workspace can write but cannot read fake data or home secrets", async () => {
  // Use only synthetic files; never read the user's real home contents.
  const dataDir = await mkdtemp(join(tmpdir(), "chrona-hidden-data-"));
  const cwd = join(dataDir, "affairs", "fixture"), secret = join(dataDir, "secrets", "x.json");
  await mkdir(cwd, { recursive: true }); await mkdir(join(dataDir, "secrets"));
  await writeFile(secret, "fake-secret", { mode: 0o600 });
  const result = await createScriptSandbox({ bwrapPath, dataDir }).run({ language: "python", cwd, input: {}, source: `import os\ntry:\n open(${JSON.stringify(secret)}).read()\n raise AssertionError('secret visible')\nexcept OSError: pass\nassert os.listdir(${JSON.stringify(homedir())}) == []\nopen('output', 'w').write('safe')\nprint('hidden')` });
  expect(result).toMatchObject({ status: "succeeded", output: "hidden\n" });
  expect(await readFile(join(cwd, "output"), "utf8")).toBe("safe");
});
test("missing sandbox fails closed", async () => {
  expect(await createScriptSandbox({}).run({ language: "shell", source: "exit 0", input: {} })).toMatchObject({ status: "unavailable", error: "沙箱不可用" });
});
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
    expect(await createScriptSandbox({}).runModule({ codeDir, dataDir, entry: "test.py", input: {} })).toMatchObject({ status: "unavailable" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
sandboxTest("python reads JSON stdin; shell runs with minimal environment", async () => {
  expect(await sandbox.run({ language: "python", source: "import json,sys; print(json.load(sys.stdin)['value'])", input: { value: 42 } })).toMatchObject({ status: "succeeded", output: "42\n" });
  expect(await sandbox.run({ language: "shell", source: 'printf "%s:%s" "$PWD" "${HOME-unset}"', input: {} })).toMatchObject({ status: "succeeded", output: "/tmp:unset" });
});
sandboxTest("network namespace denies loopback connection; home is absent", async () => {
  // Loopback in the isolated namespace only: never reaches a host/external network.
  const source = "import socket,os\ns=socket.socket(); s.settimeout(.1)\ntry:\n s.connect(('127.0.0.1',9)); raise AssertionError('connected')\nexcept OSError: pass\nassert not os.path.exists('/home')\nassert not os.path.exists('/root')\nprint('isolated')";
  expect(await sandbox.run({ language: "python", source, input: {} })).toMatchObject({ status: "succeeded", output: "isolated\n" });
});
sandboxTest("cwd is writable, rest of host is read-only, network namespace shared", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-sandbox-")), cwd = join(root, "affair");
  const { mkdir, readlink } = await import("node:fs/promises");
  await mkdir(cwd); await writeFile(join(cwd, "input"), "value");
  const network = await readlink("/proc/self/ns/net");
  const result = await sandbox.run({ language: "python", cwd, input: {}, source: `import os\nassert os.readlink('/proc/self/ns/net') == ${JSON.stringify(network)}\nassert open('input').read() == 'value'\nopen('output', 'w').write('changed')\ntry:\n open('/chrona-sandbox-write-test', 'w')\n raise AssertionError('root writable')\nexcept OSError: pass\nprint('ok')` });
  expect(result).toMatchObject({ status: "succeeded", output: "ok\n", exitCode: 0 });
  expect(await readFile(join(cwd, "output"), "utf8")).toBe("changed");
});
sandboxTest("timeout kills and stdout/stderr are byte bounded", async () => {
  expect(await createScriptSandbox({ bwrapPath, timeoutMs: 100 }).run({ language: "shell", source: "while :; do :; done", input: {} })).toMatchObject({ status: "timed_out" });
  const result = await createScriptSandbox({ bwrapPath, maxOutputBytes: 100 }).run({ language: "python", source: "import sys; print('x'*10000); print('y'*10000,file=sys.stderr)", input: {} });
  expect(result.status).toBe("succeeded");
  expect(Buffer.byteLength(result.output)).toBe(100);
  expect(Buffer.byteLength(result.error!)).toBe(100);
});
