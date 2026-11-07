import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { moduleContext, type TestReport } from "./module-context";
import { runTests } from "./module-continuity";
import { testDb } from "./test-db";

test.each(["web", "notify", "mcp", "qq"])("%s author tests preserve application-owned policies", async name => {
  const dataDir = await mkdtemp("/tmp/chrona-policy-author-"), db = testDb();
  try {
    const code = join(dataDir, "platform", "store", name);
    await mkdir(code, { recursive: true });
    await cp(join(import.meta.dirname, name === "qq" ? "external" : "builtin", name), code, { recursive: true });
    const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(code, "module.json"), "utf8")));
    const sandbox = createScriptSandbox({ dataDir, executionMode: "trusted-local" });
    const reports: TestReport = [];
    const context = moduleContext({ db, dataDir, publicUrl: null, now: () => new Date(), sandbox: { ...sandbox.health, runModule: sandbox.runModule } }, "policy-author");
    expect(await runTests(context, code, manifest, reports), JSON.stringify(reports)).toBe(true);
  } finally { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
}, 120_000);
