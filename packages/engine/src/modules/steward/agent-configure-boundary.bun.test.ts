import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { agentFixture } from "../../../../../scripts/agent-integration/agent-application.fixtures";
import { retainAgentCaller } from "./agent-caller-context";
import { callSync, kernelOrigin, type CallOrigin } from "./module-calls";

type Fixture = Awaited<ReturnType<typeof agentFixture>>;
const config = { tiers: { fast: { model: "fake/fast", thinking: "low" } }, "preferred-timeout-ms": 5000 };
const expected = { tiers: config.tiers, preferredTimeoutMs: 5000 };
function owner(f: Fixture): CallOrigin { return { ...kernelOrigin(f.workspaceId), caller: { kind: "owner", via: null } }; }
function agent(f: Fixture): CallOrigin { return { ...kernelOrigin(f.workspaceId), caller: { kind: "module", module: "agent", moduleId: f.module.id, hash: f.module.activeHash! } }; }
async function consumer(f: Fixture, name: string, uses: string[]): Promise<CallOrigin> {
  const hash = name + "-v1", source = join(f.ports.dataDir, "platform/store", hash);
  await mkdir(source);
  await writeFile(join(source, "index.ts"), `import {chrona,on} from 'chrona';on('tool',async t=>({result:await chrona.call({moduleId:chrona.dependencies.agent,tool:'configure'},t.args)}));`);
  const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], effects: [], uses, authority: uses.includes("*") ? "owner" : undefined,
    tools: [{ name: "configure-agent", description: "Configure Agent from the calling application", visibility: ["owner"], parameters: { type: "object", properties: {} },
        output: {}
    }] });
  const module = await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name, status: "active", activeHash: hash } });
  await f.ports.db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
  return { ...kernelOrigin(f.workspaceId), caller: { kind: "module", module: name, moduleId: module.id, hash } };
}

test("real Agent accepts direct owner configure, validates replacements and clears its private policy", async () => {
  const f = await agentFixture();
  try {
    expect((await callSync(f.ports, owner(f), "agent.configure", {})).output).toEqual({ config: null, ready: false });
    expect((await callSync(f.ports, owner(f), "agent.configure", { config })).output).toEqual({ config: expected, ready: true });
    await expect(callSync(f.ports, owner(f), "agent.configure", { config: { ...config, tiers: { fast: { model: "" } } } })).rejects.toBeTruthy();
    expect((await callSync(f.ports, owner(f), "agent.configure", {})).output).toEqual({ config: expected, ready: true });
    expect((await callSync(f.ports, owner(f), "agent.configure", { clear: true })).output).toEqual({ config: null, ready: false });
    expect(await f.ports.db.moduleCall.count({ where: { method: "model" } })).toBe(0);
  } finally { await f.close(); }
}, 30000);

test("real Agent config requires a current approved wildcard module and rejects ordinary, stale and foreign identities", async () => {
  const f = await agentFixture();
  try {
    const wildcard = await consumer(f, "config-owner", ["*"]), ordinary = await consumer(f, "config-reader", ["agent.configure"]);
    expect((await callSync(f.ports, wildcard, "agent.configure", { config })).output).toEqual({ config: expected, ready: true });
    // Exercise the same authority through an actual SDK application, without a model.
    expect((await callSync(f.ports, owner(f), "config-owner.configure-agent", {})).output).toEqual({ config: expected, ready: true });
    if (wildcard.caller.kind !== "module") throw new Error("Expected a module identity");
    const foreign = await f.ports.db.workspace.create({ data: { name: "foreign-config" } });
    const foreignCaller = await consumer({ ...f, workspaceId: foreign.id }, "foreign-owner", ["*"]);
    const version = await f.ports.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: wildcard.caller.moduleId, hash: wildcard.caller.hash } } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: version.moduleId, hash: "approved-old", manifest: version.manifest!, source: "user", status: "approved", intent: {}, report: {} } });
    const invalid: CallOrigin[] = [ordinary,
      { ...wildcard, caller: { ...wildcard.caller, hash: "approved-old" } },
      { ...wildcard, caller: { ...wildcard.caller, hash: "forged-hash" } },
      { ...wildcard, caller: { ...wildcard.caller, module: "forged-name" } },
      { ...foreignCaller, workspaceId: f.workspaceId }];
    for (const origin of invalid) await expect(callSync(f.ports, origin, "agent.configure", { clear: true })).rejects.toMatchObject({ code: "forbidden" });
    const identity = { moduleId: wildcard.caller.moduleId, hash: wildcard.caller.hash };
    await f.ports.db.moduleVersion.update({ where: { moduleId_hash: identity }, data: { status: "rejected" } });
    await expect(callSync(f.ports, wildcard, "agent.configure", { clear: true })).rejects.toMatchObject({ code: "forbidden" });
    await f.ports.db.moduleVersion.update({ where: { moduleId_hash: identity }, data: { status: "approved" } });
    await f.ports.db.module.update({ where: { id: identity.moduleId }, data: { status: "paused" } });
    await expect(callSync(f.ports, wildcard, "agent.configure", { clear: true })).rejects.toMatchObject({ code: "forbidden" });
    expect((await callSync(f.ports, owner(f), "agent.configure", {})).output).toEqual({ config: expected, ready: true });
  } finally { await f.close(); }
}, 30000);

test("Agent configure callbacks reject forgery, expired calls, cross-workspace contexts and completion authority", async () => {
  const f = await agentFixture();
  try {
    const wildcard = await consumer(f, "callback-owner", ["*"]);
    const configured = await callSync(f.ports, wildcard, "agent.configure", { config });
    const callback = (origin: CallOrigin, callId: string) => callSync(f.ports, origin, "runtime-callback.agent-admit", { callId, operation: "configure" });
    await expect(callback(wildcard, configured.callId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(callback(agent(f), "forged-call")).rejects.toMatchObject({ code: "forbidden" });
    await expect(callback(agent(f), configured.callId)).rejects.toMatchObject({ code: "forbidden" });
    const foreign = await f.ports.db.workspace.create({ data: { name: "foreign-callback" } });
    for (const [name, origin] of [["complete", wildcard], ["configure", { ...wildcard, workspaceId: foreign.id }]] as const) {
      const callId = crypto.randomUUID(), release = retainAgentCaller(f.ports, callId, origin, name, {});
      try { await expect(callback(agent(f), callId)).rejects.toMatchObject({ code: "forbidden" }); }
      finally { release(); }
    }
    const completion = { "command-key": "configure-via-complete", prompt: "fixture only", "max-output-tokens": 10 };
    await expect(callSync(f.ports, wildcard, "agent.complete", { input: JSON.stringify({ ...completion, config }) })).rejects.toMatchObject({ code: "invalid" });
    await expect(callSync(f.ports, wildcard, "agent.complete", { ...completion, config })).rejects.toMatchObject({ code: "invalid" });
    expect((await callSync(f.ports, wildcard, "agent.configure", {})).output).toEqual({ config: expected, ready: true });
    expect(await f.ports.db.moduleCall.count({ where: { method: "model" } })).toBe(0);
  } finally { await f.close(); }
}, 30000);
