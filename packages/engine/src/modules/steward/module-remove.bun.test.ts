import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import { moduleContext } from "./module-context";
import { requestRemove, removeApproved } from "./module-remove";
import { moduleSupervisor } from "./module-supervisor";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-remove-");
  const workspace = await db.workspace.create({ data: { name: "remove" } });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date("2026-11-05T12:00:00Z") };
  closes.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example", activeHash: "version" } });
  const manifest = moduleManifestSchema.parse({ name: module.name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], triggers: [], effects: [] });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "version", manifest, source: "user", status: "approved", intent: {}, report: {} } });
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

test.each(["owned-session", "entry-session", "queued-run", "build-target", "dependency", "unknown-call", "unhandled-reply", "unknown-effect"])("removal rejects %s without deleting data or creating an approval", async kind => {
  const f = await fixture();
  if (["owned-session", "entry-session", "queued-run"].includes(kind)) {
    const session = await f.db.session.create({ data: { workspaceId: f.workspace.id, key: "related", source: "module", status: kind === "queued-run" ? "ended" : "active", ...(kind === "entry-session" ? { entryModuleId: f.module.id } : { moduleId: f.module.id }) } });
    if (kind === "queued-run") await f.db.run.create({ data: { workspaceId: f.workspace.id, sessionId: session.id, lane: "background", trigger: "source", status: "queued", provider: "fake", tokenHash: "one", prompt: "work", cwd: f.ports.dataDir } });
  }
  if (kind === "build-target") {
    const session = await f.db.session.create({ data: { workspaceId: f.workspace.id, key: "build", source: "build" } });
    await f.db.audit.create({ data: { workspaceId: f.workspace.id, actorKey: "chrona", kind: "build_request", subjectId: session.id, details: { modules: [f.module.name, "second"] } } });
    await f.db.run.create({ data: { workspaceId: f.workspace.id, sessionId: session.id, lane: "build", trigger: "build", status: "running", provider: "fake", tokenHash: "two", prompt: "build", cwd: f.ports.dataDir } });
  }
  if (kind === "dependency") {
    const other = await f.db.module.create({ data: { workspaceId: f.workspace.id, name: "consumer", activeHash: "consumer" } });
    await f.db.moduleVersion.create({ data: { moduleId: other.id, hash: "consumer", manifest: { ...f.manifest, name: "consumer", uses: ["example.read"] }, source: "user", status: "approved", intent: {}, report: {} } });
  }
  if (kind === "unknown-call" || kind === "unhandled-reply") await f.db.moduleInvocation.create({ data: { workspaceId: f.workspace.id, caller: `module:${f.module.id}`, callerModuleId: f.module.id, target: "other", tool: "read", args: {}, key: "once", mode: "async", status: kind === "unknown-call" ? "unknown" : "succeeded", reply: kind === "unhandled-reply" } });
  if (kind === "unknown-effect") await f.db.moduleCall.create({ data: { moduleId: f.module.id, hash: "version", method: "exec", key: "once", status: "failed", error: "unknown" } });
  await expect(requestRemove(f.context, f.module.id, "remove")).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.approval.count()).toBe(0);
  expect(await readFile(join(f.data, "keep.txt"), "utf8")).toBe("valuable");
  expect(await f.db.module.findUnique({ where: { id: f.module.id } })).not.toBeNull();
});

test("approval restoration rechecks identity and unknown results", async () => {
  const f = await fixture(), action = await f.approved();
  await f.db.module.update({ where: { id: f.module.id }, data: { builtin: true } });
  await expect(removeApproved(f.context, action)).rejects.toMatchObject({ code: "forbidden" });
  expect(await readFile(join(f.data, "keep.txt"), "utf8")).toBe("valuable");
  await f.db.module.update({ where: { id: f.module.id }, data: { builtin: false } });
  await f.db.moduleInvocation.create({ data: { workspaceId: f.workspace.id, caller: "owner", target: f.module.name, tool: "read", args: {}, key: "unknown", mode: "sync", status: "unknown" } });
  await expect(removeApproved(f.context, action)).rejects.toMatchObject({ code: "conflict" });
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).status).toBe("active");
});

test("final deletion transaction rechecks associations created during backup", async () => {
  const f = await fixture(), action = await f.approved();
  let transactions = 0;
  const db = new Proxy(f.db, { get(target, key, receiver) {
    if (key === "$transaction") return async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      if (++transactions === 2) await f.db.session.create({ data: { workspaceId: f.workspace.id, key: "late", source: "module", moduleId: f.module.id } });
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
  const history = await f.db.session.create({ data: { workspaceId: f.workspace.id, key: "history", source: "module", moduleId: f.module.id, entryModuleId: f.module.id, status: "ended" } });
  await f.db.moduleInvocation.create({ data: { workspaceId: f.workspace.id, caller: `module:${f.module.id}`, callerModuleId: f.module.id, target: "other", tool: "read", args: {}, key: "done", mode: "async", status: "succeeded", reply: true, repliedAt: f.ports.now() } });
  await removeApproved(f.context, await f.approved());
  expect(await f.db.module.findUnique({ where: { id: f.module.id } })).toBeNull();
  expect(await f.db.session.findUniqueOrThrow({ where: { id: history.id } })).toMatchObject({ moduleId: null, entryModuleId: f.module.id, status: "ended" });
  const removal = await f.db.audit.findFirstOrThrow({ where: { kind: "module_removed", subjectId: f.module.id } });
  expect(await readFile(join((removal.details as { backup: string }).backup, "data/keep.txt"), "utf8")).toBe("valuable");
});
