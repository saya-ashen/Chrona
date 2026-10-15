import { afterEach, beforeEach, expect, test } from "bun:test";
import { testDb } from "./test-db";
import { createAffairs } from "./affairs";
import { createAsks } from "./asks";
let db: ReturnType<typeof testDb>;
beforeEach(async () => { db = testDb(); await db.workspace.create({ data: { id: "w", name: "Test" } }); });
afterEach(() => db.$disconnect());
for (const status of ["done", "paused"] as const) {
  for (const kind of ["question", "approval"] as const) {
    test(`${status} affair with ${kind} preserves lifecycle on resolution`, async () => {
      const ctx = { db, workspaceId: "w", now: () => new Date() };
      const affairs = createAffairs(ctx), asks = createAsks(ctx);
      const a = await affairs.create({ request: "Investigate" });
      const q = kind === "question"
        ? await asks.createQuestion({ affairId: a.id, title: "Which?", questions: [{ question: "Which?", why: "Needed" }] })
        : await asks.createApproval({ affairId: a.id, title: "Send?", action: "send_external_message" });
      await affairs.update(a.id, { status });
      const decision = kind === "question" ? { decision: "answer", text: "First" } : { decision: "approve" };
      if (status === "done") {
        expect((await affairs.detail(a.id)).asks[0]?.status).toBe("expired");
        expect((await affairs.detail(a.id)).entries.some(e => e.kind === "note" && e.text.includes("过期"))).toBe(true);
        await expect(asks.resolve(q.id, decision)).rejects.toMatchObject({ code: "conflict", message: "这件事已经结束" });
        await affairs.addEntry(a.id, { kind: "feedback", text: "Revise" });
        expect((await affairs.detail(a.id)).affair).toMatchObject({ status: "active", agentState: "queued" });
      } else {
        expect((await affairs.detail(a.id)).asks[0]?.status).toBe("open");
        await asks.resolve(q.id, decision);
        expect((await affairs.detail(a.id)).affair).toMatchObject({ status: "paused", agentState: "idle" });
        expect((await db.affair.findUniqueOrThrow({ where: { id: a.id } })).nextRunAt).toBeNull();
        expect((await affairs.detail(a.id)).entries.some(e => e.kind === (kind === "question" ? "answer" : "decision"))).toBe(true);
        await affairs.update(a.id, { status: "active" });
        expect((await affairs.detail(a.id)).affair.agentState).toBe("queued");
      }
    });
  }
}
