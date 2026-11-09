import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { compileModuleOutput, moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../../../../integrations/src/steward/script-sandbox";

test("ordinary author material workflow passes the offline SDK author harness", async () => {
  const dataDir = await mkdtemp("/tmp/chrona-author-harness-");
  try {
    const code = join(dataDir, "platform", "store", "author");
    await mkdir(code, { recursive: true });
    await cp(import.meta.dirname, code, { recursive: true });
    const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(code, "module.json"), "utf8")));
    expect(manifest.tools.every(tool => tool.output)).toBe(true);
    expect(manifest.uses).toEqual(["modules.source", "modules.submit", "modules.candidate-check"]);
    for (const tool of manifest.tools) expect(tool.visibility).toEqual(["write", "read", "list"].includes(tool.name) ? ["provider", "modules", "owner"] : ["owner"]);
    const sandbox = createScriptSandbox({ dataDir, executionMode: "trusted-local" });
    const contentDir = join(dataDir, "content"), moduleData = join(dataDir, "module-data");
    await mkdir(contentDir); await mkdir(moduleData);
    // Same offline SDK author process as runTests, without importing the changing kernel graph.
    expect(manifest.tests).toEqual(["test.ts"]);
    const report = await sandbox.runModule({ codeDir: code, dataDir: moduleData, contentDir, entry: "test.ts", input: { now: "2026-11-08T00:00:00Z", params: {} }, network: false, timeoutMs: 60_000, maxOutputBytes: 64 * 1024 });
    expect(report.status, JSON.stringify(report)).toBe("succeeded");
    expect(report.exitCode, JSON.stringify(report)).toBe(0);
    const examples = JSON.parse(await readFile(join(moduleData, "output-examples.json"), "utf8")) as { tool: string; output: unknown }[];
    expect(new Set(examples.map(example => example.tool)).size).toBe(manifest.tools.length);
    for (const example of examples) {
      const declaration = manifest.tools.find(tool => tool.name === example.tool)!;
      expect(compileModuleOutput(declaration.output!).safeParse(example.output).success, example.tool).toBe(true);
    }
  } finally { await rm(dataDir, { recursive: true, force: true }); }
}, 120_000);
