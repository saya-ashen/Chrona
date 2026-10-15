import { afterAll, expect, test } from "bun:test";
import { AgentUnavailableError, type AssessmentProposal, type SourceItem } from "@chrona/contracts/steward";
import type { StewardPorts } from "./service";
import { testDb } from "./test-db";
import { createConnections } from "./sources";
const db = testDb(); afterAll(() => db.$disconnect());
async function fixture() {
  const now = new Date("2026-10-15T10:00:00Z"), ws = await db.workspace.create({ data: { name: "Sources" } });
  let items: SourceItem[] = [], proposal: AssessmentProposal = { disposition: "ignore", affairId: null, whatHappened: "Service changed", whyItMatters: "Availability", important: true }, failure: Error | null = null;
  const candidateIds: string[][] = [];
  const ports: StewardPorts = { db, now: () => now, publicUrl: null, sources: [{ kind: "local_test", mode: "poll", coverageNote: "test", readiness: async () => ({ state: "ready" }), poll: async () => ({ items, nextCursor: "cursor" }) }], assessor: { name: "test", assess: async input => { candidateIds.push(input.affairs.map(a => a.id)); if (failure) throw failure; return proposal; } }, deliveries: [], chat: null, agent: null, agentHealth: () => ({ available: true, name: "test", lastError: null }) };
  const s = createConnections(ports, ws.id), connection = await s.create({ kind: "local_test", label: "Test", pollIntervalSeconds: 60 });
  const affair = await db.affair.create({ data: { workspaceId: ws.id, title: "Service", status: "watching", cadenceSeconds: 300, notify: "now", connectionId: connection.id, agentState: "idle" } });
  return { s, ports, now, ws, connection, affair, candidateIds, items: (v: SourceItem[]) => { items = v; }, proposal: (disposition: AssessmentProposal["disposition"], affairId: string | null = affair.id) => { proposal = { ...proposal, disposition, affairId }; }, failure: (v: Error) => { failure = v; } };
}
const item = (externalId: string, current = false): SourceItem => ({ externalId, title: "Service down", body: "Down", url: null, occurredAt: "2026-10-15T09:00:00Z", current });
test("baseline, current items and connection/external-id dedupe", async () => {
  const f = await fixture(); f.items([item("old"), item("current", true)]); await f.s.syncConnection(f.connection.id);
  expect((await f.s.detail(f.connection.id)).events.map(e => e.status).sort()).toEqual(["baseline", "pending"]);
  f.items([item("old"), item("current", true), item("new")]); await f.s.syncConnection(f.connection.id);
  expect((await f.s.detail(f.connection.id)).events).toHaveLength(3); expect((await f.s.list())[0]?.pendingEvents).toBe(2);
});
for (const disposition of ["ignore", "record", "notify", "wake_affair"] as const) test(`assessment ${disposition} atomic effects`, async () => {
  const f = await fixture(); f.items([item(disposition, true)]); f.proposal(disposition); await f.s.syncConnection(f.connection.id); await f.s.assessPending();
  expect((await f.s.detail(f.connection.id)).events[0]?.status).toBe("assessed");
  expect(await db.eventAssessment.count({ where: { workspaceId: f.ws.id } })).toBe(1);
  expect(await db.affairEntry.count({ where: { affairId: f.affair.id, kind: "change" } })).toBe(disposition === "ignore" ? 0 : 1);
  expect(await db.notification.count({ where: { workspaceId: f.ws.id } })).toBe(disposition === "notify" ? 1 : 0);
  const row = await db.affair.findUniqueOrThrow({ where: { id: f.affair.id } }); expect(row.agentState).toBe(disposition === "wake_affair" ? "queued" : "idle");
  if (disposition === "wake_affair") expect(row.wakeReason).toBe("source_change");
  await f.s.assessPending(); expect(await db.eventAssessment.count({ where: { workspaceId: f.ws.id } })).toBe(1);
});
test("unmatched notify/wake do not create affairs", async () => {
  const f = await fixture(); f.items([item("unmatched", true)]); f.proposal("notify", null); await f.s.syncConnection(f.connection.id); await f.s.assessPending();
  expect(await db.affair.count({ where: { workspaceId: f.ws.id } })).toBe(1); expect(await db.notification.count({ where: { workspaceId: f.ws.id } })).toBe(0);
});
test("assessor unavailable stays pending without invalid-attempt penalty; health persisted", async () => {
  const f = await fixture(); f.items([item("current", true)]); f.failure(new AgentUnavailableError()); await f.s.syncConnection(f.connection.id); await f.s.assessPending();
  const event = (await f.s.detail(f.connection.id)).events[0]!; expect(event.status).toBe("pending"); expect(event.attempts).toBe(0);
  expect((await db.stewardState.findUniqueOrThrow({ where: { workspaceId: f.ws.id } })).agentAvailable).toBe(false);
  await f.s.assessPending(); expect(f.candidateIds).toHaveLength(1);
});
test("five invalid outputs fail event and leave affair entry; candidate order and cap", async () => {
  const f = await fixture(); for (let i = 0; i < 22; i++) await db.affair.create({ data: { workspaceId: f.ws.id, title: `Other ${i}`, status: "active" } });
  f.items([item("invalid", true)]); f.proposal("record", "foreign"); await f.s.syncConnection(f.connection.id);
  for (let i = 0; i < 5; i++) await f.s.assessPending(new Date(f.now.getTime() + i * 86400000));
  expect((await f.s.detail(f.connection.id)).events[0]?.status).toBe("failed"); expect(f.candidateIds[0]).toHaveLength(20); expect(f.candidateIds[0]?.[0]).toBe(f.affair.id);
  expect(await db.affairEntry.count({ where: { affairId: f.affair.id, kind: "note" } })).toBe(1);
});
test("pause/revoke stop polling; foreign ids rejected", async () => {
  const f = await fixture(); f.items([item("paused", true)]); await f.s.transition(f.connection.id, { action: "pause" }); await f.s.syncConnection(f.connection.id);
  expect((await f.s.detail(f.connection.id)).events).toHaveLength(0); await f.s.transition(f.connection.id, { action: "resume" }); await f.s.pollDue(); expect((await f.s.detail(f.connection.id)).events).toHaveLength(1);
  await f.s.transition(f.connection.id, { action: "revoke" }); await expect(f.s.transition(f.connection.id, { action: "resume" })).rejects.toThrow("revoked");
  const other = await fixture(); await expect(other.s.syncConnection(f.connection.id)).rejects.toThrow("not found");
});
