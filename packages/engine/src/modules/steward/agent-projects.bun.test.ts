import { expect, test } from "bun:test";
import { mkdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema, type ExecutionPrincipal, projectsOutput } from "@chrona/contracts/steward";
import { createExecutionProjectRegistry } from "../../../../../apps/server/src/config/execution-project-registry";
import { agentFixture } from "../../../../../scripts/agent-integration/agent-application.fixtures";
import { retainAgentCaller } from "./agent-caller-context";
import { callSync, kernelOrigin, type CallOrigin } from "./module-calls";

type Fixture = Awaited<ReturnType<typeof agentFixture>>;
function owner(f: Fixture): CallOrigin { return { ...kernelOrigin(f.workspaceId), caller: { kind: "owner", via: null } }; }
function agent(f: Fixture): CallOrigin { return { ...kernelOrigin(f.workspaceId), caller: { kind: "module", module: "agent", moduleId: f.module.id, hash: f.module.activeHash! } }; }
async function consumer(f: Fixture, name: string, uses = ["*"]): Promise<CallOrigin> {
  const hash = name + "-v1", source = join(f.ports.dataDir, "platform/store", hash);
  await mkdir(source);
  await writeFile(join(source, "index.ts"), `import {chrona,on} from 'chrona';on('tool',async t=>({result:await chrona.call({moduleId:chrona.dependencies.agent,tool:'work-projects'},JSON.parse(t.args.request))}));`);
  const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], effects: [], uses, authority: uses.includes("*") ? "owner" : undefined,
    tools: [{ name: "projects", description: "Project fixture", visibility: ["owner"], parameters: { type: "object", properties: { request: { type: "string" } }, required: ["request"] },
        output: {}
    }] });
  const module = await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name, status: "active", activeHash: hash } });
  await f.ports.db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
  return { ...kernelOrigin(f.workspaceId), caller: { kind: "module", module: name, moduleId: module.id, hash } };
}
function callback(f: Fixture, origin: CallOrigin, callId: string, operation = "projects", extra = {}) {
  return callSync(f.ports, origin, "runtime-callback.agent-admit", { callId, operation, ...extra });
}

test("real SDK Coding owner application uses Agent projects with its original principal and host directory checks", async () => {
  const f = await agentFixture();
  try {
    const origin = await consumer(f, "coding");
    if (origin.caller.kind !== "module") throw new Error("Expected module caller");
    const principal = { workspaceId: f.workspaceId, ownerId: "owner", caller: { kind: "module", moduleId: origin.caller.moduleId, hash: origin.caller.hash } } as const satisfies ExecutionPrincipal;
    const host = createExecutionProjectRegistry(f.ports.dataDir), seen: ExecutionPrincipal[] = [];
    f.ports.executionProjects = {
      list(p) { seen.push(p); return host.list(p); },
      register(p, path) { seen.push(p); return host.register(p, path); },
      create(p, name) { seen.push(p); return host.create(p, name); },
    };
    const relay = async (request: Record<string, unknown>) => projectsOutput.parse((await callSync(f.ports, owner(f), "coding.projects", { request: JSON.stringify(request) })).output);
    expect(await relay({ action: "list" })).toEqual({ action: "list", principal, projects: [] });
    const directory = join(f.root, "project"), alias = join(f.root, "alias");
    await mkdir(directory); await symlink(directory, alias);
    const registered = await relay({ action: "register", path: alias });
    if (registered.action !== "register") throw new Error("Expected registration");
    expect(registered.principal).toEqual(principal);
    expect(registered.project).toMatchObject({ path: directory, label: "project" });
    expect(await relay({ action: "register", path: directory })).toEqual(registered);
    const created = await relay({ action: "create", name: "scratch" });
    if (created.action !== "create") throw new Error("Expected creation");
    expect(created.principal).toEqual(principal);
    expect(await relay({ action: "create", name: "scratch" })).toEqual(created);
    expect(await relay({ action: "list" })).toEqual({ action: "list", principal, projects: [registered.project, created.project] });
    expect(seen.every(value => JSON.stringify(value) === JSON.stringify(principal))).toBe(true);
    expect(await host.resolve(principal, registered.project.projectRef)).toMatchObject({ canonicalPath: directory });
    expect(await host.resolve({ ...principal, caller: { kind: "owner" } }, registered.project.projectRef)).toBeNull();
    expect(await host.resolve({ ...principal, caller: { kind: "module", moduleId: "another-app", hash: "v1" } }, registered.project.projectRef)).toBeNull();
    const calls = seen.length;
    for (const args of [{}, { action: "delete" }, { action: "register" }, { action: "create" },
      { action: "list", path: directory }, { action: "register", path: directory, name: "extra" }, { action: "create", name: "scratch", path: directory },
      { action: "list", moduleId: origin.caller.moduleId }, { action: "list", principal }, { action: "list", input: "{}" }, { action: "list", callId: "forged" },
      { action: "register", path: "x".repeat(8193) }, { action: "create", name: "x".repeat(65) }]) {
      await expect(callSync(f.ports, origin, "agent.work-projects", args)).rejects.toMatchObject({ code: "invalid" });
    }
    expect(seen.length).toBe(calls);
    await expect(callSync(f.ports, origin, "agent.work-projects", { action: "create", name: "../escape" })).rejects.toMatchObject({ code: "invalid" });
    await expect(callSync(f.ports, origin, "agent.work-projects", { action: "register", path: "relative" })).rejects.toMatchObject({ code: "invalid" });
    await rename(directory, directory + "-old"); await mkdir(directory);
    await expect(callSync(f.ports, origin, "agent.work-projects", { action: "register", path: directory })).rejects.toMatchObject({ code: "conflict" });
    await expect(host.resolve(principal, registered.project.projectRef)).rejects.toMatchObject({ code: "conflict" });
    const completed = await callSync(f.ports, origin, "agent.work-projects", { action: "list" });
    await expect(callback(f, agent(f), completed.callId)).rejects.toMatchObject({ code: "forbidden" });
    expect(await f.ports.db.moduleCall.count({ where: { method: "model" } })).toBe(0);
  } finally { await f.close(); }
}, 30000);

