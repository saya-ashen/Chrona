import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createScriptSandbox } from "./script-sandbox";
import { createModuleChannel } from "@chrona/engine";

for (const inherited of [undefined, "/synthetic/untrusted-node-path"]) test(`trusted release SDK resolves with inherited NODE_PATH=${inherited}`, async () => {
  const root = await mkdtemp("/tmp/chrona-sdk-release-"), original = process.env.NODE_PATH;
  const channel = await createModuleChannel(join(root, "socket"), { onCall: async call => ({ id: call.id, error: { code: call.method === "call" && call.params.target === "executions.snapshot" ? "cursor_expired" : "capacity", message: "bounded fixture error" } }) });
  let child: ReturnType<ReturnType<typeof createScriptSandbox>["startModule"]> | undefined;
  try {
    if (inherited === undefined) delete process.env.NODE_PATH; else process.env.NODE_PATH = inherited;
    const codeDir = join(root, "release/resources/builtin/probe"), dataDir = join(root, "data");
    await mkdir(codeDir, { recursive: true }); await mkdir(dataDir);
    await writeFile(join(codeDir, "package.json"), JSON.stringify({ name: "probe", type: "module", dependencies: {} }));
    await writeFile(join(codeDir, "module.json"), JSON.stringify({ effects: [], uses: ["executions.start", "executions.snapshot"] }));
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
    await writeFile(join(codeDir, "index.ts"), 'import { on, chrona } from "chrona"; on("tool", async () => { const codes = []; for (const target of ["executions.start", "executions.snapshot"]) { try { await chrona.call(target, {}); } catch (error) { codes.push((error as {code:string}).code); } } return { result: { sdk: true, inherited: process.env.NODE_PATH ?? null, codes } }; });');
    const before = await readFile(join(codeDir, "index.ts"), "utf8");
    const sdk = join(root, "release/resources/module-sdk");
    await cp(join(import.meta.dirname, "module-sdk"), sdk, { recursive: true });
    const sandbox = createScriptSandbox({ executionMode: "trusted-local", dataDir, moduleSdk: sdk });
    expect(await sandbox.runModule({ codeDir, dataDir, entry: "test.ts", input: {} })).toMatchObject({ status: "succeeded", exitCode: 0, output: "function\n" });
    child = sandbox.startModule({ codeDir, dataDir, entry: "index.ts", socketPath: join(root, "socket") });
    await channel.ready;
    const now = new Date().toISOString();
    expect(await channel.send({ trigger: { kind: "tool", id: "probe", args: {}, firedAt: now }, now, params: {} }, 2000)).toMatchObject({ result: { result: { sdk: true, inherited: null, codes: ["capacity", "cursor_expired"] } } });
    expect(await readFile(join(codeDir, "index.ts"), "utf8")).toBe(before);
  } finally {
    child?.kill(); await child?.exited; await channel.close();
    if (original === undefined) delete process.env.NODE_PATH; else process.env.NODE_PATH = original;
    await rm(root, { recursive: true, force: true });
  }
}, 10_000);
