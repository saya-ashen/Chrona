import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "@chrona/db";
import { createStewardRoutes, type StewardRoutePorts } from "../../routes/steward.routes";
import { resetTestDb, seedWorkspace } from "../bun-test-helpers";

// Test-only injected ports: no runner, model, source or delivery is invoked.
let app: Hono, workspaceId: string;
const clock = new Date("2026-10-14T00:00:00.000Z");
beforeEach(async () => {
  await resetTestDb(); ({ workspaceId } = await seedWorkspace());
  process.env.API_KEY = "test-owner-work-key";
  app = new Hono().route("/api/steward", createStewardRoutes({ db, now: () => clock, sources: {} as StewardRoutePorts["sources"], assessor: { name: "test-only", assess: async () => { throw new Error("Unexpected assessor call"); } } as StewardRoutePorts["assessor"] }));
});
afterEach(() => { delete process.env.API_KEY; });
async function post(path: string, body?: unknown, scope = workspaceId, authorization = "Bearer test-owner-work-key") {
  return app.request(`/api/steward${path}?workspaceId=${encodeURIComponent(scope)}`, { method: "POST", headers: { "content-type": "application/json", authorization }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function create() { const response = await post("/works", { text: "Compare train routes" }); expect(response.status).toBe(200); return await response.json() as { id: string; affairId: string; delegationId: string; status: string }; }
test("owner creates a received work with in-app delivery and no chat recipient", async () => {
  const work = await create(); expect(work.status).toBe("received");
  const row = await db.stewardWork.findFirstOrThrow({ where: { id: work.id, workspaceId }, include: { delegation: true } });
  expect(row.request).toBe("Compare train routes"); expect(row.delegation.workspaceId).toBe(workspaceId);
  expect(row.delegation.notification).toMatchObject({ channel: "in_app", recipient: null });
});
test("all three commands reject non-owner bearers", async () => {
  for (const [path, body] of [["/works", { text: "hello" }], ["/works/missing/input", { kind: "answer", text: "hello" }], ["/works/missing/accept", undefined]] as const) expect((await post(path, body, workspaceId, "Bearer scoped-management-token")).status).toBe(401);
});
test("validates request length and rejects client-supplied scope and channels", async () => {
  for (const body of [{ text: " " }, { text: "x".repeat(2001) }, { text: "ok", workspaceId: "other" }, { text: "ok", chat: {} }]) expect((await post("/works", body)).status).toBe(400);
  expect((await post("/works", { text: "x".repeat(2000) })).status).toBe(200);
});
test("answer wakes waiting work and resolves its question, not authorization", async () => {
  const w = await create(); await db.stewardWork.update({ where: { id: w.id }, data: { status: "waiting_input", nextRunAt: null } });
  const question = await db.attentionItem.create({ data: { workspaceId, affairId: w.affairId, delegationId: w.delegationId, kind: "input", title: "Which city?", whatHappened: "Need city", whyItMatters: "Search", nextStep: "Answer", dedupeKey: `work:${w.id}:ask:1` } });
  const response = await post(`/works/${w.id}/input`, { kind: "answer", text: "Shanghai" }); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "received", revision: 2, inputs: [{ kind: "answer", text: "Shanghai" }], nextRunAt: clock.toISOString() });
  expect((await db.attentionItem.findUniqueOrThrow({ where: { id: question.id } })).status).toBe("resolved");
  expect((await post(`/works/${w.id}/input`, { kind: "decision", text: "grant everything" })).status).toBe(400);
  expect((await post(`/works/${w.id}/input`, { kind: "feedback", text: "x".repeat(1001) })).status).toBe(400);
});
test("accept only result_ready; feedback reopens accepted work", async () => {
  const w = await create(); expect((await post(`/works/${w.id}/accept`)).status).toBe(409);
  await db.stewardWork.update({ where: { id: w.id }, data: { status: "result_ready" } });
  const accepted = await post(`/works/${w.id}/accept`); expect(accepted.status).toBe(200); expect(await accepted.json()).toMatchObject({ status: "accepted", nextRunAt: null });
  const feedback = await post(`/works/${w.id}/input`, { kind: "feedback", text: "Include costs" }); expect(feedback.status).toBe(200); expect(await feedback.json()).toMatchObject({ status: "received", inputs: [{ kind: "feedback", text: "Include costs" }] });
});
test("cross-workspace mutations cannot find another workspace's work", async () => {
  const w = await create(); const other = await db.workspace.create({ data: { name: "Other test workspace", status: "Active" } });
  expect((await post(`/works/${w.id}/input`, { kind: "answer", text: "wrong scope" }, other.id)).status).toBe(404);
  expect((await post(`/works/${w.id}/accept`, undefined, other.id)).status).toBe(404);
  expect((await db.stewardWork.findUniqueOrThrow({ where: { id: w.id } })).revision).toBe(1);
});
test("paused and revoked authorizations cannot be woken by owner input", async () => {
  const w = await create(); for (const status of ["paused", "revoked"]) {
    await db.delegation.update({ where: { id: w.delegationId }, data: { status } });
    expect((await post(`/works/${w.id}/input`, { kind: "answer", text: "Continue" })).status).toBe(409);
  }
});
