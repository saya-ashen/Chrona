import { installTestModuleVersion } from "../__testing__/module-release-test-fixture";
import "../modules/module-effects";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../host/src/runtime/script-sandbox";
import { testDb } from "../__testing__/test-db";
import { callSync } from "../modules/module-calls";
import { moduleSupervisor } from "../modules/module-supervisor";
import type { StewardPorts } from "../ports";

test("real SDK handler typed error crosses supervisor and routed call without message decoding", async () => {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-typed-error-");
  const runtime = createScriptSandbox({ executionMode: "trusted-local", dataDir });
  const ports: StewardPorts = { db, dataDir, now: () => new Date(), publicUrl: null, sandbox: { ...runtime.health, startModule: runtime.startModule } };
  try {
    const workspace = await db.workspace.create({ data: { name: "typed" } });
    const manifest = moduleManifestSchema.parse({ name: "typed-error", entry: "index.ts", tests: ["test.ts"], effects: [], tools: [{ name: "fail", description: "Fail", visibility: ["owner"], parameters: { type: "object", properties: {} },
        output: {}
    }] });
    const module = await db.module.create({ data: { workspaceId: workspace.id, name: manifest.name, activeHash: "fixture" } });
    await installTestModuleVersion(ports, module, manifest, "typed-error", 'import {on,ModelError} from "chrona"; on("tool",()=>{throw new ModelError("conflict","Exact conflict");});');
    await expect(callSync(ports, { workspaceId: workspace.id, caller: { kind: "owner", via: null }, chain: [], path: [] }, "typed-error.fail", {})).rejects.toMatchObject({ code: "conflict", message: "typed-error.fail: Exact conflict" });
  } finally { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
});
