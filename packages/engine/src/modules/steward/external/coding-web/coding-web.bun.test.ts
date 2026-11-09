import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { compileModuleOutput, moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../../../../integrations/src/steward/script-sandbox";
import { pageErrors, createPages } from "../web/pages";
import { PAGE } from "./page";

test("ordinary coding-web passes the isolated SDK harness and strict outputs", async () => {
  const root = await mkdtemp("/tmp/chrona-coding-web-test-");
  try {
    const code = join(root, "platform", "store", "coding-web");
    await mkdir(code, { recursive: true }); await cp(import.meta.dirname, code, { recursive: true });
    const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(code, "module.json"), "utf8")));
    expect(manifest.uses).toEqual(["*", "coding.command", "web.page-set"]);
    expect(manifest.effects).toEqual([]);
    expect(manifest.tools.every(t => t.output && t.visibility?.length === 1 && t.visibility[0] === "owner")).toBe(true);
    const dataDir = join(root, "data"), contentDir = join(root, "content"); await mkdir(dataDir); await mkdir(contentDir);
    const sandbox = createScriptSandbox({ dataDir: root, executionMode: "trusted-local" });
    const report = await sandbox.runModule({ codeDir: code, dataDir, contentDir, entry: "test.ts", input: { now: "2026-11-09T00:00:00Z", params: {} }, network: false, timeoutMs: 60_000, maxOutputBytes: 64 * 1024 });
    expect(report.status, JSON.stringify(report)).toBe("succeeded");
    expect(report.exitCode, JSON.stringify(report)).toBe(0);
    const examples = JSON.parse(await readFile(join(dataDir, "output-examples.json"), "utf8")) as { tool: string; output: unknown }[];
    expect(new Set(examples.map(e => e.tool)).size).toBe(manifest.tools.length);
    for (const example of examples) expect(compileModuleOutput(manifest.tools.find(t => t.name === example.tool)!.output!).safeParse(example.output).success, example.tool).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 90_000);

test("Coding Web page validates and registers against current Web contracts", async () => {
  const root = await mkdtemp("/tmp/chrona-coding-web-page-");
  try {
    const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(import.meta.dirname, "module.json"), "utf8")));
    const tools = new Map(manifest.tools.map(t => [t.name, t.parameters]));
    expect(pageErrors(PAGE, tools, "coding-web")).toEqual([]);
    const pageTools = new Map(manifest.tools.map(t => [t.name, { inputSchema: t.parameters, moduleId: "cw1", contractHash: "1".repeat(64) }]));
    let active = true;
    const pages = createPages({ dataDir: root, modules: async () => [{ name: "coding-web", id: "cw1", activeHash: active ? "approved" : null, status: active ? "active" : "disabled" }], tools: async () => pageTools });
    await pages.tool("page-set", PAGE, { kind: "module", module: "coding-web", moduleId: "cw1" });
    expect((await pages.list()).length).toBe(1);
    active = false;
    expect(await pages.list()).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
