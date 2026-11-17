import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import { moduleContext } from "./module-context";
import { requestRemove, removeApproved } from "./module-remove";
import { moduleSupervisor } from "./module-supervisor";
import { storeTestModuleMaterial } from "../__testing__/module-release-test-fixture";
import { testDb } from "../__testing__/test-db";
import type { StewardPorts } from "../ports";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });
async function fixture(name = "pi", entry = false) {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-remove-");
  const workspace = await db.workspace.create({ data: { name: "remove" } });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date("2026-11-05T12:00:00Z") };
  closes.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name, activeHash: null } });
  const manifest = moduleManifestSchema.parse({ name: module.name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [], ...(entry ? { uses: ["*"],
      authority: "owner"
} : {}) });
  const hash = await storeTestModuleMaterial(join(dataDir, "platform"), manifest);
  module.activeHash = hash;
  await db.module.update({ where: { id: module.id }, data: { activeHash: hash } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
  const context = moduleContext(ports, workspace.id);
  const data = join(context.platform, "data", module.id);
  await mkdir(data, { recursive: true }); await writeFile(join(data, "keep.txt"), "valuable");
  async function approved() {
    const request = await requestRemove(context, module.id, "remove unused app");
    const row = await db.approval.update({ where: { id: request.approvalId }, data: { status: "approved" } });
    return { workspaceId: workspace.id, approvalId: row.id, payload: row.payload! };
  }
  return { db, workspace, module, manifest, ports, context, data, approved };
}

test.each(["dependency", "unknown-call", "unhandled-reply", "unknown-effect"])("removal rejects %s without deleting data or creating an approval", async kind => {
  const f = await fixture();
  if (kind === "dependency") {
    const other = await f.db.module.create({ data: { workspaceId: f.workspace.id, name: "consumer", activeHash: "consumer" } });
    await f.db.moduleVersion.create({ data: { moduleId: other.id, hash: "consumer", manifest: { ...f.manifest, name: "consumer", uses: [`${f.module.name}.read`] }, source: "user", status: "approved", intent: {}, report: {} } });
  }
  if (kind === "unknown-call" || kind === "unhandled-reply") await f.db.moduleInvocation.create({ data: { workspaceId: f.workspace.id, caller: `module:${f.module.id}`, callerModuleId: f.module.id, target: "other", tool: "read", args: {}, key: "once", mode: "async", status: kind === "unknown-call" ? "unknown" : "succeeded", reply: kind === "unhandled-reply" } });
  if (kind === "unknown-effect") await f.db.moduleCall.create({ data: { moduleId: f.module.id, hash: f.module.activeHash!, method: "exec", key: "once", status: "failed", error: "unknown" } });
  await expect(requestRemove(f.context, f.module.id, "remove")).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.approval.count()).toBe(0);
  expect(await readFile(join(f.data, "keep.txt"), "utf8")).toBe("valuable");
  expect(await f.db.module.findUnique({ where: { id: f.module.id } })).not.toBeNull();
});

test.each(["pi", "web", "notify", "other-entry", "files", "events"])("ordinary entry %s can be removed after approval with a data backup", async name => {
  const f = await fixture(name, true);
  const timer = await f.db.timer.create({ data: { workspaceId: f.workspace.id, moduleId: f.module.id, timerId: "retained timer", rule: { kind: "every", minutes: 60 }, status: "active", nextAt: f.ports.now() } });
  const action = await f.approved();
  expect(await f.db.timer.findUniqueOrThrow({ where: { id: timer.id } })).toMatchObject({ status: "active" });
  await removeApproved(f.context, action);
  expect(await f.db.timer.findUnique({ where: { id: timer.id } })).toBeNull();
  expect(await f.db.module.findUnique({ where: { id: f.module.id } })).toBeNull();
  expect(await f.db.moduleRemoval.findUniqueOrThrow({ where: { moduleId: f.module.id } })).toMatchObject({ workspaceId: f.workspace.id, name: f.module.name, hash: f.module.activeHash });
  const removal = await f.db.audit.findFirstOrThrow({ where: { kind: "module_removed", subjectId: f.module.id } });
  expect(await readFile(join((removal.details as { backup: string }).backup, "material/module.json"), "utf8")).toBe(JSON.stringify(f.manifest));
  expect(await readFile(join((removal.details as { backup: string }).backup, "data/keep.txt"), "utf8")).toBe("valuable");
});

