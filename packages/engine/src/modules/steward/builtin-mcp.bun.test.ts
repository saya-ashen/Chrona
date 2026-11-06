import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { moduleContext, type TestReport } from "./module-context";
import { runTests } from "./module-continuity";
import { testDb } from "./test-db";

for (const name of ["mcp", "events", "files", "notify"]) {
  test(`${name}: real SDK author tests in an offline temporary module copy`, async () => {
    const dataDir = await mkdtemp(`/tmp/chrona-${name}-author-`), db = testDb();
    try {
      const source = join(import.meta.dirname, "builtin", name), code = join(dataDir, "platform", "store", name);
      await mkdir(code, { recursive: true }); await cp(source, code, { recursive: true });
      const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(code, "module.json"), "utf8")));
      const sandbox = createScriptSandbox({ dataDir, executionMode: "trusted-local" });
      const reports: TestReport = [];
      const context = moduleContext({ db, dataDir, publicUrl: null, now: () => new Date("2026-11-05T04:00:00Z"), sandbox: { ...sandbox.health, runModule: sandbox.runModule } }, "author-offline");
      const passed = await runTests(context, code, manifest, reports);
      expect(reports, JSON.stringify(reports)).toHaveLength(manifest.tests.length);
      expect(passed, JSON.stringify(reports)).toBe(true);
      expect(reports.every(report => report.exitCode === 0)).toBe(true);
    } finally { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
  }, 120_000);
}
