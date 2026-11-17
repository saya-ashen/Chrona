import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { lifecycleOperationSchema, moduleCallSchema, moduleManifestSchema } from "@chrona/contracts/steward";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { createApprovals } from "./approvals";
import { callStatus, callSync, callsSettled, enqueueCall, kernelOrigin, runDueCalls } from "./modules/module-calls";
import { handleModuleCall } from "./modules/module-effects";
import { createModules } from "./modules/modules";
import { completeApprovedOperationsIn } from "./modules/module-operation-result";
import { moduleSupervisor } from "./modules/module-supervisor";
import { registerSystemModules } from "./system/system-modules";
import type { StewardPorts } from "./ports";

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
  registerSystemModules();
  const dataDir = await mkdtemp(join(tmpdir(), "chrona-api-receipts-"));
  const databaseUrl = `file:${join(dataDir, "test.db")}`;
  ensureSqliteDatabase({ databaseUrl, migrationsDir: resolve(import.meta.dirname, "../../../packages/db/prisma/migrations") });
  const connect = () => new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) });
  const ports: StewardPorts = { db: connect(), dataDir, publicUrl: null, now: () => new Date("2026-11-10T12:00:00Z") };
  cleanup.push(async () => {
    try { await callsSettled(ports); await moduleSupervisor(ports).stop(); }
    finally { await ports.db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
  });
  const workspace = await ports.db.workspace.create({ data: { name: "receipt regressions" } });
  const owner = { ...kernelOrigin(workspace.id), caller: { kind: "owner" as const, via: null } };
  async function app(name: string, authority?: "owner") {
    const row = await ports.db.module.create({ data: { workspaceId: workspace.id, name, activeHash: `${name}-v1` } });
    const manifest = moduleManifestSchema.parse({ name, authority, uses: ["*"], entry: "index.ts", tests: ["test.ts"], effects: [], tools: [{ name: "observe", description: "Observe", parameters: { type: "object", properties: {} }, output: { type: "object", properties: {} } }] });
    await ports.db.moduleVersion.create({ data: { moduleId: row.id, hash: row.activeHash!, manifest, source: "user", status: "approved", intent: {}, report: {} } });
    const origin = { ...kernelOrigin(workspace.id), caller: { kind: "module" as const, module: name, moduleId: row.id, hash: row.activeHash! } };
    return { row, manifest, origin, scope: { workspaceId: workspace.id, moduleId: row.id, hash: row.activeHash!, manifest } };
  }
  async function reopen() {
    await callsSettled(ports); await moduleSupervisor(ports).stop(); await ports.db.$disconnect();
    ports.db = connect();
  }
  return { ports, get db() { return ports.db; }, workspace, owner, app, reopen };
}

