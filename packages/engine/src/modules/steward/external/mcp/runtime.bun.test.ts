import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../../../../integrations/src/steward/script-sandbox";
import { moduleContext, type TestReport } from "../../module-context";
import { runTests } from "../../module-continuity";
import { testDb } from "../../test-db";
import { appOverview } from "./app-overview";
import { validate } from "./validation";

test("MCP current source passes its real SDK HTTP harness offline in temporary data", async () => {
  const dataDir = await mkdtemp("/tmp/chrona-mcp-current-"), db = testDb();
  try {
    const code = join(dataDir, "mcp");
    await cp(import.meta.dirname, code, { recursive: true });
    const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(code, "module.json"), "utf8")));
    const sandbox = createScriptSandbox({ dataDir, executionMode: "trusted-local" });
    const reports: TestReport = [];
    const context = moduleContext({ db, dataDir, publicUrl: null, now: () => new Date("2026-11-09T00:00:00Z"), sandbox: { ...sandbox.health, runModule: sandbox.runModule } }, "mcp-offline");
    expect(await runTests(context, code, manifest, reports), JSON.stringify(reports)).toBe(true);
    expect(reports, JSON.stringify(reports)).toHaveLength(1);
    expect(reports[0]?.exitCode).toBe(0);
  } finally { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
}, 60_000);

test("MCP app overview limits contracts and preserves discovered read failures", async () => {
  const calls: string[] = [];
  const call = async (target: string) => {
    calls.push(target);
    if (target === "modules.list") return [{ id: "app-id", name: "example" }];
    if (target === "modules.tools") return [...Array.from({ length: 51 }, (_, index) => ({ target: `example.tool-${index}`, moduleId: "app-id" })), { target: "example.foreign", moduleId: "foreign-id" }];
    if (target === "modules.diagnostics") return [{ moduleId: "app-id", open: true }];
    throw new Error(`Unexpected ${target}`);
  };
  const overview = await appOverview(call, "example");
  expect(overview.tools).toHaveLength(50);
  expect(overview).toMatchObject({ kind: "app", truncated: true, diagnostics: { moduleId: "app-id", open: true } });
  expect(calls.sort()).toEqual(["modules.diagnostics", "modules.list", "modules.tools"]);
  await expect(appOverview(async target => {
    if (target === "modules.diagnostics") throw new Error("diagnostics failed");
    return call(target);
  }, "example")).rejects.toThrow("diagnostics failed");
});

for (const [schema, good, bad] of [
  [{ type: "object", properties: { mode: { enum: ["once"] } }, required: ["mode"], additionalProperties: false }, { mode: "once" }, [{ mode: "always" }, { mode: "once", scope: "always" }, {}]],
  [{ type: ["object", "null"], additionalProperties: false }, {}, [{ scope: "always" }]],
  [{ type: "object", properties: { count: { type: "integer", minimum: 1, maximum: 3 } } }, { count: 2 }, [{ count: "2" }, { count: 0 }, { count: 4 }, { count: 1.5 }]],
  [{ type: "object", properties: { data: { type: "array", minItems: 1, items: { type: "object", properties: { state: { enum: ["open"] } }, required: ["state"], additionalProperties: false } } } }, { data: [{ state: "open" }] }, [{ data: [] }, { data: [{ state: "closed" }] }, { data: [{ state: "open", caller: "owner" }] }]],
  [{ anyOf: [{ type: "object", properties: { receiptId: { type: "string" } }, required: ["receiptId"], additionalProperties: false }, { type: "object", properties: { admissionId: { type: "string" }, requestKey: { type: "string" } }, required: ["admissionId", "requestKey"], additionalProperties: false }] }, { receiptId: "receipt" }, [{ admissionId: "a" }, { receiptId: "r", requestKey: "extra" }]],
] as const) test(`MCP validates ${JSON.stringify(good)} without coercion or extra scope`, () => {
  expect(() => validate(schema, good)).not.toThrow();
  for (const value of bad) expect(() => validate(schema, value)).toThrow();
});

test("MCP schema validation fails closed for unsupported constraints and non-objects", () => {
  for (const schema of [{ type: "object", if: {}, then: {} }, { not: { if: {}, then: {} } }, { anyOf: [{ type: "object" }, { if: {} }] }]) expect(() => validate(schema, {})).toThrow("unsupported schema");
  for (const value of [null, [], "object", 1]) expect(() => validate({ type: "object" }, value)).toThrow();
});
