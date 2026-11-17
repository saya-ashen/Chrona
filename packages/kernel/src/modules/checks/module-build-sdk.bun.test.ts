import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../../host/src/runtime/script-sandbox";
import { smokeRun } from "./module-probe";
import { checkContinuity } from "./module-continuity";
import { moduleContext, type ContinuityReport } from "../module-context";
import { testDb } from "../../__testing__/test-db";
import { notices } from "../../__testing__/test-notices";

const sandbox = createScriptSandbox({  });
(sandbox.health.available ? test : test.skip)("installation loads SDK without running application tests, tools or private-data rehearsals", async () => {
  const dir = await mkdtemp("/tmp/cb-sdk-"), db = testDb();
  try {
    const runtime = createScriptSandbox({ dataDir: dir });
    const code = join(dir, "platform/store/sdk"); await mkdir(code, { recursive: true });
    const manifest = moduleManifestSchema.parse({ name: "sdk-check", entry: "index.ts", tests: ["test.ts"], effects: [], data: { schema: 2, migrate: "migrate.ts" },
      keepAlive: true,
      tools: [{ name: "lookup", description: "Lookup", idempotent: true, parameters: { type: "object", properties: {} },
          output: {}
    }] });
    await writeFile(join(code, "module.json"), JSON.stringify(manifest));
    await writeFile(join(code, "index.ts"), `import { on } from 'chrona'; on('tool', async () => { throw new Error('installation must not call business tools'); });`);
    await writeFile(join(code, "migrate.ts"), `import { writeFileSync } from 'node:fs'; writeFileSync(process.env.CHRONA_DATA + '/state', 'migrated');`);
    await writeFile(join(code, "test.ts"), "throw new Error('application tests are not installation checks');");
    const workspace = await db.workspace.create({ data: { name: "build checks" } });
    const context = moduleContext({ db, dataDir: dir, now: () => new Date("2026-10-21T04:00:00Z"), publicUrl: null, sandbox: { ...runtime.health, runModule: runtime.runModule, startModule: runtime.startModule } }, workspace.id);
    expect(await smokeRun(context, code, manifest)).toEqual([]);
    const module = await db.module.create({ data: { workspaceId: workspace.id, name: "sdk-check", activeHash: "old", dataSchema: 1 } });
    const live = join(dir, "platform/data", module.id); await mkdir(live, { recursive: true }); await writeFile(join(live, "state"), "original");
    const continuity: ContinuityReport = { status: "skipped", fromSchema: 1, toSchema: 2, migrated: false };
    expect(await checkContinuity(context, code, module, manifest, continuity)).toEqual({ passed: true, needsMigration: true });
    expect(continuity).toMatchObject({ status: "skipped", migrated: false });
    expect(await readFile(join(live, "state"), "utf8")).toBe("original");
    expect((await notices(db)).length).toBe(0);
    expect(await db.run.count()).toBe(0);
  } finally { await db.$disconnect(); await rm(dir, { recursive: true, force: true }); }
});