const approvalCases = [
  { mode: "sync", decision: "denied" }, { mode: "async", decision: "denied" },
  { mode: "sync", decision: "expired" }, { mode: "async", decision: "expired" },
] as const;
test.each([...approvalCases])("$mode $decision operation queries preserve keyed submission and callStatus across DB reopen", async ({ mode, decision }) => {
  const f = await fixture(), app = await f.app("managed"), target = "modules.remove", key = "remove-once";
  const args = { moduleId: app.row.id, reason: "unused" };
  const input = { tx: f.db, ports: f.ports, origin: f.owner, target, raw: args };
  const submitted = mode === "sync" ? await callSync(f.ports, f.owner, target, args, { key }) : await enqueueCall(input, { key });
  if (mode === "async") expect(await runDueCalls(f.ports, f.workspace.id)).toBe(1);
  const original = await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: submitted.callId } });
  const receipt = lifecycleOperationSchema.parse(original.output);
  expect(receipt).toMatchObject({ operationId: submitted.callId, moduleId: app.row.id, status: "pending_approval" });
  expect(typeof receipt.approvalId).toBe("string");
  expect(original.status).toBe("succeeded");
  const selector = { moduleId: app.row.id, action: "remove", key };
  expect((await callSync(f.ports, f.owner, "modules.operation", selector)).output).toEqual(receipt);
  if (decision === "denied") await createApprovals({ ...f.ports, workspaceId: f.workspace.id }).resolve(receipt.approvalId!, { decision: "deny" });
  else await f.db.approval.update({ where: { id: receipt.approvalId! }, data: { status: "expired", resolvedAt: f.ports.now() } });
  const terminal = (await callSync(f.ports, f.owner, "modules.operation", selector)).output;
  expect(terminal).toMatchObject({ status: "failed", approvalId: receipt.approvalId, error: { code: "failed" } });
  // Neither removing the target nor reinstalling its name should erase the old operation.
  await f.db.module.delete({ where: { id: app.row.id } });
  await f.app("managed");
  await f.reopen();
  expect((await callSync(f.ports, f.owner, "modules.operation", { operationId: submitted.callId })).output).toEqual(terminal);
  expect((await callSync(f.ports, f.owner, "modules.operation", selector)).output).toEqual(terminal);
  if (mode === "sync") expect(await callSync(f.ports, f.owner, target, args, { key })).toEqual({ callId: submitted.callId, output: receipt });
  else expect(await enqueueCall({ ...input, tx: f.db }, { key })).toMatchObject({ callId: submitted.callId, duplicate: true });
  expect(await callStatus(f.ports, f.owner, { target, key })).toMatchObject({ callId: submitted.callId, status: "succeeded", output: receipt });
  expect(await callStatus(f.ports, f.owner, { callId: submitted.callId })).toMatchObject({ status: "succeeded", output: receipt });
  const retained = await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: submitted.callId } });
  expect({ ...retained, operationOutput: null }).toEqual({ ...original, operationOutput: null });
  expect(retained.operationOutput).toEqual(terminal);
  expect(await f.db.approval.count({ where: { workspaceId: f.workspace.id } })).toBe(1);
});

test("approved removal stays done after restart and same-name reinstall without rewriting its pending receipt", async () => {
  const f = await fixture(), app = await f.app("removed"), target = "modules.remove", key = "remove";
  const args = { moduleId: app.row.id, reason: "unused" };
  const submitted = await callSync(f.ports, f.owner, target, args, { key });
  const receipt = lifecycleOperationSchema.parse(submitted.output);
  await createApprovals({ ...f.ports, workspaceId: f.workspace.id }, createModules(f.ports, f.workspace.id).onApproved).resolve(receipt.approvalId!, { decision: "approve" });
  const terminal = (await callSync(f.ports, f.owner, "modules.operation", { operationId: submitted.callId })).output;
  expect(terminal).toMatchObject({ status: "done", result: { moduleId: app.row.id, status: "removed" } });
  expect(await f.db.module.findUnique({ where: { id: app.row.id } })).toBeNull();
  await f.app("removed");
  await f.reopen();
  expect((await callSync(f.ports, f.owner, "modules.operation", { operationId: submitted.callId })).output).toEqual(terminal);
  expect(await callSync(f.ports, f.owner, target, args, { key })).toEqual(submitted);
  expect(await callStatus(f.ports, f.owner, { target, key })).toMatchObject({ status: "succeeded", output: receipt });
});

