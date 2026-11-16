import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createScriptSandbox } from "./runtime/script-sandbox";
import { createModuleChannel } from "@chrona/engine";

async function releaseResources(root: string) {
  const sdk = join(root, "release/resources/module-sdk"), typecheck = join(root, "release/resources/module-typecheck");
  await cp(join(import.meta.dirname, "module-sdk"), sdk, { recursive: true });
  await mkdir(typecheck, { recursive: true });
  const loader = join(import.meta.dirname, "module-typecheck/chrona-sdk-loader.ts");
  await cp(loader, join(typecheck, "chrona-sdk-loader.ts"));
  await cp(loader, join(sdk, "chrona-sdk-loader.ts"));
  return { sdk, typecheck };
}

for (const inherited of [undefined, "/synthetic/untrusted-node-path"]) test(`trusted release SDK resolves with inherited NODE_PATH=${inherited}`, async () => {
  const root = await mkdtemp("/tmp/chrona-sdk-release-"), original = process.env.NODE_PATH;
  const channel = await createModuleChannel({ onCall: async call => ({ id: call.id, error: { code: call.method === "call" && call.params.target === "modules.describe" ? "unavailable" : "conflict", message: "bounded fixture error" } }) });
  let child: ReturnType<ReturnType<typeof createScriptSandbox>["startModule"]> | undefined;
  try {
    if (inherited === undefined) delete process.env.NODE_PATH; else process.env.NODE_PATH = inherited;
    const codeDir = join(root, "release/resources/builtin/probe"), dataDir = join(root, "data");
    await mkdir(codeDir, { recursive: true }); await mkdir(dataDir);
    await writeFile(join(codeDir, "package.json"), JSON.stringify({ name: "probe", type: "module", dependencies: {} }));
    await writeFile(join(codeDir, "module.json"), JSON.stringify({ effects: [], uses: ["modules.list", "modules.describe"] }));
    await writeFile(join(codeDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "esnext", moduleResolution: "bundler" } }));
    await writeFile(join(codeDir, "test.ts"), `import assert from "node:assert/strict";
import { startModule } from "chrona/testing";
const module = await startModule("index.ts");
try {
  const now = new Date().toISOString();
  const reply = await module.send({ trigger: { kind: "tool", id: "probe", args: {}, firedAt: now }, now, params: {} });
  assert.deepEqual(reply.result?.result, { sdk: true, inherited: null, codes: [] });
  console.log(typeof startModule);
} finally { await module.stop(); }
`);
    await writeFile(join(codeDir, "index.ts"), 'import { on, chrona } from "chrona"; on("tool", async () => { const codes = []; for (const target of ["modules.list", "modules.describe"]) { try { await chrona.call(target, {}); } catch (error) { codes.push((error as {code:string}).code); } } return { result: { sdk: true, inherited: process.env.NODE_PATH ?? null, codes } }; });');
    const before = await readFile(join(codeDir, "index.ts"), "utf8");
    const { sdk, typecheck } = await releaseResources(root);
    const sandbox = createScriptSandbox({ executionMode: "trusted-local", dataDir, moduleSdk: sdk, moduleTypecheck: typecheck });
    expect(await sandbox.runModule({ codeDir, dataDir, entry: "test.ts", input: {} })).toMatchObject({ status: "succeeded", exitCode: 0, output: "function\n" });
    child = sandbox.startModule({ codeDir, dataDir, entry: "index.ts", ipcEndpoint: channel.endpoint, ipcToken: channel.token });
    await channel.ready;
    const now = new Date().toISOString();
    expect(await channel.send({ trigger: { kind: "tool", id: "probe", args: {}, firedAt: now }, now, params: {} }, 2000)).toMatchObject({ result: { result: { sdk: true, inherited: null, codes: ["conflict", "unavailable"] } } });
    expect(await readFile(join(codeDir, "index.ts"), "utf8")).toBe(before);
  } finally {
    child?.kill(); await child?.exited; await channel.close();
    if (original === undefined) delete process.env.NODE_PATH; else process.env.NODE_PATH = original;
    await rm(root, { recursive: true, force: true });
  }
}, 10_000);

