import { afterEach, expect, test } from "bun:test";
import { PREINSTALLED_MODULE_NAMES, type ModuleInitializationState } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import { testDb } from "./test-db";
import { ensureWorkspaceInitialized } from "./module-initialization";
import { factConsumer, selectFactConsumer } from "./notification-facts";
import type { StewardPorts } from "./ports";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });
async function fixture() {
  const db = testDb();
  closes.push(() => db.$disconnect());
  const workspace = await db.workspace.create({ data: { name: "initialization" } });
  const notify = await db.module.create({ data: { workspaceId: workspace.id, name: "notify", activeHash: "installed-hash", builtin: false } });
  const ports: StewardPorts = { db, dataDir: "/unused-initialization-fixture", now: () => new Date("2026-11-05T12:00:00Z"), publicUrl: null };
  const state: ModuleInitializationState = { version: 1, status: "complete", packages: Object.fromEntries([...new Set([...PREINSTALLED_MODULE_NAMES, "mind", "remind"])].map(name => [name, {
    requestKey: `initialize:v1:${name}:1`, attempts: 1, status: name === "notify" ? "installed" : "skipped", moduleId: name === "notify" ? notify.id : null, hash: name === "notify" ? notify.activeHash : null, approvalId: null, error: null,
  }])) as ModuleInitializationState["packages"] };
  const save = () => db.workspace.update({ where: { id: workspace.id }, data: { settings: { moduleInitialization: state } as unknown as Prisma.InputJsonValue } });
  await save();
  return { db, workspaceId: workspace.id, notify, ports, state, save, initialize: () => ensureWorkspaceInitialized(ports, workspace.id) };
}

test("completed initialization recovers a missing default selection once from the persisted Notify install", async () => {
  const f = await fixture();
  expect(await factConsumer(f.db, f.workspaceId)).toEqual({ moduleId: null, revision: "unselected" });
  expect((await f.initialize()).status).toBe("complete");
  const selected = await factConsumer(f.db, f.workspaceId);
  expect(selected.moduleId).toBe(f.notify.id);
  expect(selected.revision).not.toBe("unselected");
  await f.initialize();
  expect(await factConsumer(f.db, f.workspaceId)).toEqual(selected);
});

test("successful Notify seeds the consumer while another preinstall awaits explicit retry", async () => {
  const f = await fixture();
  f.state.status = "pending";
  f.state.packages.web.status = "failed";
  f.state.packages.web.error = { code: "failed", reason: "installation_rejected", message: "fixture failed checks" };
  await f.save();
  expect((await f.initialize()).status).toBe("pending");
  expect((await factConsumer(f.db, f.workspaceId)).moduleId).toBe(f.notify.id);
  expect((await f.initialize()).packages.web.attempts).toBe(1);
});

test.each(["skipped", "failed", "unavailable", "missing-id", "missing-hash", "paused", "changed-hash", "builtin", "other-workspace", "replaced"])("default selection rejects %s Notify evidence", async kind => {
  const f = await fixture();
  if (kind === "skipped" || kind === "failed" || kind === "unavailable") f.state.packages.notify.status = kind;
  if (kind === "missing-id") f.state.packages.notify.moduleId = null;
  if (kind === "missing-hash") f.state.packages.notify.hash = null;
  if (kind === "paused") await f.db.module.update({ where: { id: f.notify.id }, data: { status: "paused" } });
  if (kind === "changed-hash") await f.db.module.update({ where: { id: f.notify.id }, data: { activeHash: "another-release" } });
  if (kind === "builtin") await f.db.module.update({ where: { id: f.notify.id }, data: { builtin: true } });
  if (kind === "other-workspace") {
    const other = await f.db.workspace.create({ data: { name: "other" } });
    await f.db.module.update({ where: { id: f.notify.id }, data: { workspaceId: other.id } });
  }
  if (kind === "replaced") {
    await f.db.module.delete({ where: { id: f.notify.id } });
    await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "notify", activeHash: f.notify.activeHash } });
  }
  await f.save();
  await f.initialize();
  expect(await factConsumer(f.db, f.workspaceId)).toEqual({ moduleId: null, revision: "unselected" });
  expect(await f.db.kernelFactConsumer.count()).toBe(0);
});

test.each(["null", "custom", "deleted-id"])("initialization preserves the owner's explicit %s consumer selection and revision", async kind => {
  const f = await fixture();
  const custom = kind === "null" ? null : await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "custom-consumer", activeHash: "custom-hash" } });
  const selected = await selectFactConsumer(f.db, f.workspaceId, custom?.id ?? null, f.ports.now());
  if (kind === "deleted-id") await f.db.module.delete({ where: { id: custom!.id } });
  await f.initialize(); await f.initialize();
  expect(await factConsumer(f.db, f.workspaceId)).toEqual(selected);
});

