import "./module-effects";
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { testDb } from "./test-db";
import { callSync } from "./module-calls";
import { moduleSupervisor } from "./module-supervisor";
import type { StewardPorts } from "./ports";
import { createExecutions } from "./execution";
import { createExecutionEventStore } from "./execution-event-store";
import { createRuns } from "./runs";
import { moduleContext } from "./module-context";
import { requestStatus } from "./module-status";
import { switchActiveIn } from "./module-generation";
import { requestRemove } from "./module-remove";

test("module pause/version/removal refuse held execution and become available after proven queued cancel", async () => {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-module-execution-");
  const ports: StewardPorts = { db, dataDir, now: () => new Date(), publicUrl: null,
    resolveExecutionProject: async (_, projectRef) => ({ projectRef, executor: "server", canonicalPath: dataDir, baseline: "snapshot:fixture" }) };
  try {
    const workspace = await db.workspace.create({ data: { name: "guard" } });
    const manifest = moduleManifestSchema.parse({ name: "example", entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], triggers: [] });
    const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example", activeHash: "v1", dataSchema: 1 } });
    for (const hash of ["v1", "v2"]) await db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest, source: "user", intent: {}, report: {}, status: "approved" } });
    ports.executionEvents = createExecutionEventStore(ports); ports.executions = createExecutions(ports);
    const principal = { workspaceId: workspace.id, ownerId: "owner", caller: { kind: "module" as const, moduleId: module.id, hash: "v1" } };
    const view = await ports.executions.start(principal, { workId: "work", projectRef: "project", commandKey: "start", goal: "fixture", budget: { timeoutMs: 1000, maxToolCalls: 1 } });
    const context = moduleContext(ports, workspace.id);
    await expect(requestStatus(context, module.id, "paused", "fixture")).rejects.toMatchObject({ code: "conflict" });
    await expect(db.$transaction(tx => switchActiveIn(context, tx, module.id, "v2"))).rejects.toMatchObject({ code: "conflict" });
    await expect(requestRemove(context, module.id, "fixture")).rejects.toMatchObject({ code: "conflict" });
    await ports.executions.cancel(principal, { ...view, op: "cancel", commandKey: "cancel" });
    expect(await createRuns(ports, workspace.id).claimNext("background")).toBeNull();
    expect(await requestStatus(context, module.id, "paused", "fixture")).toMatchObject({ status: "paused" });
  } finally { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
});

test("real SDK handler typed error crosses supervisor and routed call without message decoding", async () => {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-typed-error-");
  const runtime = createScriptSandbox({ executionMode: "trusted-local", dataDir });
  const ports: StewardPorts = { db, dataDir, now: () => new Date(), publicUrl: null, sandbox: { ...runtime.health, startModule: runtime.startModule } };
  try {
    const workspace = await db.workspace.create({ data: { name: "typed" } });
    const manifest = moduleManifestSchema.parse({ name: "typed-error", entry: "index.ts", tests: ["test.ts"], effects: [], triggers: [], tools: [{ name: "fail", description: "Fail", visibility: ["owner"], parameters: { type: "object", properties: {} } }] });
    const module = await db.module.create({ data: { workspaceId: workspace.id, name: manifest.name, activeHash: "fixture" } });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash: "fixture", manifest, source: "user", intent: {}, report: {}, status: "approved" } });
    const code = join(dataDir, "platform/store/fixture"); await mkdir(code, { recursive: true });
    await writeFile(join(code, "module.json"), JSON.stringify(manifest));
    await writeFile(join(code, "index.ts"), 'import {on,ModelError} from "chrona"; on("tool",()=>{throw new ModelError("conflict","Exact conflict");});');
    await expect(callSync(ports, { workspaceId: workspace.id, caller: { kind: "owner", via: null }, chain: [], path: [] }, "typed-error.fail", {})).rejects.toMatchObject({ code: "conflict", message: "typed-error.fail: Exact conflict" });
  } finally { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
});