for (const mode of ["stop", "exit", "unknown"] as const) test.skipIf(process.platform !== "linux")(`copied SDK testing ${mode} preserves descendant stop evidence`, async () => {
  const root = await mkdtemp("/tmp/chrona-sdk-process-release-");
  try {
    const { sdk, typecheck } = await releaseResources(root);
    // Exercise the trusted override independently of the SDK-local static loader.
    if (mode === "exit") await rm(join(sdk, "chrona-sdk-loader.ts"));
    const codeDir = join(root, "app"), dataDir = join(root, "data"), contentDir = join(root, "content");
    await mkdir(codeDir); await mkdir(dataDir); await mkdir(contentDir);
    await writeFile(join(codeDir, "module.json"), JSON.stringify({ effects: [], uses: [] }));
    await writeFile(join(codeDir, "index.ts"), `import { on } from "chrona";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
child.unref();
writeFileSync(process.env.CHRONA_DATA + "/descendant", String(child.pid));
const guardian = Number(readFileSync("/proc/" + process.pid + "/status", "utf8").match(/^PPid:\\s+(\\d+)$/m)[1]);
on("tool", () => {
  ${mode === "exit" ? "setTimeout(() => process.exit(0), 50);" : ""}
  return { result: { child: child.pid, guardian } };
});
`);
    await writeFile(join(codeDir, "test.ts"), `import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { startModule } from "chrona/testing";
import { ProcessStopUnknownError } from "chrona/process";
${mode === "exit" ? `process.env.CHRONA_SDK_LOADER = ${JSON.stringify(join(typecheck, "chrona-sdk-loader.ts"))};` : ""}
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const module = await startModule("index.ts");
const now = new Date().toISOString();
const reply = await module.send({ trigger: { kind: "tool", id: "probe", args: {}, firedAt: now }, now, params: {} });
const { child, guardian } = reply.result.result;
assert.equal(alive(child), true);
${mode === "unknown" ? `
writeFileSync(process.env.CHRONA_DATA + "/owned", "retain");
writeFileSync(process.env.CHRONA_CONTENT + "/owned", "retain");
process.kill(guardian, "SIGKILL");
await assert.rejects(module.exited, ProcessStopUnknownError);
await assert.rejects(module.stop(), ProcessStopUnknownError);
assert.equal(existsSync(process.env.CHRONA_DATA + "/owned"), true);
assert.equal(existsSync(process.env.CHRONA_CONTENT + "/owned"), true);
assert.equal(alive(child), true);
` : mode === "exit" ? "await module.exited; await module.stop(); assert.equal(alive(child), false);" : "await module.stop(); await module.stop(); assert.equal(alive(child), false);"}
console.log("verified");
// On unknown, the outer test guardian still owns and reaps the retained tree.
${mode === "unknown" ? "process.exit(0);" : ""}
`);
    const sandbox = createScriptSandbox({ dataDir, moduleSdk: sdk, moduleTypecheck: typecheck });
    expect(await sandbox.runModule({ codeDir, dataDir, contentDir, entry: "test.ts", input: {} })).toMatchObject({ status: "succeeded", exitCode: 0, output: "verified\n", stopEvidence: { treeClean: true } });
    const descendant = Number(await readFile(join(dataDir, "descendant"), "utf8"));
    expect(() => process.kill(descendant, 0)).toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
}, 10_000);

for (const mode of ["native", "interpreter"] as const) test.skipIf(process.platform !== "linux")(`copied SDK testing starts explicit ${mode} entries`, async () => {
  const root = await mkdtemp("/tmp/chrona-sdk-explicit-release-");
  try {
    const { sdk, typecheck } = await releaseResources(root);
    const codeDir = join(root, "app"), dataDir = join(root, "data");
    await mkdir(join(codeDir, "dist"), { recursive: true }); await mkdir(dataDir);
    await writeFile(join(codeDir, "module.json"), JSON.stringify({ effects: [], uses: [] }));
    // An explicit interpreter owns its runtime integration: it loads the copied SDK directly.
    await writeFile(join(codeDir, "dist/channel.js"), 'const { on } = await import(process.env.CHRONA_SDK + "/sdk.ts"); on("tool", () => ({ result: "explicit" }));');
    if (mode === "native") await cp(process.execPath, join(codeDir, "dist/runner"));
    const entry = mode === "native" ? { path: "dist/runner", args: ["--no-install", "dist/channel.js"] } : { path: "dist/channel.js", runtime: "bun", args: ["--no-install"] };
    await writeFile(join(codeDir, "test.ts"), `import assert from "node:assert/strict";
import { startModule } from "chrona/testing";
const module = await startModule(${JSON.stringify(entry)});
try {
  const now = new Date().toISOString();
  const reply = await module.send({ trigger: { kind: "tool", id: "probe", args: {}, firedAt: now }, now, params: {} });
  assert.equal(reply.result?.result, "explicit");
  console.log("verified");
} finally { await module.stop(); }
`);
    const sandbox = createScriptSandbox({ dataDir, moduleSdk: sdk, moduleTypecheck: typecheck });
    expect(await sandbox.runModule({ codeDir, dataDir, entry: "test.ts", input: {} })).toMatchObject({ status: "succeeded", output: "verified\n", stopEvidence: { treeClean: true } });
  } finally { await rm(root, { recursive: true, force: true }); }
}, 10_000);

test("direct TypeScript checker skips explicit entries before reading SDK declarations", async () => {
  const root = await mkdtemp("/tmp/chrona-explicit-typecheck-");
  try {
    await writeFile(join(root, "module.json"), JSON.stringify({ entry: { path: "dist/app.ts", runtime: "bun" } }));
    const child = Bun.spawn([process.execPath, "--no-install", join(import.meta.dirname, "module-typecheck/check.ts"), root, join(root, "absent-sdk")], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stderr, report: JSON.parse(stdout) }).toEqual({ code: 0, stderr: "", report: { status: "skipped", reason: "explicit entry has no declared check" } });
  } finally { await rm(root, { recursive: true, force: true }); }
});