test("Agent projects denies non-owner, unapproved, stale, forged and foreign original module identities", async () => {
  const f = await agentFixture();
  try {
    const current = await consumer(f, "project-current"), ordinary = await consumer(f, "project-ordinary", ["agent.work-projects"]);
    if (current.caller.kind !== "module") throw new Error("Expected module caller");
    const identity = { moduleId: current.caller.moduleId, hash: current.caller.hash };
    let effects = 0;
    f.ports.executionProjects = { async list() { effects++; return { projects: [] }; }, async register() { effects++; throw new Error("Unexpected host effect"); }, async create() { effects++; throw new Error("Unexpected host effect"); } };
    const foreign = await f.ports.db.workspace.create({ data: { name: "foreign-projects" } });
    const foreignOrigin = await consumer({ ...f, workspaceId: foreign.id }, "project-foreign");
    const version = await f.ports.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: identity } });
    await f.ports.db.moduleVersion.create({ data: { ...identity, hash: "old-approved", manifest: version.manifest!, source: "user", status: "approved", intent: {}, report: {} } });
    const invalid: CallOrigin[] = [ordinary, owner(f), kernelOrigin(f.workspaceId),
      { ...current, caller: { ...current.caller, module: "forged-name" } },
      { ...current, caller: { ...current.caller, moduleId: "forged-id" } },
      { ...current, caller: { ...current.caller, hash: "forged-hash" } },
      { ...current, caller: { ...current.caller, hash: "old-approved" } },
      { ...foreignOrigin, workspaceId: f.workspaceId },
      { ...current, caller: { kind: "provider", runId: "forged" } }];
    for (const origin of invalid) {
      await expect(callSync(f.ports, origin, "agent.work-projects", { action: "list" })).rejects.toMatchObject({ code: "forbidden" });
      const callId = crypto.randomUUID(), release = retainAgentCaller(f.ports, callId, origin, "projects", { action: "create", name: "denied" });
      try { await expect(callback(f, agent(f), callId)).rejects.toMatchObject({ code: "forbidden" }); }
      finally { release(); }
    }
    // Identity can be revoked while the original call is live; admission rechecks it.
    const callId = crypto.randomUUID(), release = retainAgentCaller(f.ports, callId, current, "projects", { action: "list" });
    try {
      await f.ports.db.moduleVersion.update({ where: { moduleId_hash: identity }, data: { status: "rejected" } });
      await expect(callback(f, agent(f), callId)).rejects.toMatchObject({ code: "forbidden" });
      await expect(callSync(f.ports, current, "agent.work-projects", { action: "list" })).rejects.toMatchObject({ code: "forbidden" });
      await f.ports.db.moduleVersion.update({ where: { moduleId_hash: identity }, data: { status: "approved", manifest: { ...version.manifest as object, authority: undefined, uses: ["agent.work-projects"] } } });
      await expect(callback(f, agent(f), callId)).rejects.toMatchObject({ code: "forbidden" });
      await f.ports.db.moduleVersion.update({ where: { moduleId_hash: identity }, data: { manifest: version.manifest! } });
      await f.ports.db.module.update({ where: { id: identity.moduleId }, data: { status: "paused" } });
      await expect(callback(f, agent(f), callId)).rejects.toMatchObject({ code: "forbidden" });
      await f.ports.db.module.update({ where: { id: identity.moduleId }, data: { status: "active", activeHash: "replacement" } });
      await expect(callback(f, agent(f), callId)).rejects.toMatchObject({ code: "forbidden" });
      await f.ports.db.module.update({ where: { id: identity.moduleId }, data: { activeHash: identity.hash } });
      expect(effects).toBe(0);
      expect((await callback(f, agent(f), callId)).output).toMatchObject({ action: "list", principal: { caller: { kind: "module", ...identity } }, projects: [] });
      expect(effects).toBe(1);
    } finally { release(); }
  } finally { await f.close(); }
}, 30000);

