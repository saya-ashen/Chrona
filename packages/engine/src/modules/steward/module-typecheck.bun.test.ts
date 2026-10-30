import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { registerSystemModules } from "./system-modules";
import { callsDeclaration, tsType } from "./module-contracts";
import { typecheckBuild, typecheckErrors } from "./module-typecheck";
import { writeBuildHelpers } from "./module-build-helpers";
import { moduleContext } from "./module-context";
import type { StewardPorts } from "./ports";

const integrations = resolve(import.meta.dirname, "../../../../integrations/src/steward");
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  registerSystemModules();
  const db = testDb(), dir = await mkdtemp(join(tmpdir(), "chrona-typecheck-test-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dir, { recursive: true, force: true }); });
  const ports = { db, dataDir: dir, publicUrl: null, now: () => new Date(), moduleSdk: join(integrations, "module-sdk"), moduleTypecheck: join(integrations, "module-typecheck") } as unknown as StewardPorts;
  const workspace = await db.workspace.create({ data: { name: "w" } });
  return { ports, dir, workspaceId: workspace.id };
}
async function moduleWith(dir: string, code: string) {
  const manifest = moduleManifestSchema.parse({ name: "probe", entry: "index.ts", tests: ["test.ts"], triggers: [{ id: "tick", schedule: { kind: "every", minutes: 5 } }], effects: [], uses: ["schedules.mine", "schedules.cancel"] });
  await writeFile(join(dir, "module.json"), JSON.stringify(manifest));
  await writeFile(join(dir, "index.ts"), code);
  return manifest;
}

test("contract JSON Schema becomes TypeScript", () => {
  expect(tsType({ type: "object", properties: { a: { type: "string" }, b: { anyOf: [{ type: "number" }, { type: "null" }] } }, required: ["a"] }))
    .toBe('{ "a": string; "b"?: (number) | (null) }');
  expect(tsType({ type: "array", items: { enum: ["x", "y"] } })).toBe('Array<"x" | "y">');
  expect(tsType({ type: "object", additionalProperties: { type: "boolean" } })).toBe("{ [key: string]: boolean }");
  expect(tsType({ $ref: "#/x" } as never)).toBe("unknown");
});

test("calls.d.ts declares module-callable system tools with their outputs, not Provider-only tools", async () => {
  const f = await fixture(), calls = await callsDeclaration(f.ports, f.workspaceId);
  expect(calls).toContain('"schedules.mine": { args: {  }; output: Array<');
  expect(calls).toMatch(/"schedules\.mine": .*"key": string/);
  expect(calls).toContain('"schedules.cancel": { args: { "key": string }; output: { "cancelled": boolean } }');
  expect(calls).not.toContain('"modules.propose"');
});

test("build type check: contracts pass, wrong fields, arguments and guessed type arguments fail", async () => {
  const f = await fixture(), context = moduleContext(f.ports, f.workspaceId);
  const good = await moduleWith(f.dir, `import { chrona, on } from "chrona";
on("schedule", async event => {
  const timers = await chrona.call("schedules.mine");
  for (const timer of timers) if (timer.key !== event.scheduleId) await chrona.call("schedules.cancel", { key: timer.key });
  const other = await chrona.call<{ ok: boolean }>("planning.get", { id: "p" });
  await chrona.call<{ delivered: number }>("events.emit", { event: "e" });
  return { result: other.ok };
});
`);
  // An active app's tool without a declared output: its result is unknown, so stating the expected type is fine.
  await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name: "events", status: "active", activeHash: "e1",
    versions: { create: { hash: "e1", status: "approved", source: "builtin", manifest: moduleManifestSchema.parse({ name: "events", entry: "index.ts", tests: ["test.ts"], triggers: [], effects: [],
      tools: [{ name: "emit", description: "Emit", parameters: { type: "object", properties: { event: { type: "string" } }, required: ["event"] }, visibility: ["modules"] }] }), intent: { changes: ["t"] }, report: {} } } } });
  expect(await callsDeclaration(f.ports, f.workspaceId)).toContain('"events.emit": { args: { "event": string }; output: unknown }');
  expect(await typecheckBuild(context, f.dir, good)).toEqual({ status: "passed" });

  const bad = await moduleWith(f.dir, `import { chrona } from "chrona";
const timers = await chrona.call("schedules.mine");
timers[0]?.keys;
await chrona.call("schedules.cancel", { key: 1 });
await chrona.call<{ guessed: true }>("schedules.mine");
`);
  const report = await typecheckBuild(context, f.dir, bad);
  expect(report.status).toBe("failed");
  expect(report.errors!.map(error => [error.line, error.code])).toEqual(expect.arrayContaining([[3, 2551], [4, 2769], [5, 90001]]));
  expect(typecheckErrors(report)[0]).toMatch(/^Type check index\.ts:\d+ TS\d+: /);
});

test("a Python entry or a missing type check is skipped, never a failure", async () => {
  const f = await fixture();
  const python = moduleManifestSchema.parse({ name: "py", entry: "main.py", tests: ["test.py"], triggers: [{ id: "tick", schedule: { kind: "every", minutes: 5 } }], effects: [] });
  expect((await typecheckBuild(moduleContext(f.ports, f.workspaceId), f.dir, python)).status).toBe("skipped");
  const without = moduleContext({ ...f.ports, moduleTypecheck: undefined }, f.workspaceId);
  expect((await typecheckBuild(without, f.dir, await moduleWith(f.dir, "export {};"))).status).toBe("skipped");
});

test("build helpers give the build its calls.d.ts and the same check as chrona/typecheck.sh", async () => {
  const f = await fixture();
  await writeBuildHelpers(f.dir, f.ports.moduleSdk!, { calls: "export interface ChronaCalls { \"x.y\": { args: {}; output: 1 } }\n", typecheck: f.ports.moduleTypecheck! });
  expect(await readFile(join(f.dir, "node_modules/chrona/calls.d.ts"), "utf8")).toContain('"x.y"');
  expect((await stat(join(f.dir, "node_modules/chrona/calls.d.ts"))).mode & 0o777).toBe(0o444);
  expect(await readFile(join(f.dir, "chrona/typecheck.sh"), "utf8")).toContain(join(f.ports.moduleTypecheck!, "check.ts"));
});
