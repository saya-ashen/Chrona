import { expect, test } from "bun:test";
import { cp, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import "./module-effects";
import { seedTestModuleRelease } from "./module-release-test-fixture";
import { createExternalModuleInstaller, installExternal } from "./module-install";
import { createModules } from "./modules";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { agentFixture } from "./agent-application.fixtures";
import { selectContextTools } from "./agent-context-tools";
import { callSync, kernelOrigin } from "./module-calls";
import { MIND_AGENT_TOOLS } from "./external/mind/execution";

test("Mind's actual manifest can read Web overview and select its Agent tools without owner escalation", async () => {
  const f = await agentFixture();
  try {
    for (const [name, directory] of [["web", "builtin"], ["notify", "builtin"], ["mind", "external"]]) {
      const source = join(import.meta.dir, directory!, name!);
      const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(source, "module.json"), "utf8")));
      const hash = `mind-agent-${name}`;
      await cp(source, join(f.ports.dataDir, "platform/store", hash), { recursive: true });
      const module = await f.ports.db.module.upsert({ where: { workspaceId_name: { workspaceId: f.workspaceId, name: name! } },
        create: { workspaceId: f.workspaceId, name: name!, status: "active", activeHash: hash, builtin: directory === "builtin" }, update: { activeHash: hash } });
      await f.ports.db.moduleVersion.create({ data: { moduleId: module.id, hash, source: directory === "builtin" ? "builtin" : "user", status: "approved", manifest, intent: {}, report: {} } });
    }
    const mind = await f.ports.db.module.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId: f.workspaceId, name: "mind" } } });
    const principal = { workspaceId: f.workspaceId, ownerId: "owner", caller: { kind: "module" as const, moduleId: mind.id, hash: mind.activeHash! } };
    const tools = await selectContextTools(f.ports, principal, MIND_AGENT_TOOLS);
    expect(tools.entries.map(entry => `${entry.module.name}.${entry.tool.name}`)).toEqual(MIND_AGENT_TOOLS);
    expect(tools.caller).toMatchObject({ kind: "module", moduleId: mind.id, hash: mind.activeHash });
    await expect(selectContextTools(f.ports, principal, ["modules.propose"])).rejects.toMatchObject({ code: "not_found" });
    const overview = await callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller: tools.caller }, "web.today", {});
    expect(overview.output).toMatchObject({ approvals: [], upcoming: [], sessions: [] });
    const invocation = await f.ports.db.moduleInvocation.findFirstOrThrow({ where: { callerModuleId: mind.id, target: "web", tool: "today" } });
    expect(invocation.callerHash).toBe(mind.activeHash);
    // Generated inter-module call types must agree with the actual Web output contract.
    await f.ports.db.module.delete({ where: { id: mind.id } });
    f.ports.moduleExternalResources = join(f.ports.dataDir, "external");
    f.ports.moduleTypecheck = resolve(import.meta.dirname, "../../../../integrations/src/steward/module-typecheck");
    f.ports.moduleExternalInstaller = createExternalModuleInstaller(f.ports);
    await cp(join(import.meta.dir, "external/mind"), join(f.ports.moduleExternalResources, "mind"), { recursive: true });
    await seedTestModuleRelease(f.ports.moduleExternalResources, "mind");
    expect(await installExternal(f.ports, f.workspaceId, { package: "mind", mode: "install", requestKey: "checked" })).toMatchObject({ status: "building" });
    await createModules(f.ports, f.workspaceId).buildPending();
    const checked = await f.ports.db.moduleVersion.findFirstOrThrow({ where: { module: { name: "mind" } } });
    expect(checked.report).toMatchObject({ typecheck: { status: "passed" } });
    // Fresh installation still waits for the declared optional credential approval.
    expect(checked.status).toBe("pending_review");
  } finally { await f.close(); }
}, 60000);
