import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema, runtimeStartSchema } from "@chrona/contracts/steward";
import { buildPiApplication, parameters } from "../../.generated/applications/pi/build";
import { validateToolArgs } from "../../packages/kernel/src/modules/module-tool-contract";

test("built external Pi exposes structured kernel endpoints and owner configuration", async () => {
  const root = await mkdtemp("/tmp/chrona-pi-build-contract-");
  try {
    await buildPiApplication(root, new URL("../../.generated/applications/pi", import.meta.url).pathname);
    const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(root, "module.json"), "utf8")));
    expect(manifest.name).toBe("pi");
    expect(manifest.activated).toBe(true);
    expect(manifest.uses).toContain("agent.register");
    const start = manifest.tools.find(tool => tool.name === "start")!;
    const input = { operationId: "run", runId: "run", token: "private-token", callbacks: crypto.randomUUID(), lane: "foreground", cwd: root, sessionDir: root, sessionId: null, deadline: null, prompt: "private-prompt", systemPrompt: "", resources: "minimal", providerOptions: { model: "fixture/model", thinking: "high" } };
    expect(start.visibility).toEqual(["kernel"]);
    expect(() => validateToolArgs(start, input)).not.toThrow();
    expect(() => runtimeStartSchema.parse(input)).not.toThrow();
    for (const invalid of [{ ...input, input: "{}" }, { ...input, sessionId: 1 }, { ...input, operationId: undefined }]) {
      expect(() => validateToolArgs(start, invalid)).toThrow();
    }
    expect(manifest.tools.find(tool => tool.name === "native")!.parameters.properties).toHaveProperty("request");
    for (const name of ["configure", "models"]) expect(manifest.tools.find(tool => tool.name === name)!.visibility).toEqual(["owner"]);
    expect(manifest.tools.some(tool => ["run", "placement", "cleanup", "work-run"].includes(tool.name))).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Pi manifest schemas retain null and nested structured JSON unions", () => {
  expect(parameters({ anyOf: [{ type: "string" }, { type: "null" }] })).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
  expect(parameters({ type: "object", properties: { sessionId: { anyOf: [{ type: "string" }, { type: "null" }] }, entries: { type: "array", items: { type: "object", properties: {}, additionalProperties: true } } }, required: ["sessionId"] })).toEqual({ type: "object", properties: { sessionId: { anyOf: [{ type: "string" }, { type: "null" }] }, entries: { type: "array", items: { type: "object", properties: {}, required: [], additionalProperties: true } } }, required: ["sessionId"], additionalProperties: false });
});


test("Pi builds the requested staging sources after its builder has been imported", async () => {
  const root = await mkdtemp("/tmp/chrona-pi-target-source-");
  try {
    await cp(new URL("../../.generated/applications/pi", import.meta.url).pathname, root, {
      recursive: true, filter: path => !path.split("/").some(part => ["node_modules", "vendor"].includes(part)),
    });
    await writeFile(join(root, "runtime.ts"), 'console.log("explicit staged runtime source");');
    await writeFile(join(root, "test.ts"), 'console.log("explicit staged test source");');
    await buildPiApplication(root);
    expect(await readFile(join(root, "runtime.js"), "utf8")).toContain("explicit staged runtime source");
    expect(await readFile(join(root, "test.js"), "utf8")).toContain("explicit staged test source");
  } finally { await rm(root, { recursive: true, force: true }); }
});
