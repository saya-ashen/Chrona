import { expect, test } from "bun:test";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { agentFixture } from "../../../../../scripts/agent-integration/agent-application.fixtures";
import { callSync, kernelOrigin, type CallOrigin } from "./module-calls";

async function fixture() {
  const f = await agentFixture();
  try {
    await f.ports.db.run.update({ where: { id: f.input.runId }, data: { status: "cancelled", stopStatus: "confirmed" } });
    async function caller(name: string) {
      const module = await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name, activeHash: "caller-v1", status: "active" } });
      const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], effects: [], tools: [{ name: "noop", description: "Caller identity fixture", parameters: { type: "object", properties: {} }, output: {} }], uses: ["agent.run", "agent.read", "agent.write", "agent.stop", "agent.native"] });
      await f.ports.db.moduleVersion.create({ data: { moduleId: module.id, hash: module.activeHash!, manifest, source: "user", status: "approved", intent: {}, report: {} } });
      return { ...kernelOrigin(f.workspaceId), caller: { kind: "module" as const, module: name, moduleId: module.id, hash: module.activeHash! } };
    }
    const origin = await caller("context-owner");
    const call = async (tool: string, args: unknown, key?: string, who = origin) => (await callSync(f.ports, who, "agent." + tool, args, { key })).output as { runId: string; contextId: string };
    const input = { providerId: "pi", prompt: "Offline caller fixture" };
    const admitted = await call("run", input, "initial");
    return { ...f, origin, caller, call, input, admitted };
  } catch (error) { await f.close(); throw error; }
}

// Project registration/path policy now belongs to Coding's service tests. The
// former Agent projects tests' kernel responsibility is actual caller identity.
test("Agent authenticates current approved module identities before any Run effect", async () => {
  const f = await fixture();
  try {
    const current = f.origin, identity = { moduleId: current.caller.moduleId, hash: current.caller.hash };
    const version = await f.ports.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: identity } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: identity.moduleId, hash: "old-approved", manifest: version.manifest!, source: "user", status: "approved", intent: {}, report: {} } });
    const foreignWorkspace = await f.ports.db.workspace.create({ data: { name: "foreign-agent-caller" } });
    const foreign = await f.ports.db.module.create({ data: { workspaceId: foreignWorkspace.id, name: "foreign-agent", activeHash: "v1", status: "active" } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: foreign.id, hash: "v1", manifest: moduleManifestSchema.parse({ name: foreign.name, entry: "index.ts", tests: ["test.ts"], effects: [], tools: [{ name: "noop", description: "Foreign caller fixture", parameters: { type: "object", properties: {} }, output: {} }], uses: ["agent.run"] }), source: "user", status: "approved", intent: {}, report: {} } });
    const invalid: CallOrigin[] = [kernelOrigin(f.workspaceId),
      { ...kernelOrigin(f.workspaceId), caller: { kind: "owner", via: null } },
      { ...current, caller: { ...current.caller, hash: "old-approved" } },
      { ...current, caller: { ...current.caller, hash: "forged" } },
      { ...current, caller: { ...current.caller, module: "forged-name" } },
      { ...current, caller: { kind: "module", module: foreign.name, moduleId: foreign.id, hash: "v1" } }];
    const count = await f.ports.db.run.count();
    for (const origin of invalid) await expect(callSync(f.ports, origin, "agent.run", f.input, { key: crypto.randomUUID() })).rejects.toMatchObject({ code: "forbidden" });
    for (const status of ["rejected", "approved"] as const) {
      await f.ports.db.moduleVersion.update({ where: { moduleId_hash: identity }, data: { status } });
      if (status === "approved") await f.ports.db.module.update({ where: { id: identity.moduleId }, data: { status: "paused" } });
      await expect(f.call("run", f.input, "inactive")).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(await f.ports.db.run.count()).toBe(count);
    expect(await f.ports.db.providerLaunch.count()).toBe(0);
    await f.ports.db.module.update({ where: { id: identity.moduleId }, data: { status: "active" } });
    expect(await f.call("read", { runId: f.admitted.runId })).toMatchObject({ run: f.admitted });
  } finally { await f.close(); }
}, 30000);

test("Agent context, reads and mutations stay scoped to the original application and hash", async () => {
  const f = await fixture();
  try {
    const other = await f.caller("other-context-owner");
    const target = { runId: f.admitted.runId };
    for (const [tool, args] of [
      ["read", target], ["stop", target],
      ["write", { ...target, input: { kind: "message", text: "steal" } }],
      ["native", { ...target, request: { type: "get_state" } }],
      ["run", { ...f.input, contextId: f.admitted.contextId }],
    ] as const) await expect(f.call(tool, args, "foreign-" + tool, other)).rejects.toMatchObject({ code: "not_found" });
    expect(await f.call("stop", target, "owner-stop")).toMatchObject({ status: "cancelled", stopConfirmed: true });
    expect(await f.call("run", { ...f.input, contextId: f.admitted.contextId }, "continue")).toMatchObject({ contextId: f.admitted.contextId, status: "queued" });
    const identity = { moduleId: f.origin.caller.moduleId, hash: f.origin.caller.hash };
    const version = await f.ports.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: identity } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: identity.moduleId, hash: "caller-v2", manifest: version.manifest!, source: "user", status: "approved", intent: {}, report: {} } });
    await f.ports.db.module.update({ where: { id: identity.moduleId }, data: { activeHash: "caller-v2" } });
    const updated = { ...f.origin, caller: { ...f.origin.caller, hash: "caller-v2" } };
    await expect(f.call("read", target, undefined, updated)).rejects.toMatchObject({ code: "not_found" });
    await expect(f.call("run", { ...f.input, contextId: f.admitted.contextId }, "updated-context", updated)).rejects.toMatchObject({ code: "not_found" });
    expect(await f.ports.db.run.count({ where: { sessionId: f.admitted.contextId } })).toBe(2);
    expect(await f.ports.db.providerLaunch.count()).toBe(0);
  } finally { await f.close(); }
}, 30000);