test("official MCP entry can be removed only after the explicit data deletion approval", async () => {
  const f = await fixture("mcp", true);
  const request = await requestRemove(f.context, f.module.id, "remove MCP");
  const approval = await f.db.approval.findUniqueOrThrow({ where: { id: request.approvalId } });
  expect(approval).toMatchObject({ action: "delete_data", status: "open", moduleId: null, payload: { kind: "module_remove", moduleId: f.module.id, name: "mcp" } });
  await expect(removeApproved(f.context, { workspaceId: f.workspace.id, approvalId: approval.id, payload: approval.payload! })).rejects.toMatchObject({ code: "conflict" });
  expect(await readFile(join(f.data, "keep.txt"), "utf8")).toBe("valuable");
  await f.db.approval.update({ where: { id: approval.id }, data: { status: "approved" } });
  await removeApproved(f.context, { workspaceId: f.workspace.id, approvalId: approval.id, payload: approval.payload! });
  expect(await f.db.module.findUnique({ where: { id: f.module.id } })).toBeNull();
  const audit = await f.db.audit.findFirstOrThrow({ where: { kind: "module_removed", subjectId: f.module.id } });
  expect(await readFile(join((audit.details as { backup: string }).backup, "data/keep.txt"), "utf8")).toBe("valuable");
});

test.each(["unknown", "dependency"])("MCP removal rechecks %s after approval", async kind => {
  const f = await fixture("mcp", true), action = await f.approved();
  if (kind === "unknown") await f.db.moduleInvocation.create({ data: { workspaceId: f.workspace.id, caller: "owner", target: "mcp", tool: "read", args: {}, key: "unknown", mode: "sync", status: "unknown" } });
  else {
    const other = await f.db.module.create({ data: { workspaceId: f.workspace.id, name: "consumer", activeHash: "consumer" } });
    await f.db.moduleVersion.create({ data: { moduleId: other.id, hash: "consumer", manifest: { ...f.manifest, name: "consumer", uses: ["mcp.read"] }, source: "user", status: "approved", intent: {}, report: {} } });
  }
  await expect(removeApproved(f.context, action)).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ status: "active" });
  expect(await readFile(join(f.data, "keep.txt"), "utf8")).toBe("valuable");
});

test("approval restoration rechecks the approved hash and unknown results", async () => {
  const f = await fixture(), action = await f.approved();
  await f.db.module.update({ where: { id: f.module.id }, data: { activeHash: "changed" } });
  await expect(removeApproved(f.context, action)).rejects.toMatchObject({ code: "conflict" });
  expect(await readFile(join(f.data, "keep.txt"), "utf8")).toBe("valuable");
  await f.db.module.update({ where: { id: f.module.id }, data: { activeHash: f.module.activeHash! } });
  await f.db.moduleInvocation.create({ data: { workspaceId: f.workspace.id, caller: "owner", target: f.module.name, tool: "read", args: {}, key: "unknown", mode: "sync", status: "unknown" } });
  await expect(removeApproved(f.context, action)).rejects.toMatchObject({ code: "conflict" });
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).status).toBe("active");
});