test("an existing ordinary Notify is skipped without selecting it or installing a replacement", async () => {
  const f = await fixture();
  await f.db.workspace.update({ where: { id: f.workspaceId }, data: { settings: {} } });
  await f.db.module.createMany({ data: PREINSTALLED_MODULE_NAMES.filter(name => name !== "notify").map(name => ({ workspaceId: f.workspaceId, name })) });
  const result = await f.initialize();
  expect(result.status).toBe("complete");
  expect(result.packages.notify).toMatchObject({ status: "skipped", moduleId: f.notify.id, hash: null });
  expect(await factConsumer(f.db, f.workspaceId)).toEqual({ moduleId: null, revision: "unselected" });
  expect(await f.db.module.count()).toBe(PREINSTALLED_MODULE_NAMES.length);
});

test("fresh initialization skips optional Mind and paused Remind and retries never install them", async () => {
  const f = await fixture();
  await f.db.workspace.update({ where: { id: f.workspaceId }, data: { settings: {} } });
  await f.db.module.createMany({ data: PREINSTALLED_MODULE_NAMES.filter(name => name !== "notify").map(name => ({ workspaceId: f.workspaceId, name })) });
  let submissions = 0;
  f.ports.moduleExternalInstaller = async () => { submissions++; throw new Error("Optional app reached preinstaller"); };
  const initial = await f.initialize();
  expect(initial.status).toBe("complete");
  expect(initial.packages.mind).toMatchObject({ status: "skipped", attempts: 1, moduleId: null, hash: null, error: null });
  expect(initial.packages.remind).toMatchObject({ status: "skipped", attempts: 1, moduleId: null, hash: null, error: { code: "unavailable", reason: "module_paused" } });
  const persisted = (await f.db.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).settings as Record<string, unknown>;
  expect(persisted.moduleInitialization).toEqual(initial);
  expect(await ensureWorkspaceInitialized(f.ports, f.workspaceId, { retryFailed: true })).toEqual(initial);
  expect(submissions).toBe(0);
  expect(await f.db.module.count({ where: { name: { in: ["mind", "remind"] } } })).toBe(0);
  expect(await f.db.moduleVersion.count()).toBe(0);
});

test.each(["mind", "remind"] as const)("an optional %s initialization cannot enqueue a default install or retry", async name => {
  const f = await fixture();
  f.state.status = "pending";
  f.state.packages[name] = { ...f.state.packages[name], status: "failed", attempts: 3, error: { code: "failed", reason: "old_failure", message: "old failure" } };
  await f.save();
  const result = await ensureWorkspaceInitialized(f.ports, f.workspaceId, { retryFailed: true });
  expect(result.status).toBe("complete");
  expect(result.packages[name]).toMatchObject({ status: "skipped", attempts: 3, error: name === "remind" ? { code: "unavailable", reason: "module_paused" } : null });
  expect(await f.db.module.count({ where: { name } })).toBe(0);
  expect(await f.db.moduleVersion.count()).toBe(0);
  expect((await factConsumer(f.db, f.workspaceId)).moduleId).toBe(f.notify.id);
  expect(await f.initialize()).toEqual(result);
});

test("an existing customized Author is handled without replacement or changing the Notify binding", async () => {
  const f = await fixture();
  await f.db.workspace.update({ where: { id: f.workspaceId }, data: { settings: {} } });
  await f.db.module.createMany({ data: PREINSTALLED_MODULE_NAMES.filter(name => name !== "notify" && name !== "author").map(name => ({ workspaceId: f.workspaceId, name })) });
  const author = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "author", activeHash: "custom-author-hash", status: "paused", builtin: false } });
  const selected = await selectFactConsumer(f.db, f.workspaceId, f.notify.id, f.ports.now());
  f.ports.moduleExternalInstaller = async () => { throw new Error("Existing Author reached installer"); };
  const state = await f.initialize();
  expect(state.status).toBe("complete");
  expect(state.packages.author).toMatchObject({ requestKey: "initialize:v1:author:1", attempts: 1, status: "skipped", moduleId: author.id, hash: null });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: author.id } })).toEqual(author);
  expect(await factConsumer(f.db, f.workspaceId)).toEqual(selected);
  expect(await f.initialize()).toEqual(state);
});

test("an installed optional Mind is retained without being adopted as a preinstalled app", async () => {
  const f = await fixture();
  const mind = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "mind", activeHash: "a".repeat(40) } });
  f.state.packages.mind = { ...f.state.packages.mind, status: "installed", moduleId: mind.id, hash: mind.activeHash };
  await f.save();
  expect((await f.initialize()).packages.mind).toMatchObject({ status: "skipped", moduleId: mind.id, hash: mind.activeHash, error: null });
  const persisted = (await f.db.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).settings as Record<string, unknown>;
  expect(persisted.moduleInitialization).toEqual(await f.initialize());
  expect(await f.db.module.findUniqueOrThrow({ where: { id: mind.id } })).toEqual(mind);
});