test("project admission binds the trusted current Agent, live operation, workspace and original arguments", async () => {
  const f = await agentFixture();
  try {
    const original = await consumer(f, "project-bound"), trusted = agent(f);
    let received: unknown;
    f.ports.executionProjects = { async list() { throw new Error("Unexpected list"); }, async create() { throw new Error("Unexpected create"); }, async register(principal, path) { received = { principal, path }; return { projectRef: "bound-ref", path, label: "bound" }; } };
    const callId = crypto.randomUUID(), release = retainAgentCaller(f.ports, callId, original, "projects", { action: "register", path: "/original/path" });
    try {
      for (const origin of [original, owner(f), { ...trusted, caller: { kind: "module" as const, module: "agent", moduleId: f.module.id, hash: "stale-agent" } }]) {
        await expect(callback(f, origin, callId)).rejects.toMatchObject({ code: "forbidden" });
      }
      await expect(callback(f, trusted, "forged-call")).rejects.toMatchObject({ code: "forbidden" });
      await expect(callback(f, trusted, callId, "configure")).rejects.toMatchObject({ code: "forbidden" });
      await expect(callback(f, trusted, callId, "projects", { path: "/forged/path" })).rejects.toMatchObject({ code: "invalid" });
      await expect(callback(f, trusted, callId, "projects", { settle: true })).rejects.toMatchObject({ code: "invalid" });
      await expect(callback(f, trusted, callId, "projects", { execution: {} })).rejects.toMatchObject({ code: "invalid" });
      const foreign = await f.ports.db.workspace.create({ data: { name: "foreign-bound" } });
      const otherId = crypto.randomUUID(), unbind = retainAgentCaller(f.ports, otherId, { ...original, workspaceId: foreign.id }, "projects", { action: "list" });
      try { await expect(callback(f, trusted, otherId)).rejects.toMatchObject({ code: "forbidden" }); }
      finally { unbind(); }
      const identity = { moduleId: f.module.id, hash: f.module.activeHash! };
      await f.ports.db.moduleVersion.update({ where: { moduleId_hash: identity }, data: { source: "user" } });
      await expect(callback(f, trusted, callId)).rejects.toMatchObject({ code: "forbidden" });
      await f.ports.db.moduleVersion.update({ where: { moduleId_hash: identity }, data: { source: "builtin", status: "rejected" } });
      await expect(callback(f, trusted, callId)).rejects.toMatchObject({ code: "forbidden" });
      await f.ports.db.moduleVersion.update({ where: { moduleId_hash: identity }, data: { status: "approved" } });
      expect(received).toBeUndefined();
      const result = (await callback(f, trusted, callId)).output;
      expect(result).toMatchObject({ action: "register", project: { path: "/original/path" } });
      expect(received).toEqual({ principal: { workspaceId: f.workspaceId, ownerId: "owner", caller: original.caller.kind === "module" ? { kind: "module", moduleId: original.caller.moduleId, hash: original.caller.hash } : null }, path: "/original/path" });
    } finally { release(); }
    await expect(callback(f, trusted, callId)).rejects.toMatchObject({ code: "forbidden" });
    f.ports.executionProjects = undefined;
    await expect(callSync(f.ports, original, "agent.work-projects", { action: "list" })).rejects.toMatchObject({ code: "unavailable" });
  } finally { await f.close(); }
}, 30000);