test("final deletion transaction rechecks associations created during backup", async () => {
  const f = await fixture(), action = await f.approved();
  let transactions = 0;
  const db = new Proxy(f.db, { get(target, key, receiver) {
    if (key === "$transaction") return async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      if (++transactions === 2) await f.db.moduleInvocation.create({ data: { workspaceId: f.workspace.id, caller: `module:${f.module.id}`, callerModuleId: f.module.id, target: "other", tool: "read", args: {}, key: "late", mode: "async", status: "unknown" } });
      return f.db.$transaction(callback);
    };
    const value = Reflect.get(target, key, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  await expect(removeApproved({ ...f.context, db }, action)).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.module.findUnique({ where: { id: f.module.id } })).not.toBeNull();
  expect(await readFile(join(f.data, "keep.txt"), "utf8")).toBe("valuable");
});

test("ended history and completed calls do not block removal; backup preserves data", async () => {
  const f = await fixture();
  const history = await f.db.agentContext.create({ data: { workspaceId: f.workspace.id, ownerId: "owner", moduleId: f.module.id, hash: f.module.activeHash!, status: "ended" } });
  await f.db.moduleInvocation.create({ data: { workspaceId: f.workspace.id, caller: `module:${f.module.id}`, callerModuleId: f.module.id, target: "other", tool: "read", args: {}, key: "done", mode: "async", status: "succeeded", reply: true, repliedAt: f.ports.now() } });
  await removeApproved(f.context, await f.approved());
  expect(await f.db.module.findUnique({ where: { id: f.module.id } })).toBeNull();
  expect(await f.db.agentContext.findUniqueOrThrow({ where: { id: history.id } })).toMatchObject({ moduleId: null, status: "ended" });
  const removal = await f.db.audit.findFirstOrThrow({ where: { kind: "module_removed", subjectId: f.module.id } });
  expect(await readFile(join((removal.details as { backup: string }).backup, "material/module.json"), "utf8")).toBe(JSON.stringify(f.manifest));
  expect(await readFile(join((removal.details as { backup: string }).backup, "data/keep.txt"), "utf8")).toBe("valuable");
});

test.each(["pi", "web", "notify", "other-entry"])("idle Agent context permits removal of %s and retains stopped history", async name => {
  const f = await fixture(name, true);
  const context = await f.db.agentContext.create({ data: { workspaceId: f.workspace.id, ownerId: "owner", moduleId: f.module.id, hash: f.module.activeHash! } });
  const run = await f.db.run.create({ data: { workspaceId: f.workspace.id, sessionId: context.id, lane: "foreground", trigger: "module", status: "finished", stopStatus: "confirmed", endedAt: f.ports.now(), provider: "fake", tokenHash: "stopped", prompt: "work", cwd: f.ports.dataDir } });
  await removeApproved(f.context, await f.approved());
  expect(await f.db.agentContext.findUniqueOrThrow({ where: { id: context.id } })).toMatchObject({ moduleId: null });
  expect(await f.db.run.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ sessionId: context.id, status: "finished", stopStatus: "confirmed" });
});

test.each(["queued", "running", "unknown-stop"])("ordinary context removal retains %s guard", async kind => {
  const f = await fixture("web", true);
  const context = await f.db.agentContext.create({ data: { workspaceId: f.workspace.id, ownerId: "owner", moduleId: f.module.id, hash: f.module.activeHash! } });
  const run = await f.db.run.create({ data: { workspaceId: f.workspace.id, sessionId: context.id, lane: "foreground", trigger: "module", status: kind === "unknown-stop" ? "failed" : kind, stopStatus: kind === "unknown-stop" ? "unknown" : "pending", provider: "fake", tokenHash: "context", prompt: "work", cwd: f.ports.dataDir } });
  await f.db.providerLaunch.create({ data: { runId: run.id, digest: "launched" } });
  await expect(requestRemove(f.context, f.module.id, "remove")).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.approval.count()).toBe(0);
  expect(await readFile(join(f.data, "keep.txt"), "utf8")).toBe("valuable");
  expect(await f.db.agentContext.findUnique({ where: { id: context.id } })).not.toBeNull();
  expect(await f.db.run.findUnique({ where: { id: run.id } })).not.toBeNull();
});
