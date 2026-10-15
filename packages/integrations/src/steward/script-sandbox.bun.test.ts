import { expect, test } from "bun:test";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScriptSandbox } from "./script-sandbox";
const bwrapPath = Bun.which("bwrap") ?? undefined;
const sandbox = createScriptSandbox({ bwrapPath });
if (!sandbox.health.available) console.warn("SKIP script sandbox integration tests: bubblewrap missing or namespaces unavailable");
const sandboxTest = sandbox.health.available ? test : test.skip;
test("missing sandbox fails closed", async () => {
  expect(await createScriptSandbox({}).run({ language: "shell", source: "exit 0", input: {} })).toMatchObject({ status: "unavailable", error: "沙箱不可用" });
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
