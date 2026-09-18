import { beforeEach, afterEach, expect, test } from "bun:test";
import { db, resetTestDb, seedTask, seedWorkspace } from "@chrona/db";
import { createLibraryService } from "./service";
import type { LibraryActor } from "./access";
import type { LibraryAction } from "@chrona/contracts/library";
const previous = process.env.CHRONA_LIBRARY_WRITES_ENABLED;
beforeEach(async () => { await resetTestDb(); process.env.CHRONA_LIBRARY_WRITES_ENABLED = "true"; });
afterEach(async () => { await resetTestDb(); if (previous === undefined) delete process.env.CHRONA_LIBRARY_WRITES_ENABLED; else process.env.CHRONA_LIBRARY_WRITES_ENABLED = previous; });
async function fixture() {
  const { workspaceId } = await seedWorkspace(), { taskId } = await seedTask(workspaceId, { title: "配一台新电脑" });
  const ownerActor: LibraryActor = { workspaceId, actorKey: "owner:test", isOwner: true, canOrganize: true, canConfigure: true };
  const agentActor: LibraryActor = { ...ownerActor, actorKey: "external:test", isOwner: false, canConfigure: false };
  const owner = createLibraryService({ authorize: async () => ownerActor }), agent = createLibraryService({ authorize: async () => agentActor });
  const write = async (action: LibraryAction, service = owner) => service.write({ requestId: crypto.randomUUID(), expectedRevision: (await service.read({ view: "catalog" })).revision, action });
  const a = await write({ type: "group_create", name: "主题", instructions: "按内容的主题整理", allowAgentFolders: true });
  const b = await write({ type: "group_create", name: "归属", instructions: "不知道归属时不要猜", allowAgentFolders: true });
  return { workspaceId, taskId, owner, agent, ownerActor, agentActor, write, theme: a.receipt.changes[0].groupId!, audience: b.receipt.changes[0].groupId! };
}
test("Agent places one stable content in two exclusive groups, creates missing folders, returns durable receipts without execution", async () => {
  const f = await fixture(), before = await db.task.findUniqueOrThrow({ where: { id: f.taskId } });
  const result = await f.write({ type: "assign", taskId: f.taskId, placements: [
    { groupId: f.theme, destination: { type: "create", name: "设备数码", description: "设备与采购" } },
    { groupId: f.audience, destination: { type: "create", name: "家庭", description: "" } },
  ] }, f.agent);
  expect(result.receipt.changes.filter(c => c.kind === "folder_created")).toHaveLength(2);
  const all = await f.owner.read({}); expect(all.total).toBe(1); expect(all.items[0].placements).toHaveLength(2);
  for (const p of all.items[0].placements) {
    expect((await f.owner.read({ groupId: p.groupId, folderId: p.folderId })).items[0].id).toBe(f.taskId);
    expect((await f.owner.read({ groupId: p.groupId, unclassified: true })).total).toBe(0);
  }
  expect(await db.task.findUniqueOrThrow({ where: { id: f.taskId } })).toEqual(before);
  expect(await Promise.all([db.run.count(), db.taskPlan.count(), db.executionSession.count(), db.taskResult.count(), db.workBlock.count()])).toEqual([0,0,0,0,0]);
  expect((await f.agent.read({ view: "history", taskId: f.taskId })).history[0]).toEqual(result.receipt);
});
test("manual moves and unclassified choices remain protected from Agents and ordinary content updates", async () => {
  const f = await fixture();
  await f.write({ type: "assign", taskId: f.taskId, placements: [{ groupId: f.theme, destination: { type: "create", name: "电脑", description: "" } }] }, f.agent);
  await f.write({ type: "assign", taskId: f.taskId, placements: [{ groupId: f.theme, destination: { type: "unclassified" } }] });
  await expect(f.write({ type: "assign", taskId: f.taskId, placements: [{ groupId: f.theme, destination: { type: "create", name: "偷偷新建", description: "" } }] }, f.agent)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.libraryFolder.count()).toBe(1);
  await expect(f.write({ type: "assign", taskId: f.taskId, placements: [{ groupId: f.theme, protect: false, destination: { type: "unclassified" } }] }, f.agent)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.task.update({ where: { id: f.taskId }, data: { title: "更新方案" } });
  expect((await f.owner.read({ view: "item", taskId: f.taskId })).items[0].placements[0]).toMatchObject({ folderId: null, protected: true });
  await f.write({ type: "assign", taskId: f.taskId, placements: [{ groupId: f.theme, protect: false, destination: { type: "unclassified" } }] });
  await f.write({ type: "assign", taskId: f.taskId, placements: [{ groupId: f.theme, destination: { type: "create", name: "数码", description: "" } }] }, f.agent);
});
test("idempotency, concurrent CAS, exact-name normalization, disabled/revoked writes", async () => {
  const f = await fixture(), read = await f.agent.read({});
  const input = { requestId: crypto.randomUUID(), expectedRevision: read.revision, action: { type: "folder_create", groupId: f.theme, name: " PC  Builds ", description: "" } };
  const one = await f.agent.write(input); expect(await f.agent.write(input)).toEqual({ ...one, replayed: true });
  await expect(f.agent.write({ ...input, action: { ...input.action, name: "different" } })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(f.agent.write({ ...input, requestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  const reuse = await f.write({ type: "folder_create", groupId: f.theme, name: "ＰＣ builds", description: "" }, f.agent);
  expect(reuse.receipt.changes[0].kind).toBe("folder_reused"); expect(await db.libraryFolder.count()).toBe(1);
  const revision = (await f.agent.read({})).revision;
  const concurrent = await Promise.allSettled(["A","B"].map(name => f.agent.write({ requestId: crypto.randomUUID(), expectedRevision: revision, action: { ...input.action, name } })));
  expect(concurrent.filter(r => r.status === "fulfilled")).toHaveLength(1);
  f.agentActor.canOrganize = false;
  await expect(f.agent.write(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  f.agentActor.canOrganize = true; process.env.CHRONA_LIBRARY_WRITES_ENABLED = "false";
  await expect(f.agent.write(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect((await f.agent.read({})).canOrganize).toBe(false);
});
test("scope, group exclusivity, bounded reads and no partial assignment side effects", async () => {
  const f = await fixture(), foreign = await seedWorkspace("Foreign"), t = await seedTask(foreign.workspaceId);
  await expect(f.agent.read({ view: "item", taskId: t.taskId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(f.agent.read({ view: "history", taskId: t.taskId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  const a = await f.write({ type: "folder_create", groupId: f.theme, name: "A", description: "" });
  const folderId = a.receipt.changes[0].folderId!;
  await expect(f.write({ type: "assign", taskId: f.taskId, placements: [{ groupId: f.audience, destination: { type: "folder", folderId } }] }, f.agent)).rejects.toMatchObject({ code: "NOT_FOUND" });
  const revision = (await f.agent.read({})).revision;
  await expect(Promise.resolve().then(() => f.agent.write({ requestId: crypto.randomUUID(), expectedRevision: revision, action: { type: "assign", taskId: f.taskId, placements: [1,2].map(() => ({ groupId: f.theme, destination: { type: "folder", folderId } })) } }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await expect(f.write({ type: "assign", taskId: f.taskId, placements: [{ groupId: f.audience, destination: { type: "create", name: "Rollback", description: "" } }, { groupId: "missing", destination: { type: "unclassified" } }] }, f.agent)).rejects.toThrow();
  expect(await db.libraryFolder.count()).toBe(1); expect(await db.libraryAssignment.count()).toBe(0);
  await expect(Promise.resolve(db.libraryAssignment.create({ data: { taskId: t.taskId, groupId: f.theme, folderId, actorKey: "bad" } }))).rejects.toThrow();
  for (let i=0;i<24;i++) await seedTask(f.workspaceId, { title: `Item ${i}` });
  const page = await f.owner.read({ limit: 20 }); expect(page.total).toBe(25); expect(page.nextOffset).toBe(20);
  expect((await f.owner.read({ offset: 20 })).items).toHaveLength(5);
});
test("rename/delete folders preserve content, other groups and protected unclassified tombstones; configure is distinct", async () => {
  const f = await fixture();
  await expect(f.write({ type: "group_create", name: "Forbidden", instructions: "", allowAgentFolders: true }, f.agent)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await f.write({ type: "assign", taskId: f.taskId, placements: [{ groupId: f.theme, destination: { type: "create", name: "设备", description: "" } }, { groupId: f.audience, destination: { type: "create", name: "家庭", description: "" } }] });
  const folderId = (await f.owner.read({ groupId: f.theme, view: "catalog" })).folders[0].id;
  await f.write({ type: "folder_update", folderId, name: "设备数码", description: "明确范围" });
  expect((await f.owner.read({ view: "item", taskId: f.taskId })).items[0].placements.find(p=>p.groupId===f.theme)?.folderName).toBe("设备数码");
  await f.write({ type: "folder_delete", folderId });
  expect((await f.owner.read({ groupId: f.theme, unclassified: true })).total).toBe(1);
  expect((await f.owner.read({ view: "item", taskId: f.taskId })).items[0].placements.find(p=>p.groupId===f.theme)).toMatchObject({ folderId: null, protected: true });
  expect(await db.task.count()).toBe(1); expect(await db.libraryAssignment.count()).toBe(2);
  await f.write({ type: "group_update", groupId: f.theme, name: "主题", instructions: "", allowAgentFolders: false });
  await expect(f.write({ type: "folder_create", groupId: f.theme, name: "No", description: "" }, f.agent)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await f.write({ type: "group_delete", groupId: f.theme }); expect(await db.task.count()).toBe(1); expect(await db.libraryAssignment.count()).toBe(1);
  await expect(Promise.resolve(db.libraryCommand.updateMany({ data: { receipt: {} } }))).rejects.toThrow();
  await expect(Promise.resolve(db.libraryCommand.deleteMany())).rejects.toThrow();
});
