import { afterAll, expect, test } from "bun:test";
import { testDb } from "./test-db";
import { createStewardService, type StewardPorts } from "./service";
const db = testDb(); afterAll(() => db.$disconnect());
const now = new Date("2026-10-15T10:00:00Z");
function ports(): StewardPorts { return { db, now: () => now, publicUrl: null, sources: [], deliveries: [{ channel: "in_app", send: async () => ({ outcome: "accepted", receiptRef: null }) }], assessor: { name: "test", assess: async () => { throw Error(); } }, chat: null, agent: null, agentHealth: () => ({ available: true, name: "test", lastError: null }) }; }
test("poll stage failure recorded; care, follow-up, delivery and lastTick still run", async () => {
  const ws = await db.workspace.create({ data: { name: "Tick" } });
  const a = await db.affair.create({ data: { workspaceId: ws.id, title: "Care", status: "watching", agentState: "idle", cadenceSeconds: 300, nextCheckAt: new Date(now.getTime() - 600000) } });
  const b = await db.affair.create({ data: { workspaceId: ws.id, title: "Follow", agentState: "idle" } });
  const follow = await db.followUp.create({ data: { workspaceId: ws.id, affairId: b.id, note: "Check", dueAt: now } });
  const p = ports(), service = createStewardService(p), n = await service.forWorkspace(ws.id).notifications.enqueue({ level: "web", title: "Test", body: "test", dedupeKey: "tick" });
  // Force only the polling query to fail, leaving all real SQLite transactions intact.
  p.db = new Proxy(db, { get(target, key) { if (key === "sourceConnection") return new Proxy(target.sourceConnection, { get(delegate, method) { if (method === "findMany") return async () => { throw Error("poll unavailable"); }; return Reflect.get(delegate, method); } }); const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; } });
  const result = await createStewardService(p).tick(now); expect(result.failures).toContainEqual({ workspaceId: ws.id, stage: "poll" });
  expect((await db.affair.findUniqueOrThrow({ where: { id: a.id } })).wakeReason).toBe("care_check"); expect((await db.affair.findUniqueOrThrow({ where: { id: a.id } })).nextCheckAt! > now).toBe(true);
  expect((await db.affair.findUniqueOrThrow({ where: { id: b.id } })).wakeReason).toBe("follow_up_due"); expect((await db.followUp.findUniqueOrThrow({ where: { id: follow.id } })).status).toBe("done");
  expect((await db.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("sent"); expect((await db.stewardState.findUniqueOrThrow({ where: { workspaceId: ws.id } })).lastTickAt).toEqual(now);
  expect(await db.audit.count({ where: { workspaceId: ws.id, kind: "tick_stage_failed" } })).toBe(1);
});
test("paused/done/running affairs not queued; unavailable assessor reaches health", async () => {
  const ws = await db.workspace.create({ data: { name: "Stopped" } });
  for (const status of ["paused", "done"]) await db.affair.create({ data: { workspaceId: ws.id, title: status, status, agentState: "idle", cadenceSeconds: 300, nextCheckAt: now } });
  await db.affair.create({ data: { workspaceId: ws.id, title: "Running", status: "watching", agentState: "running", cadenceSeconds: 300, nextCheckAt: now } });
  await db.stewardState.create({ data: { workspaceId: ws.id, agentName: "assessor", agentLastError: "Assessor unavailable", agentAvailable: false } });
  const service = createStewardService(ports()); await service.tick(now); expect(await db.affair.count({ where: { workspaceId: ws.id, agentState: "queued" } })).toBe(0);
  expect((await service.forWorkspace(ws.id).health()).agent.available).toBe(false); expect((await service.forWorkspace(ws.id).today()).health.agent.available).toBe(false);
});
