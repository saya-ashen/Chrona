import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "../../__testing__/test-db";
import { registerSystemModules } from "../../system/system-modules";
import { callsContracts, type ModuleRuntimes } from "../module-contracts";
import { typecheckBuild, typecheckErrors } from "./module-typecheck";
import { writeBuildHelpers } from "./module-build-helpers";
import { buildOwnershipError } from "./module-build-ownership";
import { moduleContext } from "../module-context";
import type { StewardPorts } from "../../ports";

const integrations = resolve(import.meta.dirname, "../../../../host/src");
const runtimes = JSON.parse(await readFile(join(integrations, "runtimes.json"), "utf8")) as ModuleRuntimes;
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  registerSystemModules();
  const db = testDb(), dir = await mkdtemp(join(tmpdir(), "chrona-typecheck-test-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dir, { recursive: true, force: true }); });
  const ports = { db, dataDir: dir, publicUrl: null, now: () => new Date(), moduleSdk: resolve(integrations, "../../app-sdk"), moduleTypecheck: resolve(integrations, "../../app-sdk/typecheck"), moduleRuntimes: runtimes } as unknown as StewardPorts;
  const workspace = await db.workspace.create({ data: { name: "w" } });
  return { ports, dir, workspaceId: workspace.id };
}
async function moduleWith(dir: string, code: string) {
  const manifest = moduleManifestSchema.parse({ name: "probe", entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [], uses: ["approvals.list", "approvals.status"] });
  await writeFile(join(dir, "module.json"), JSON.stringify(manifest));
  await writeFile(join(dir, "index.ts"), code);
  return manifest;
}

test("calls.json declares module-callable system schemas and excludes Provider-only tools", async () => {
  const f = await fixture(), calls = await callsContracts(f.ports, f.workspaceId);
  expect(calls["approvals.list"]!.output).toMatchObject({ type: "object", properties: { items: { type: "array", items: { type: "object", properties: { id: { type: "string" } } } } } });
  expect(calls["approvals.status"]!.input).toMatchObject({ type: "object", properties: { approval: { type: "string" } }, required: ["approval"] });
  expect(calls["approvals.status"]!.output).toHaveProperty("properties.resolvedAt");
  expect(Object.keys(calls).some(target => target.startsWith("schedules."))).toBe(false);
  expect(calls).not.toHaveProperty("modules.propose");
  expect(JSON.parse(JSON.stringify(calls))).toEqual(calls);
});

test("build type check: contracts pass, wrong fields, arguments and guessed type arguments fail", async () => {
  const f = await fixture(), context = moduleContext(f.ports, f.workspaceId);
  const good = await moduleWith(f.dir, `import { chrona, on } from "chrona";
on("tool", async () => {
  const approvals = await chrona.call("approvals.list");
  for (const approval of approvals.items) await chrona.call("approvals.status", { approval: approval.id });
  const other = await chrona.call<{ ok: boolean }>({ moduleId: "planning-id", tool: "get" }, { id: "p" });
  await chrona.call<{ delivered: number }>({ moduleId: "events-id", tool: "emit" }, { event: "e" });
  const queued = await chrona.call({ moduleId: "events-id", tool: "emit" }, { event: "e" }, { mode: "async", key: "emit-once" });
  const queuedId: string = queued.callId;
  return { result: { ok: other.ok, queuedId } };
});
`);
  // An open JSON output contract stays unknown unless the caller states its expected result.
  await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name: "events", status: "active", activeHash: "e1",
    versions: { create: { hash: "e1", status: "approved", source: "builtin", manifest: moduleManifestSchema.parse({ name: "events", entry: "index.ts", tests: ["test.ts"], effects: [],
      tools: [{ name: "emit", description: "Emit", parameters: { type: "object", properties: { event: { type: "string" } }, required: ["event"] }, visibility: ["modules"],
          output: {}
    }] }), intent: { changes: ["t"] }, report: {} } } } });
  expect((await callsContracts(f.ports, f.workspaceId))["events.emit"]).toEqual({ input: { type: "object", properties: { event: { type: "string" } }, required: ["event"] }, output: {} });
  await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name: "typed-app", status: "active", activeHash: "t1",
    versions: { create: { hash: "t1", status: "approved", source: "user", manifest: moduleManifestSchema.parse({ name: "typed-app", entry: "index.ts", tests: ["test.ts"], effects: [],
      tools: [{ name: "read", description: "Read", parameters: { type: "object", properties: {}, required: [] }, visibility: ["modules"], output: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false } },
        { name: "legacy", description: "Legacy", parameters: { type: "object", properties: {}, required: [] }, visibility: ["modules"],
            output: {}
        }] }), intent: {}, report: {} } } } });
  const appCalls = await callsContracts(f.ports, f.workspaceId);
  expect(appCalls["typed-app.read"]!.output).toEqual({ type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false });
  expect(appCalls["typed-app.legacy"]!.output).toEqual({});
  expect(await typecheckBuild(context, f.dir, good)).toEqual({ status: "passed" });

  const bad = await moduleWith(f.dir, `import { chrona } from "chrona";
const approvals = await chrona.call("approvals.list");
approvals.items[0]?.ids;
await chrona.call("approvals.status", { approval: 1 });
await chrona.call<{ guessed: true }>("approvals.list");
`);
  const report = await typecheckBuild(context, f.dir, bad);
  expect(report.status).toBe("failed");
  expect(report.errors!.map(error => [error.line, error.code])).toEqual(expect.arrayContaining([[3, 2339], [4, 2769], [5, 90001]]));
  expect(typecheckErrors(report)[0]).toMatch(/^Type check index\.ts:\d+ TS\d+: /);
});