test.each(["sync", "async"] as const)("%s keyed write commits its receipt without attempting routed-call diagnostics", async mode => {
  const f = await fixture(), app = await f.app("entry", "owner");
  // Fail any unexpected routed-call insert; successful routes must not attempt one.
  await f.db.$executeRawUnsafe(`CREATE TRIGGER fail_route_log BEFORE INSERT ON "ModuleCall" WHEN NEW.method = 'call' BEGIN SELECT RAISE(FAIL, 'private-database-error-payload'); END`);
  const diagnostic = spyOn(console, "error").mockImplementation(() => {});
  cleanup.push(() => { diagnostic.mockRestore(); });
  const target = "settings.update", key = "private-request-key", args = { timezone: "UTC" };
  const request = moduleCallSchema.parse({ id: "write", method: "call", params: { target, args, mode, key } });
  const response = await handleModuleCall(f.ports, { ...app.scope, eventKey: "private-event-key" }, request);
  expect(response).not.toHaveProperty("error");
  if (mode === "sync") expect(response).toMatchObject({ result: { output: { timezone: "UTC" } } });
  else expect(response).toMatchObject({ result: { callId: expect.any(String), status: "queued" } });
  // Wait for the route's own delivery loop; manually draining here would hide a missed wake-up.
  await callsSettled(f.ports);
  const status = await callStatus(f.ports, app.origin, { target, key });
  expect(status).toMatchObject({ status: "succeeded", output: { timezone: "UTC" } });
  expect((await f.db.workspace.findUniqueOrThrow({ where: { id: f.workspace.id } })).settings).toMatchObject({ timezone: "UTC" });
  expect(await f.db.moduleCall.count()).toBe(0);
  expect(await handleModuleCall(f.ports, app.scope, { ...request, id: "replay" })).toMatchObject(mode === "sync" ? { result: { output: status.output } } : { result: { callId: status.callId, duplicate: true } });
  await callsSettled(f.ports);
  expect(await f.db.audit.count({ where: { workspaceId: f.workspace.id, kind: "settings_updated" } })).toBe(1);
  expect(await f.db.moduleInvocation.count({ where: { workspaceId: f.workspace.id, target: "settings", tool: "update", key } })).toBe(1);
  expect(diagnostic).not.toHaveBeenCalled();
});

test("rejected-call diagnostics preserve the routing error when their insert fails", async () => {
  const f = await fixture(), app = await f.app("entry", "owner");
  await f.db.$executeRawUnsafe(`CREATE TRIGGER fail_route_log BEFORE INSERT ON "ModuleCall" WHEN NEW.method = 'call' BEGIN SELECT RAISE(FAIL, 'private-database-error-payload'); END`);
  const diagnostic = spyOn(console, "error").mockImplementation(() => {});
  cleanup.push(() => { diagnostic.mockRestore(); });
  const request = moduleCallSchema.parse({ id: "invalid", method: "call", params: { target: "settings.update", args: { unexpected: "private-argument" }, mode: "sync" } });
  expect(await handleModuleCall(f.ports, app.scope, request)).toMatchObject({ error: { code: "invalid" } });
  expect(diagnostic).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(diagnostic.mock.calls[0]![0]))).toEqual({ component: "module-effects", event: "module_call.persist_failed", moduleId: app.row.id, method: "call", status: "rejected" });
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("private-");
});

test("a confirmed rollback operation remains terminal after later version changes and DB reopen", async () => {
  const f = await fixture(), app = await f.app("rollback-target");
  const hash = "b".repeat(40), key = "rollback-once";
  const approval = await f.db.approval.create({ data: { workspaceId: f.workspace.id, action: "activate_module", status: "approved", title: "restore", detail: "restore", preview: "restore", payload: {}, resolvedAt: f.ports.now() } });
  const output = { operationId: "rollback-operation", moduleId: app.row.id, status: "pending_approval", approvalId: approval.id };
  await f.db.moduleInvocation.create({ data: { id: output.operationId, workspaceId: f.workspace.id, caller: "owner", target: "modules", targetIdentity: "system:modules", tool: "rollback", args: { moduleId: app.row.id, hash, reason: "restore" }, key, mode: "sync", status: "succeeded", output } });
  await f.db.$transaction(async tx => {
    await tx.module.update({ where: { id: app.row.id }, data: { activeHash: hash } });
    await completeApprovedOperationsIn(tx, f.workspace.id, approval.id);
  });
  const persisted = (await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: output.operationId } })).operationOutput;
  expect(persisted).toMatchObject({ status: "done", result: { activeHash: hash } });
  await f.db.module.update({ where: { id: app.row.id }, data: { activeHash: app.row.activeHash, status: "paused" } });
  const args = { operationId: output.operationId };
  const done = (await callSync(f.ports, f.owner, "modules.operation", args)).output;
  expect(done).toMatchObject({ status: "done", result: { activeHash: hash } });
  await f.db.module.update({ where: { id: app.row.id }, data: { activeHash: app.row.activeHash } });
  await f.reopen();
  expect((await callSync(f.ports, f.owner, "modules.operation", args)).output).toEqual(done);
  expect((await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: output.operationId } })).output).toEqual(output);
});
