import { afterEach, expect, test } from "bun:test";
import { testDb } from "./test-db";
import { acknowledgeKernelFacts, factConsumer, readKernelFacts, recordApprovalFact, recordKernelFact, recordWithdrawal, seedFactConsumer, selectFactConsumer } from "./notification-facts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture() {
  const db = testDb(); cleanups.push(() => db.$disconnect());
  const workspaceId = (await db.workspace.create({ data: { name: "facts" } })).id;
  async function app(name: string) {
    const row = await db.module.create({ data: { workspaceId, name, activeHash: `${name}-hash` } });
    return { kind: "module" as const, module: row.name, moduleId: row.id, hash: row.activeHash! };
  }
  const first = await app("first"), second = await app("second"), now = new Date("2026-11-08T00:00:00Z");
  await seedFactConsumer(db, workspaceId, first.moduleId, now);
  return { db, workspaceId, first, second, now };
}
test("facts outlive a paused or absent consumer, require current identity and keep one global consumption receipt", async () => {
  const f = await fixture(), { db, workspaceId, first, second, now } = f;
  const fact = await recordKernelFact(db, workspaceId, "result", { type: "notice", data: { key: "result", title: "完成", body: "body", level: "now" } }, now);
  await expect(readKernelFacts(db, workspaceId, second)).rejects.toThrow("Only the selected");
  await expect(readKernelFacts(db, workspaceId, { ...first, hash: "stale" })).rejects.toThrow("no longer active");
  await expect(selectFactConsumer(db, workspaceId, second.moduleId, now)).rejects.toThrow("Pause");
  await db.module.update({ where: { id: first.moduleId }, data: { status: "paused" } });
  await expect(readKernelFacts(db, workspaceId, first)).rejects.toThrow("no longer active");
  const selection = await selectFactConsumer(db, workspaceId, second.moduleId, now);
  expect((await readKernelFacts(db, workspaceId, second)).facts.map(row => row.id)).toEqual([fact.id]);
  await expect(acknowledgeKernelFacts(db, workspaceId, second, "old", [fact.id])).rejects.toThrow("changed");
  expect(await acknowledgeKernelFacts(db, workspaceId, second, selection.revision, [fact.id])).toEqual({ acknowledged: [fact.id] });
  expect(await acknowledgeKernelFacts(db, workspaceId, second, selection.revision, [fact.id])).toEqual({ acknowledged: [fact.id] });
  expect((await readKernelFacts(db, workspaceId, second)).facts).toEqual([]);
  await db.module.update({ where: { id: second.moduleId }, data: { status: "paused" } });
  await db.module.update({ where: { id: first.moduleId }, data: { status: "active" } });
  const back = await selectFactConsumer(db, workspaceId, first.moduleId, now);
  expect(await acknowledgeKernelFacts(db, workspaceId, first, back.revision, [fact.id])).toEqual({ acknowledged: [] });
  expect((await recordKernelFact(db, workspaceId, "result", { type: "notice", data: { key: "result", title: "完成", body: "changed", level: "now" } }, now)).kind).toBe("kernel_fact_consumed");
  expect(await db.moduleInvocation.count({ where: { workspaceId } })).toBe(0);
});
test("an explicit no-consumer selection survives trusted seeding and preserves pending facts", async () => {
  const { db, workspaceId, first, now } = await fixture();
  await db.module.update({ where: { id: first.moduleId }, data: { status: "paused" } });
  await selectFactConsumer(db, workspaceId, null, now);
  await seedFactConsumer(db, workspaceId, first.moduleId, now);
  expect((await factConsumer(db, workspaceId)).moduleId).toBeNull();
  const workspace = await db.workspace.create({ data: { name: "explicit-none-before-seed" } });
  await selectFactConsumer(db, workspace.id, null, now);
  await seedFactConsumer(db, workspace.id, first.moduleId, now);
  expect((await factConsumer(db, workspace.id)).moduleId).toBeNull();
});
test("approval facts and withdrawal commit with state, exclude private payload and redact bounded text", async () => {
  const { db, workspaceId, first, now } = await fixture();
  const input = { workspaceId, id: "approval-a", title: "批准", action: "activate_module", detail: "x".repeat(9000), preview: "safe", moduleId: null, createdAt: now };
  await expect(db.$transaction(async tx => { await recordApprovalFact(tx, input); throw new Error("rollback"); })).rejects.toThrow("rollback");
  expect((await readKernelFacts(db, workspaceId, first)).facts).toEqual([]);
  await db.$transaction(async tx => { await recordApprovalFact(tx, input); await recordWithdrawal(tx, workspaceId, "approval:approval-a", now); });
  const facts = (await readKernelFacts(db, workspaceId, first)).facts;
  expect(facts).toHaveLength(2);
  expect(facts.find(row => row.type === "approval")?.data).toMatchObject({ approval: "approval-a", detail: "x".repeat(4000) });
  expect(JSON.stringify(facts)).not.toContain("payload");
  expect(facts.find(row => row.type === "withdraw")?.data).toEqual({ key: "approval:approval-a" });
});
test("long background results are bounded before persistence and never poison the next page", async () => {
  const { db, workspaceId, first, now } = await fixture();
  for (const [index, body] of ["x".repeat(4001), `Authorization: Bearer ${"x".repeat(80)} ${"y".repeat(9000)}`].entries()) {
    const saved = await recordKernelFact(db, workspaceId, `long-${index}`, { type: "lifecycle", data: { key: `long-${index}`, fact: { kind: "background-result", title: "标题", body } } }, now);
    expect(JSON.stringify(saved.details)).not.toContain("more chars");
  }
  const page = await readKernelFacts(db, workspaceId, first);
  expect(page.facts).toHaveLength(2);
  for (const fact of page.facts) {
    expect(fact.type).toBe("lifecycle");
    if (fact.type === "lifecycle" && fact.data.fact.kind === "background-result") expect(fact.data.fact.body.length).toBeLessThanOrEqual(4000);
  }
});
test("bounded facts page and workspace identity do not expose other audits or arbitrary details", async () => {
  const { db, workspaceId, first, now } = await fixture();
  await db.audit.create({ data: { workspaceId, kind: "private", actorKey: "kernel", details: { password: "private" } } });
  for (let n = 0; n < 51; n++) await recordWithdrawal(db, workspaceId, `question:${n}`, now);
  const page = await readKernelFacts(db, workspaceId, first);
  expect(page.facts).toHaveLength(50);
  expect(JSON.stringify(page)).not.toContain("password");
  const other = (await db.workspace.create({ data: { name: "other" } })).id;
  await expect(readKernelFacts(db, other, first)).rejects.toThrow("Only the selected");
});