test("a Python entry or a missing type check is skipped, never a failure", async () => {
  const f = await fixture();
  const python = moduleManifestSchema.parse({ name: "py", entry: "main.py", keepAlive: true, tests: ["test.py"], effects: [] });
  expect((await typecheckBuild(moduleContext(f.ports, f.workspaceId), f.dir, python)).status).toBe("skipped");
  const without = moduleContext({ ...f.ports, moduleTypecheck: undefined }, f.workspaceId);
  expect((await typecheckBuild(without, f.dir, await moduleWith(f.dir, "export {};"))).status).toBe("skipped");
});

test("build helpers render readonly declarations externally and run the declared check", async () => {
  const f = await fixture();
  const calls = { "settings.get": { input: { type: "object" }, output: { const: 1 } } };
  await writeBuildHelpers(f.dir, f.ports.moduleSdk!, { calls, typecheck: f.ports.moduleTypecheck!, runtimes });
  const pkg = join(f.dir, "node_modules/chrona"), declaration = await readFile(join(pkg, "calls.d.ts"), "utf8");
  expect(declaration).toContain('"settings.get": { args: {  }; output: 1 }');
  expect(JSON.parse(await readFile(join(pkg, "calls.json"), "utf8"))).toEqual(calls);
  if (process.platform !== "win32") for (const file of ["calls.d.ts", "calls.json"]) expect((await stat(join(pkg, file))).mode & 0o777).toBe(0o444);
  const moduleDir = join(f.dir, "module with spaces");
  await mkdir(moduleDir);
  await moduleWith(moduleDir, 'import { chrona } from "chrona"; const value: 1 = await chrona.call("settings.get"); void value;');
  expect(await runHelper(f.dir, "typecheck", moduleDir)).toMatchObject({ code: 0, stderr: "" });
  await writeFile(join(moduleDir, "index.ts"), 'import { chrona } from "chrona"; const value: 2 = await chrona.call("settings.get"); void value;');
  const failed = await runHelper(f.dir, "typecheck", moduleDir);
  expect(failed.code).toBe(1);
  expect(JSON.parse(failed.stdout).errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 2322 })]));
  expect(await readFile(join(pkg, "calls.d.ts"), "utf8")).toBe(declaration);
  const python = moduleManifestSchema.parse({ name: "py", entry: "main.py", keepAlive: true, tests: ["test.py"], effects: [] });
  await writeFile(join(moduleDir, "module.json"), JSON.stringify(python));
  const skipped = await runHelper(f.dir, "typecheck", moduleDir);
  expect(skipped.code).toBe(0);
  expect(JSON.parse(skipped.stdout).status).toBe("skipped");
});

