import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { callContextTool, contextRunTools, selectContextTools } from "./agent-context-tools";
import { admitContextPrimitive } from "./agent-context";
import { createRuns } from "./runs";
import { createTools } from "./tools";
import { callSync, kernelOrigin } from "./module-calls";
import { moduleSupervisor } from "./module-supervisor";
import { registerLocalRuntime } from "./local-runtime";
import { registerSystemModules } from "./system-modules";
import { testDb } from "./test-db";
import { REASONING_TOOLS } from "./external/mind/runtime";
import type { StewardPorts } from "./ports";
import "./module-effects";

// Real context admission, Run claim and SDK process; no Provider or model is started.
test("Mind Agent context reads the actual app as its original module principal", async () => {
  const db = testDb({ injectedAgent: false });
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const database = databases.find(item => item.name === "main")?.file;
  if (!database || !resolve(database).startsWith(join(resolve(tmpdir()), "chrona-steward-test-"))) {
    await db.$disconnect();
    throw new Error("Mind context regression requires its own temporary SQLite database");
  }
  const root = await mkdtemp(join(tmpdir(), "chrona-mind-context-"));
  const sdk = resolve(import.meta.dir, "../../../../integrations/src/steward/module-sdk");
  const sandbox = createScriptSandbox({ executionMode: "trusted-local", dataDir: root, moduleSdk: sdk });
  const ports: StewardPorts = { db, dataDir: root, publicUrl: null, now: () => new Date(), moduleSdk: sdk, sandbox: { ...sandbox.health, startModule: sandbox.startModule } };
  registerSystemModules(); registerLocalRuntime();
  try {
    await symlink(resolve(import.meta.dir, "../../../../../node_modules"), join(root, "node_modules"), "dir");
    const workspaceId = (await db.workspace.create({ data: { name: "Mind Agent context" } })).id;
    const hash = "mind-context-source", source = join(import.meta.dir, "external/mind"), code = join(root, "platform/store", hash);
    await cp(source, code, { recursive: true });
    const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(code, "module.json"), "utf8")));
    const mind = await db.module.create({ data: { workspaceId, name: "mind", status: "active", activeHash: hash, builtin: false } });
    await db.moduleVersion.create({ data: { moduleId: mind.id, hash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
    const principal = { workspaceId, ownerId: "owner", caller: { kind: "module" as const, moduleId: mind.id, hash } };
    const admitted = await admitContextPrimitive(ports, principal, "context", { requestKey: "context" }) as { contextId: string };
    const queued = await admitContextPrimitive(ports, principal, "run", { requestKey: "run", contextId: admitted.contextId, lane: "background", prompt: "Read Mind", tools: REASONING_TOOLS, content: [] }) as { runId: string };
    const run = await createRuns(ports, workspaceId).claimNext("background");
    expect(run?.id).toBe(queued.runId);
    const context = (await contextRunTools(ports, run!))!;
    const tools = createTools(ports);
    expect(context.caller).toEqual({ ...principal.caller, module: "mind" });
    expect(context.entries.map(entry => `${entry.module.name}.${entry.tool.name}`)).toEqual(REASONING_TOOLS);
    expect(REASONING_TOOLS).toEqual(["mind.agenda", "mind.propose", "mind.report"]);
    await expect(selectContextTools(ports, { ...principal, caller: { kind: "owner" } }, ["mind.agenda"])).rejects.toMatchObject({ code: "forbidden" });
    await expect(selectContextTools(ports, principal, ["mind.note"])).rejects.toMatchObject({ code: "forbidden" });

    const note = await callSync(ports, { ...kernelOrigin(workspaceId), caller: { kind: "owner", via: null } }, "mind.note", { "request-key": "owner-note", title: "Check the application response" });
    expect(note.output).toMatchObject({ concern: { title: "Check the application response" } });
    const result = await tools.call(run!.token, "m_mind_agenda", {});
    expect(result).toMatchObject({ result: { concerns: [{ title: "Check the application response" }] } });
    expect(await tools.call(run!.token, "m_mind_propose", { "request-key": "context-proposal", title: "Review evidence", reason: "Context caller identity" })).toMatchObject({ result: { proposal: { source: "mind", moduleId: mind.id, status: "pending" } } });
    const unrelated = await db.module.create({ data: { workspaceId, name: "unrelated", status: "active", activeHash: "unrelated-v1" } });
    const unrelatedManifest = moduleManifestSchema.parse({ name: unrelated.name, entry: "index.ts", tests: ["test.ts"], effects: [], uses: ["mind.agenda"], tools: [{ name: "observe", description: "Fixture interface", visibility: ["modules"], parameters: { type: "object", properties: {} },
        output: {}
    }] });
    await db.moduleVersion.create({ data: { moduleId: unrelated.id, hash: unrelated.activeHash!, manifest: unrelatedManifest, source: "user", status: "approved", intent: {}, report: {} } });
    const unrelatedPrincipal = { workspaceId, ownerId: "owner", caller: { kind: "module" as const, moduleId: unrelated.id, hash: unrelated.activeHash! } };
    await expect(callSync(ports, { ...kernelOrigin(workspaceId), caller: { ...unrelatedPrincipal.caller, module: unrelated.name } }, "mind.agenda", {})).rejects.toMatchObject({ code: "forbidden" });
    const otherContext = await admitContextPrimitive(ports, unrelatedPrincipal, "context", { requestKey: "other-context" }) as { contextId: string };
    await admitContextPrimitive(ports, unrelatedPrincipal, "run", { requestKey: "other-run", contextId: otherContext.contextId, lane: "foreground", prompt: "Unrelated caller", tools: ["mind.agenda"], content: [] });
    const otherRun = (await createRuns(ports, workspaceId).claimNext("foreground"))!;
    await expect(tools.call(otherRun.token, "m_mind_agenda", {})).rejects.toMatchObject({ code: "forbidden" });
    await expect(callContextTool(ports, context, "m_mind_note", { "request-key": "unselected", title: "Not selected" }, { deadline: Date.now() + 15_000 })).rejects.toMatchObject({ code: "forbidden" });
    // The originating module cannot acquire owner mutation rights through its context.
    await expect(callSync(ports, { ...kernelOrigin(workspaceId), caller: context.caller }, "mind.note", { "request-key": "module-note", title: "Not owner" })).rejects.toMatchObject({ code: "forbidden" });
    const invocation = await db.moduleInvocation.findFirstOrThrow({ where: { callerModuleId: mind.id, target: "mind", tool: "agenda" } });
    expect(invocation).toMatchObject({ caller: `module:${mind.id}`, callerModuleId: mind.id, callerHash: hash, status: "succeeded", chain: [] });
    // Merely attaching a real Run ID to a normal origin must not change synchronous routing.
    await expect(callSync(ports, { ...kernelOrigin(workspaceId), caller: context.caller, run: { executionRunId: run!.id } }, "mind.agenda", {})).rejects.toMatchObject({ code: "cycle" });
    expect(await db.run.count()).toBe(2);
  } finally {
    await moduleSupervisor(ports).stop();
    await db.$disconnect();
    await rm(root, { recursive: true, force: true });
    await rm(dirname(database), { recursive: true, force: true });
  }
}, 30_000);
