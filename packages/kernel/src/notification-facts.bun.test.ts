import { afterEach, expect, test } from "bun:test";
import { testDb } from "./__testing__/test-db";
import { acknowledgeKernelFacts, factConsumer, readKernelFacts, recordApprovalFact, recordKernelFact, recordWithdrawal, selectFactConsumer } from "./notification-facts";

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
  await selectFactConsumer(db, workspaceId, first.moduleId, now);
  return { db, workspaceId, first, second, now };
}
test("facts outlive a paused or absent consumer, require current identity and keep one global consumption receipt", async () => {
  const f = await fixture(), { db, workspaceId, first, second, now } = f;
  const fact = await recordKernelFact(db, workspaceId, "result", { type: "lifecycle", data: { key: "result", fact: { kind: "module-paused", app: "result" } } }, now);
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
  expect((await recordKernelFact(db, workspaceId, "result", { type: "lifecycle", data: { key: "result", fact: { kind: "module-paused", app: "result" } } }, now)).consumedBy).toBe(second.moduleId);
  expect(await db.moduleInvocation.count({ where: { workspaceId } })).toBe(0);
});
test("an explicit no-consumer selection preserves pending facts", async () => {
  const { db, workspaceId, first, now } = await fixture();
  const fact = await recordKernelFact(db, workspaceId, "pending", { type: "withdraw", data: { key: "pending" } }, now);
  await db.module.update({ where: { id: first.moduleId }, data: { status: "paused" } });
  const selected = await selectFactConsumer(db, workspaceId, null, now);
  expect(await factConsumer(db, workspaceId)).toEqual(selected);
  expect(await selectFactConsumer(db, workspaceId, null, now)).toEqual(selected);
  await expect(readKernelFacts(db, workspaceId, first)).rejects.toThrow("Only the selected");
  await db.module.update({ where: { id: first.moduleId }, data: { status: "active" } });
  await selectFactConsumer(db, workspaceId, first.moduleId, now);
  expect((await readKernelFacts(db, workspaceId, first)).facts.map(row => row.id)).toEqual([fact.id]);
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
const providerNotice = { type: "notice" as const, data: { key: "provider", kind: "provider-input-required" as const, run: "run-a", session: "session-a" } };
const pausedLifecycle = { type: "lifecycle" as const, data: { key: "paused", module: "module-a", session: "session-a", fact: { kind: "module-paused" as const, app: "app-a" } } };
const policyFields = { title: "title", body: "body", level: "now", app: "app", approval: "approval", scoped: true, urgent: true, responds: true, recipient: "recipient", policy: "now" };
for (const base of [providerNotice, pausedLifecycle]) {
  for (const [field, value] of Object.entries(policyFields)) test(`${base.type} rejects policy field ${field} before persistence`, async () => {
    const { db, workspaceId, first, now } = await fixture();
    const invalid = { ...base, data: { ...base.data, [field]: value } };
    expect(() => recordKernelFact(db, workspaceId, "invalid", invalid as unknown as Parameters<typeof recordKernelFact>[3], now)).toThrow();
    expect(await db.kernelFact.count({ where: { workspaceId } })).toBe(0);
    expect((await readKernelFacts(db, workspaceId, first)).facts).toEqual([]);
  });
}
const invalidFacts: [string, unknown][] = [
  ["notice module", { ...providerNotice, data: { ...providerNotice.data, module: "module-a" } }],
  ["configure", { type: "configure", data: { "daily-cap": 8, timezone: "UTC", "digest-at": "18:00", at: "2026-11-08T00:00:00Z" } }],
  ...[
    { kind: "reflection-retired", reflection: true, mind: "mind", healthFixes: null },
    { kind: "background-result", title: "title", body: "body" },
    { kind: "run-paused", uncertain: true, status: "failed", error: null },
  ].map(fact => [fact.kind, { type: "lifecycle", data: { key: "retired", fact } }] as [string, unknown]),
  ["unknown notice kind", { ...providerNotice, data: { ...providerNotice.data, kind: "arbitrary" } }],
  ["notice envelope", { ...providerNotice, arbitrary: true }],
  ["notice data", { ...providerNotice, data: { ...providerNotice.data, arbitrary: true } }],
  ["lifecycle envelope", { ...pausedLifecycle, arbitrary: true }],
  ["lifecycle data", { ...pausedLifecycle, data: { ...pausedLifecycle.data, arbitrary: true } }],
  ...[
    { kind: "module-paused", app: "app-a" },
    { kind: "module-build-failed", app: "app-a" },
    { kind: "module-activated", app: "app-a", update: true, hash: "hash-a" },
    { kind: "module-migration-failed", app: "app-a", restore: false },
    { kind: "schedule-failed", target: "target", status: "failed" },
  ].map(fact => [`${fact.kind} arbitrary field`, { type: "lifecycle", data: { key: "arbitrary", fact: { ...fact, arbitrary: true } } }] as [string, unknown]),
  ["unknown lifecycle kind", { type: "lifecycle", data: { key: "unknown", fact: { kind: "arbitrary" } } }],
  ...["changes", "preserves"].map(field => ["activation " + field, { type: "lifecycle", data: { key: "activation", fact: { kind: "module-activated", app: "app-a", update: true, hash: "hash-a", [field]: [] } } }] as [string, unknown]),
  ["schedule status", { type: "lifecycle", data: { key: "schedule", fact: { kind: "schedule-failed", target: "target", status: "succeeded" } } }],
  ["approval data", { type: "approval", data: { approval: "a", title: "title", action: "activate_module", detail: "detail", preview: "preview", arbitrary: true } }],
  ["approval envelope", { type: "approval", data: { approval: "a", title: "title", action: "activate_module", detail: "detail", preview: "preview" }, arbitrary: true }],
  ["withdraw data", { type: "withdraw", data: { key: "a", arbitrary: true } }],
  ["withdraw envelope", { type: "withdraw", data: { key: "a" }, arbitrary: true }],
];
for (const [name, invalid] of invalidFacts) test(`rejects ${name} before persistence`, async () => {
  const { db, workspaceId, first, now } = await fixture();
  expect(() => recordKernelFact(db, workspaceId, "invalid", invalid as Parameters<typeof recordKernelFact>[3], now)).toThrow();
  expect(await db.kernelFact.count({ where: { workspaceId } })).toBe(0);
  expect((await readKernelFacts(db, workspaceId, first)).facts).toEqual([]);
});
test("provider input notice roundtrips its structural references", async () => {
  const { db, workspaceId, first, now } = await fixture();
  const saved = await recordKernelFact(db, workspaceId, providerNotice.data.key, providerNotice, now);
  expect(saved.payload).toEqual(providerNotice);
  expect((await readKernelFacts(db, workspaceId, first)).facts).toEqual([{ id: saved.id, at: now.toISOString(), ...providerNotice }]);
});
test("technical schedule errors are bounded and redacted before persistence and remain readable", async () => {
  const { db, workspaceId, first, now } = await fixture();
  for (const [index, error] of ["x".repeat(9000), `Authorization: Bearer ${"s".repeat(80)} ${"y".repeat(9000)}`].entries()) {
    const saved = await recordKernelFact(db, workspaceId, `error-${index}`, { type: "lifecycle", data: { key: `error-${index}`, fact: { kind: "schedule-failed", target: "target", status: "failed", error } } }, now);
    expect(JSON.stringify(saved.payload)).not.toContain("s".repeat(80));
  }
  const page = await readKernelFacts(db, workspaceId, first);
  expect(page.facts).toHaveLength(2);
  for (const fact of page.facts) {
    expect(fact.type).toBe("lifecycle");
    if (fact.type === "lifecycle" && fact.data.fact.kind === "schedule-failed") expect(fact.data.fact.error!.length).toBeLessThanOrEqual(4000);
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