test("affected caller type checks use candidate output contracts without modifying caller source", async () => {
  const f = await fixture(), context = moduleContext(f.ports, f.workspaceId);
  const oldOutput = { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false };
  const candidateOutput = { type: "object", properties: { value: { type: "integer" } }, required: ["value"], additionalProperties: false };
  await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name: "target", status: "active", activeHash: "target-old",
    versions: { create: { hash: "target-old", status: "approved", source: "user", manifest: moduleManifestSchema.parse({ name: "target", entry: "index.ts", tests: ["test.ts"], effects: [],
      tools: [{ name: "read", description: "Read", parameters: { type: "object", properties: {}, required: [] }, visibility: ["modules"], output: oldOutput }] }), intent: {}, report: {} } } } });
  const caller = await moduleWith(f.dir, `import { chrona, type ChronaCalls } from "chrona";\nconst result = await chrona.call<ChronaCalls["target.read"]["output"]>({ moduleId: chrona.dependencies.target!, tool: "read" });\nconst value: string = result.value;\nvoid value;\n`);
  expect(await typecheckBuild(context, f.dir, caller)).toMatchObject({ status: "passed" });
  const candidate = moduleManifestSchema.parse({ name: "target", entry: "index.ts", tests: ["test.ts"], effects: [],
    tools: [{ name: "read", description: "Read", parameters: { type: "object", properties: {}, required: [] }, visibility: ["modules"], output: candidateOutput }] });
  expect(await typecheckBuild(context, f.dir, caller, { moduleName: "target", manifest: candidate })).toMatchObject({ status: "failed" });
  expect(await readFile(join(f.dir, "index.ts"), "utf8")).toContain("const value: string");
});

test("kernel dispatches arbitrary entry extensions with declared argv, platform programs and plain JSON", async () => {
  const f = await fixture(), moduleDir = join(f.dir, "module with spaces");
  await mkdir(moduleDir);
  const manifest = { ...await moduleWith(moduleDir, "export {};"), entry: "entry.custom" };
  const check = join(f.dir, "declared check.ts");
  await writeFile(check, `import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const [moduleDir, sdk, literal] = process.argv.slice(2);
await writeFile(join(moduleDir, "receipt.json"), JSON.stringify({ sdk, literal, contracts: JSON.parse(await readFile(join(sdk, "calls.json"), "utf8")) }));
console.log("diagnostic preamble"); console.log(JSON.stringify({ errors: [], total: 0 }));`);
  const literal = "literal argument with spaces $(no-shell) ; &";
  const registry: ModuleRuntimes = { version: 1, runtimes: [{ extensions: [".custom"], programs: { default: ["unused"] }, argv: [],
    check: { programs: { default: ["missing-chrona-interpreter"], [process.platform]: ["missing-chrona-interpreter", process.execPath] }, argv: ["--no-install", check, "{module}", "{sdk}", literal] } }] };
  const run = () => typecheckBuild(moduleContext(withRuntimes(f.ports, registry), f.workspaceId), moduleDir, manifest);
  expect(await run()).toEqual({ status: "passed" });
  const receipt = JSON.parse(await readFile(join(moduleDir, "receipt.json"), "utf8"));
  expect(receipt.literal).toBe(literal);
  expect(receipt.contracts["approvals.list"].output.properties.items.type).toBe("array");
  await expect(stat(receipt.sdk)).rejects.toThrow();
  registry.runtimes[0]!.check!.programs = { default: ["missing-chrona-interpreter", process.execPath] };
  expect(await run()).toEqual({ status: "passed" });
  await writeFile(check, 'console.error("checker failed"); process.exit(7);');
  expect(await run()).toMatchObject({ status: "failed", reason: expect.stringContaining("exit 7): checker failed") });
  await writeFile(check, 'console.log("not JSON");');
  expect(await run()).toMatchObject({ status: "failed", reason: expect.stringContaining("did not finish") });
  registry.runtimes[0]!.check!.programs = { default: ["missing-chrona-interpreter"] };
  expect(await run()).toMatchObject({ status: "skipped", reason: "type check not available" });
});

test("candidate contracts replace removed tools and preserve JSON schemas", async () => {
  const f = await fixture();
  const manifest = moduleManifestSchema.parse({ name: "target", entry: "main.py", tests: ["test.py"], effects: [], tools: [
    { name: "removed", description: "Removed", parameters: { type: "object" }, visibility: ["modules"],
        output: {}
    },
  ] });
  await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name: "target", status: "active", activeHash: "old",
    versions: { create: { hash: "old", status: "approved", source: "user", manifest, intent: {}, report: {} } } } });
  expect((await callsContracts(f.ports, f.workspaceId))["target.removed"]).toEqual({ input: manifest.tools[0]!.parameters, output: {} });
  const candidate = moduleManifestSchema.parse({ ...manifest, tools: [
    { name: "added", description: "Added", parameters: { type: "object", properties: { nested: { type: "array", items: { type: "string", enum: ["one", "two"] } } } }, output: { type: "object", properties: { value: { type: "array", items: { type: "integer" } } }, required: ["value"], additionalProperties: false }, visibility: ["modules"] },
  ] });
  const contracts = await callsContracts(f.ports, f.workspaceId, { moduleName: "target", manifest: candidate });
  expect(contracts["target.removed"]).toBeUndefined();
  expect(contracts["target.added"]).toEqual({ input: candidate.tools[0]!.parameters, output: candidate.tools[0]!.output ?? null });
  expect(contracts["approvals.list"]).toBeDefined();
});

