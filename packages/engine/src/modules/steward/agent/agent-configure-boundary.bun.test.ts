import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { agentFixture } from "../../../../../../scripts/agent-integration/agent-application.fixtures";
import { callSync, kernelOrigin, type CallOrigin } from "../modules/module-calls";
import { createRuns } from "../execution/runs";
import { startLocalProvider } from "../execution/local-runtime";

type Fixture = Awaited<ReturnType<typeof agentFixture>>;
function owner(f: Fixture): CallOrigin { return { ...kernelOrigin(f.workspaceId), caller: { kind: "owner", via: null } }; }
async function consumer(f: Fixture, name: string, uses = ["agent.run", "agent.read", "agent.stop"]) {
  const hash = name + "-v1", source = join(f.ports.dataDir, "platform/store", hash);
  await mkdir(source);
  await writeFile(join(source, "index.ts"), `import {chrona,on} from 'chrona';on('tool',async t=>({result:await chrona.call({moduleId:chrona.dependencies.pi,tool:'configure'},t.args)}));`);
  const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], effects: [], uses, authority: uses.includes("*") ? "owner" : undefined,
    tools: [{ name: "configure-pi", description: "Configure the provider", visibility: ["owner"], parameters: { type: "object", properties: {} }, output: {} }] });
  const module = await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name, status: "active", activeHash: hash } });
  await f.ports.db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
  return { ...kernelOrigin(f.workspaceId), caller: { kind: "module" as const, module: name, moduleId: module.id, hash } };
}

test("ordinary Pi settings validate replacement, clear overrides and re-register configuration revisions", async () => {
  const f = await agentFixture();
  try {
    const configure = async (args: unknown) => (await callSync(f.ports, owner(f), "pi.configure", args)).output as { config: unknown; revision: string; effective: unknown };
    const initial = await configure({});
    expect(initial).toMatchObject({ config: {}, effective: { profile: join(f.root, "profile"), profileSource: "host.agentDir" } });
    const config = { model: "fake/fast", thinking: "low" };
    const configured = await configure({ config });
    expect(configured).toMatchObject({ config, effective: { model: "fake/fast", modelSource: "configuration", thinking: "low" } });
    expect(configured.revision).not.toBe(initial.revision);
    await expect(configure({ config: { model: "" } })).rejects.toMatchObject({ code: "invalid" });
    expect(await configure({})).toEqual(configured);
    expect(await configure({ clear: true })).toMatchObject({ config: {}, revision: initial.revision });
    const provider = await f.ports.db.agentProvider.findUniqueOrThrow({ where: { workspaceId_id: { workspaceId: f.workspaceId, id: "pi" } } });
    expect(provider.declaration).toMatchObject({ configuration: { tool: "configure", revision: initial.revision } });
    expect(await f.ports.db.moduleCall.count({ where: { method: "model" } })).toBe(0);
    expect(await f.ports.db.providerLaunch.count()).toBe(0);
  } finally { await f.close(); }
}, 30000);

test("Pi configure uses ordinary owner authority and rejects stale, forged, foreign and inactive module callers", async () => {
  const f = await agentFixture();
  try {
    const wildcard = await consumer(f, "config-owner", ["*"]), ordinary = await consumer(f, "config-reader", ["pi.configure"]);
    const config = { model: "fake/fast", thinking: "low" };
    expect((await callSync(f.ports, wildcard, "pi.configure", { config })).output).toMatchObject({ config });
    expect((await callSync(f.ports, owner(f), "config-owner.configure-pi", {})).output).toMatchObject({ config });
    const foreignWorkspace = await f.ports.db.workspace.create({ data: { name: "foreign-config" } });
    const foreign = await consumer({ ...f, workspaceId: foreignWorkspace.id }, "foreign-config-owner", ["*"]);
    const identity = { moduleId: wildcard.caller.moduleId, hash: wildcard.caller.hash };
    const version = await f.ports.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: identity } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: identity.moduleId, hash: "approved-old", manifest: version.manifest!, source: "user", status: "approved", intent: {}, report: {} } });
    for (const origin of [ordinary,
      { ...wildcard, caller: { ...wildcard.caller, hash: "approved-old" } },
      { ...wildcard, caller: { ...wildcard.caller, hash: "forged" } },
      { ...wildcard, caller: { ...wildcard.caller, module: "forged-name" } },
      { ...foreign, workspaceId: f.workspaceId }]) {
      await expect(callSync(f.ports, origin, "pi.configure", { clear: true })).rejects.toMatchObject({ code: "forbidden" });
    }
    await f.ports.db.moduleVersion.update({ where: { moduleId_hash: identity }, data: { status: "rejected" } });
    await expect(callSync(f.ports, wildcard, "pi.configure", { clear: true })).rejects.toMatchObject({ code: "forbidden" });
    await f.ports.db.moduleVersion.update({ where: { moduleId_hash: identity }, data: { status: "approved" } });
    await f.ports.db.module.update({ where: { id: identity.moduleId }, data: { status: "paused" } });
    await expect(callSync(f.ports, wildcard, "pi.configure", { clear: true })).rejects.toMatchObject({ code: "forbidden" });
    expect((await callSync(f.ports, owner(f), "pi.configure", {})).output).toMatchObject({ config });
  } finally { await f.close(); }
}, 30000);

