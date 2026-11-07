import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { moduleContext, type TestReport } from "./module-context";
import { runTests } from "./module-continuity";
import { testDb } from "./test-db";

test("coding author tests preserve original goals while dispatching module-owned work instructions", async () => {
  const dataDir = await mkdtemp("/tmp/chrona-coding-author-"), db = testDb();
  try {
    const code = join(dataDir, "platform", "store", "coding");
    await mkdir(code, { recursive: true });
    await cp(join(import.meta.dirname, "external", "coding"), code, { recursive: true });
    const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(code, "module.json"), "utf8")));
    const sandbox = createScriptSandbox({ dataDir, executionMode: "trusted-local" });
    const reports: TestReport = [];
    const context = moduleContext({ db, dataDir, publicUrl: null, now: () => new Date(), sandbox: { ...sandbox.health, runModule: sandbox.runModule } }, "coding-author");
    expect(await runTests(context, code, manifest, reports), JSON.stringify(reports)).toBe(true);
    expect(reports).toHaveLength(manifest.tests.length);
  } finally { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
}, 120_000);