test("test helper handles spaced filenames and cleans fresh temporary dirs on success, failure and timeout", async () => {
  const f = await fixture();
  await writeBuildHelpers(f.dir, f.ports.moduleSdk!, { calls: {}, typecheck: f.ports.moduleTypecheck!, runtimes });
  const manifest = await moduleWith(f.dir, "export {};");
  manifest.tests = ["test with spaces.ts", "test with spaces.ts"];
  await writeFile(join(f.dir, "module.json"), JSON.stringify(manifest));
  const script = `import { appendFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const { CHRONA_MODULE: moduleDir, CHRONA_DATA: data, CHRONA_CONTENT: content } = process.env;
if (process.cwd() !== moduleDir || (await readdir(data)).length || (await readdir(content)).length) throw new Error("invalid test environment");
await appendFile(join(moduleDir, "dirs.jsonl"), JSON.stringify({ data, content }) + "\\n");
await writeFile(join(data, "artifact"), "test");
`;
  await writeFile(join(f.dir, manifest.tests[0]!), script);
  expect(await runHelper(f.dir, "run-tests", f.dir)).toMatchObject({ code: 0, stderr: "" });
  const dirs = () => readFile(join(f.dir, "dirs.jsonl"), "utf8").then(text => text.trim().split("\n").map(line => JSON.parse(line) as { data: string; content: string }));
  const first = await dirs();
  expect(first).toHaveLength(2);
  expect(first[0]!.data).not.toBe(first[1]!.data);
  for (const { data, content } of first) { await expect(stat(data)).rejects.toThrow(); await expect(stat(content)).rejects.toThrow(); }
  await writeFile(join(f.dir, manifest.tests[0]!), script + "process.exit(9);\n");
  expect((await runHelper(f.dir, "run-tests", f.dir)).code).toBe(9);
  expect(await dirs()).toHaveLength(3);
  const helper = join(f.dir, "chrona/run-tests.ts");
  await chmod(helper, 0o644);
  await writeFile(helper, (await readFile(helper, "utf8")).replace("60_000", "250"));
  const heartbeat = join(f.dir, "child-heartbeat.txt"), pidFile = join(f.dir, "child-pid.txt");
  const childScript = `import { writeFileSync } from "node:fs"; setInterval(() => writeFileSync(process.argv[1], String(Date.now())), 10);`;
  const descendant = process.platform === "win32" ? "" : `
const child = Bun.spawn([process.execPath, "-e", ${JSON.stringify(childScript)}, ${JSON.stringify(heartbeat)}], { detached: true, stdout: "ignore", stderr: "ignore" });
await writeFile(${JSON.stringify(pidFile)}, String(child.pid));
while (!await Bun.file(${JSON.stringify(heartbeat)}).exists()) await Bun.sleep(5);
`;
  cleanups.push(async () => { const pid = await readFile(pidFile, "utf8").catch(() => ""); if (pid) try { process.kill(Number(pid), "SIGKILL"); } catch { /* Already stopped. */ } });
  await writeFile(join(f.dir, manifest.tests[0]!), script + descendant + 'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000);\n');
  expect((await runHelper(f.dir, "run-tests", f.dir)).code).not.toBe(0);
  if (process.platform !== "win32") {
    const stopped = await readFile(heartbeat, "utf8");
    await Bun.sleep(80);
    expect(await readFile(heartbeat, "utf8")).toBe(stopped);
    const pid = Number(await readFile(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  }
  expect(await dirs()).toHaveLength(4);
  for (const { data, content } of await dirs()) { await expect(stat(data)).rejects.toThrow(); await expect(stat(content)).rejects.toThrow(); }
});

test("typecheck helper cleans its writable SDK after checker success, failure and timeout", async () => {
  const f = await fixture();
  const checker = join(f.dir, "checker with spaces.ts"), receipt = join(f.dir, "sdk-path.txt");
  const registry: ModuleRuntimes = { version: 1, runtimes: [{ extensions: [".custom"], programs: { default: [process.execPath] }, argv: [],
    check: { programs: { default: [process.execPath] }, argv: ["--no-install", checker, "{sdk}", receipt] } }] };
  await writeBuildHelpers(f.dir, f.ports.moduleSdk!, { calls: {}, typecheck: f.ports.moduleTypecheck!, runtimes: registry });
  await writeFile(join(f.dir, "module.json"), JSON.stringify({ entry: "main.custom" }));
  const script = `import { writeFile } from "node:fs/promises";
await writeFile(process.argv[3], process.argv[2]);
await writeFile(process.argv[2] + "/calls.d.ts", "// checker can regenerate declarations");
`;
  for (const [tail, expected] of [["", 0], ["process.exit(3);", 3]] as const) {
    await writeFile(checker, script + tail);
    expect((await runHelper(f.dir, "typecheck", f.dir)).code).toBe(expected);
    await expect(stat(await readFile(receipt, "utf8"))).rejects.toThrow();
  }
  const helper = join(f.dir, "chrona/typecheck.ts");
  await chmod(helper, 0o644);
  await writeFile(helper, (await readFile(helper, "utf8")).replace("60_000", "250"));
  const pidFile = join(f.dir, "checker-leaf.pid");
  cleanDescendant(pidFile);
  await writeFile(checker, script + checkerTree(pidFile, "timeout"));
  expect((await runHelper(f.dir, "typecheck", f.dir)).code).not.toBe(0);
  const pid = Number(await readFile(pidFile, "utf8"));
  expect(() => process.kill(pid, 0)).toThrow();
  await expect(stat(await readFile(receipt, "utf8"))).rejects.toThrow();
  expect(await readFile(join(f.dir, "node_modules/chrona/calls.d.ts"), "utf8")).toContain("export interface ChronaCalls");
});

// These fixtures exercise the packaged guardian; no compiler, network or model is needed.
function checkerTree(pidFile: string, mode: "exit" | "unknown" | "timeout") {
  const leaf = `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
  return `import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
if (${JSON.stringify(mode)} === "unknown") { console.log(JSON.stringify({ errors: [], total: 0 })); process.kill(process.ppid, "SIGKILL"); process.exit(0); }
spawn(process.execPath, ["-e", ${JSON.stringify(leaf)}], { detached: true, stdio: "ignore" });
while (!existsSync(${JSON.stringify(pidFile)})) await Bun.sleep(5);
if (${JSON.stringify(mode)} === "timeout") setInterval(() => {}, 1000);
else { console.log(JSON.stringify({ errors: [], total: 0 })); process.exit(0); }
`;
}
function cleanDescendant(pidFile: string) {
  cleanups.push(async () => {
    const pid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
    if (pid) try { process.kill(pid, "SIGKILL"); } catch { /* Guardian reaped it. */ }
  });
}

for (const mode of ["exit", "unknown"] as const) test.skipIf(process.platform !== "linux")(`kernel checker ${mode} requires descendant-stop proof before reporting success or removing SDK`, async () => {
  const f = await fixture(), checker = join(f.dir, "check.ts"), receipt = join(f.dir, "sdk.txt"), pidFile = join(f.dir, "leaf.pid");
  cleanDescendant(pidFile);
  await writeFile(checker, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(receipt)}, process.argv[2]);\n` + checkerTree(pidFile, mode));
  const registry: ModuleRuntimes = { version: 1, runtimes: [{ extensions: [".ts"], programs: { default: [process.execPath] }, argv: [],
    check: { programs: { default: [process.execPath] }, argv: ["--no-install", checker, "{sdk}"] } }] };
  const context = moduleContext(withRuntimes(f.ports, registry), f.workspaceId), manifest = await moduleWith(f.dir, "export {};");
  const checking = typecheckBuild(context, f.dir, manifest);
  if (mode === "unknown") {
    await expect(checking).rejects.toThrow("Process stop unknown");
    expect(buildOwnershipError(context, f.dir)?.name).toBe("ProcessStopUnknownError");
    await expect(typecheckBuild(context, f.dir, manifest)).rejects.toThrow("Process stop unknown");
  } else expect(await checking).toEqual({ status: "passed" });
  const sdk = await readFile(receipt, "utf8");
  cleanups.push(() => rm(resolve(sdk, ".."), { recursive: true, force: true }));
  expect(existsSync(join(sdk, "calls.json"))).toBe(mode === "unknown");
  if (mode === "exit") {
    const pid = Number(await readFile(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  }
});

for (const mode of ["exit", "unknown"] as const) test.skipIf(process.platform !== "linux")(`declaration generator ${mode} requires descendant-stop proof before emitting helpers`, async () => {
  const f = await fixture(), typecheck = join(f.dir, "runtime"), pidFile = join(f.dir, "leaf.pid");
  cleanDescendant(pidFile);
  await mkdir(typecheck);
  await writeFile(join(typecheck, "calls.ts"), checkerTree(pidFile, mode));
  const writing = writeBuildHelpers(f.dir, f.ports.moduleSdk!, { calls: {}, typecheck });
  if (mode === "unknown") await expect(writing).rejects.toThrow("Process stop unknown");
  else await writing;
  expect(existsSync(join(f.dir, "chrona/run-tests.ts"))).toBe(mode === "exit");
  expect(existsSync(join(f.dir, "node_modules/chrona/calls.json"))).toBe(true);
  if (mode === "exit") {
    const pid = Number(await readFile(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  }
});

for (const helper of ["run-tests", "typecheck"] as const) test.skipIf(process.platform !== "linux")(`${helper} helper rejects unknown stop and retains owned temporary resources`, async () => {
  const f = await fixture(), receipt = join(f.dir, "owned.txt"), checker = join(f.dir, "check.ts");
  const registry: ModuleRuntimes = { version: 1, runtimes: [{ extensions: [".custom"], programs: { default: [process.execPath] }, argv: [],
    check: { programs: { default: [process.execPath] }, argv: ["--no-install", checker, "{sdk}"] } }] };
  await writeBuildHelpers(f.dir, f.ports.moduleSdk!, { calls: {}, typecheck: f.ports.moduleTypecheck!, runtimes: registry });
  await writeFile(join(f.dir, "module.json"), JSON.stringify({ entry: "main.custom", tests: ["test.ts", "must-not-run.ts"] }));
  await writeFile(join(f.dir, "must-not-run.ts"), `await Bun.write(${JSON.stringify(join(f.dir, "continued"))}, "ran");`);
  await writeFile(helper === "run-tests" ? join(f.dir, "test.ts") : checker, `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(receipt)}, ${helper === "run-tests" ? "process.env.CHRONA_DATA!" : "process.argv[2]!"});
process.kill(process.ppid, "SIGKILL"); process.exit(0);
`);
  const result = await runHelper(f.dir, helper, f.dir);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("Process stop unknown");
  expect(existsSync(join(f.dir, "continued"))).toBe(false);
  const owned = await readFile(receipt, "utf8");
  cleanups.push(() => rm(resolve(owned, ".."), { recursive: true, force: true }));
  expect(existsSync(owned)).toBe(true);
  if (helper === "run-tests") expect(existsSync(join(owned, "../content"))).toBe(true);
  else expect(existsSync(join(owned, "calls.json"))).toBe(true);
});

test.each([{ path: "bin/program" }, { path: "main.custom", runtime: "python3", args: ["-u"] }])("generated checker skips object entries (%j)", async entry => {
  const f = await fixture(), receipt = join(f.dir, "checker-ran");
  const checker = join(f.dir, "checker.ts");
  await writeFile(checker, `await Bun.write(${JSON.stringify(receipt)}, "ran"); process.exit(9);`);
  const registry: ModuleRuntimes = { version: 1, runtimes: [{ extensions: [".custom"], programs: { default: [process.execPath] }, argv: [],
    check: { programs: { default: [process.execPath] }, argv: [checker] } }] };
  await writeBuildHelpers(f.dir, f.ports.moduleSdk!, { calls: {}, typecheck: f.ports.moduleTypecheck!, runtimes: registry });
  await writeFile(join(f.dir, "module.json"), JSON.stringify({ entry }));
  const result = await runHelper(f.dir, "typecheck", f.dir);
  expect(result).toMatchObject({ code: 0, stderr: "" });
  expect(JSON.parse(result.stdout)).toEqual({ status: "skipped", reason: "runtime has no declared check" });
  expect(existsSync(receipt)).toBe(false);
});