test("queued launches and context continuations retain the admitted configuration and selected profile", async () => {
  const f = await agentFixture();
  try {
    await f.ports.db.run.update({ where: { id: f.input.runId }, data: { status: "cancelled", stopStatus: "confirmed" } });
    const caller = await consumer(f, "snapshot-consumer");
    const call = async (tool: string, args: unknown, key: string) => (await callSync(f.ports, caller, "agent." + tool, args, { key })).output as { runId: string; contextId: string };
    const oldProfile = join(f.root, "old-profile"), newProfile = join(f.root, "new-profile");
    await mkdir(oldProfile); await mkdir(newProfile);
    const configure = async (profile: string, model: string) => (await callSync(f.ports, owner(f), "pi.configure", { config: { profile, model, thinking: "low" } })).output as { revision: string };
    const old = await configure(oldProfile, "fake/old");
    const request = { providerId: "pi", prompt: "Offline pinned settings", lane: "background" };
    for (const forged of [{ configurationRevision: "forged" }, { config: { profile: newProfile, model: "fake/forged" } }]) {
      await expect(call("run", { ...request, ...forged }, "forged-configuration")).rejects.toMatchObject({ code: "invalid" });
    }
    const admitted = await call("run", request, "old");
    const changed = await configure(newProfile, "fake/new");
    expect(changed.revision).not.toBe(old.revision);
    const binding = await f.ports.db.agentRunProvider.findUniqueOrThrow({ where: { runId: admitted.runId } });
    expect(binding.declaration).toMatchObject({ configuration: { revision: old.revision } });
    const runs = createRuns(f.ports, f.workspaceId), run = (await runs.claimNext("background"))!;
    expect(run.id).toBe(admitted.runId);
    const raw: unknown[] = [];
    const handle = await startLocalProvider(f.ports, f.workspaceId, { ...f.input, runId: run.id, token: run.token, lane: "background", cwd: run.cwd, deadline: run.deadlineAt,
      events: { async progress() {}, async usage() {}, async resources() {}, async question() { return { decision: "cancel" }; }, async raw(value) { raw.push(value); } } });
    expect(raw).toContainEqual(expect.objectContaining({ type: "chrona_configuration", configurationRevision: old.revision, effective: expect.objectContaining({ profile: oldProfile, model: "fake/old", thinking: "low" }) }));
    await handle.abort(); await runs.finish(run.id, await handle.done, { stopEvidence: "provider_exited" });
    const continued = await call("run", { ...request, contextId: admitted.contextId }, "continued");
    const fresh = await call("run", request, "fresh");
    expect((await f.ports.db.agentRunProvider.findUniqueOrThrow({ where: { runId: continued.runId } })).revision).toBe(binding.revision);
    expect((await f.ports.db.agentRunProvider.findUniqueOrThrow({ where: { runId: fresh.runId } })).declaration).toMatchObject({ configuration: { revision: changed.revision } });
    expect(fresh.contextId).not.toBe(admitted.contextId);
  } finally { await f.close(); }
}, 30000);
