import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { db, resetTestDb, seedTask, seedWorkspace } from "@chrona/db";
import { createChronaEngine, createManagementClient } from "@chrona/engine";
import { resetEnvCacheForTests } from "../../config/env";
import { apiKeyAuth } from "../../middleware/auth";
import { createWorkResultRoutes } from "./work-results.routes";

const previousKey = process.env.API_KEY, previousEnabled = process.env.CHRONA_RESULT_WRITES_ENABLED;
const previousOrigins = process.env.ALLOWED_ORIGINS;
const content = { schemaVersion: 1, outcome: { title: "Outside work", summary: "A result without execution" }, readiness: { status: "ready", summary: "Contributor reports ready" } };
let app: Hono, taskId: string;
function mount() { resetEnvCacheForTests(); app = new Hono().use("/api/*", apiKeyAuth()).route("/api", createWorkResultRoutes()); }
const input = () => ({ taskId, requestId: crypto.randomUUID(), expectedRevision: null, content });
async function post(path: string, body: unknown, authorization = `Bearer ${process.env.API_KEY}`, extra: Record<string, string> = {}) {
  const response = await app.request(`http://localhost/api/results/${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}), ...extra }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json(), response };
}
function restore(name: string, value: string | undefined) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
beforeEach(async () => {
  await resetTestDb(); process.env.API_KEY = crypto.randomUUID(); process.env.CHRONA_RESULT_WRITES_ENABLED = "true";
  delete process.env.ALLOWED_ORIGINS;
  const { workspaceId } = await seedWorkspace(); ({ taskId } = await seedTask(workspaceId));
  mount();
});
afterEach(async () => { restore("API_KEY", previousKey); restore("CHRONA_RESULT_WRITES_ENABLED", previousEnabled); restore("ALLOWED_ORIGINS", previousOrigins); resetEnvCacheForTests(); await resetTestDb(); });

describe("owner HTTP work-result entries", () => {
  it("uses the same result and receipt writer as scoped MCP without forging a client", async () => {
    const client = await createManagementClient({ name: "Contributor", publicUrl: "http://localhost:3101", scopes: ["tasks:read", "results:read", "results:write"] });
    const engine = createChronaEngine(), identity = await engine.management.authorize(client.token);
    const { taskId: sharedTask } = await seedTask(identity.workspaceId); taskId = sharedTask;
    const args = input(), created = await engine.management.call(identity, "chrona_result_submit", args);
    expect(created.ok).toBe(true);
    const read = await post("read", { taskId });
    expect(read.status).toBe(200);
    const versionId = read.body.version.id;
    expect(read.body.version.actorKey).toBe(`external:${identity.id}`);
    const review = { taskId, requestId: crypto.randomUUID(), expectedRevision: read.body.result.editRevision, versionId, decision: "accept", feedback: "Owner checked it" };
    const accepted = await post("review", review), replay = await post("review", review);
    expect(accepted.status).toBe(200);
    expect(replay.body).toEqual({ replayed: true, receipt: accepted.body.receipt });
    const history = await post("read", { taskId, view: "reviews" });
    expect(history.body.reviews.items[0]).toMatchObject({ actorKey: "human:local-owner", feedback: "Owner checked it" });
    expect(await db.managementClient.count()).toBe(1);
    expect(await db.managementCommand.count()).toBe(0);
    expect(await db.resultCommand.count()).toBe(2);
    expect(await Promise.all([db.run.count(), db.taskPlan.count(), db.executionSession.count(), db.goalInboxCandidate.count()])).toEqual([0, 0, 0, 0]);
    expect(read.response.headers.get("cache-control")).toBe("no-store");
  });

  it("requires the owner key and never treats a management credential as owner authority", async () => {
    const client = await createManagementClient({ name: "Legacy full", publicUrl: "http://localhost:3101" });
    expect((await post("submit", input(), "")).status).toBe(401);
    expect((await post("submit", input(), `Bearer ${client.token}`)).status).toBe(401);
    delete process.env.API_KEY; mount();
    expect((await post("submit", input(), `Bearer ${client.token}`)).status).toBe(401);
    expect((await post("read", { taskId }, "Bearer invalid-run-credential")).status).toBe(401);
    // Explicit local owner deployment mode, not a scoped credential fallback.
    const owner = await post("submit", input(), "");
    expect(owner.status).toBe(200);
    expect((await post("read", { taskId }, "")).body.version.actorKey).toBe("human:local-owner");
  });

  it("rejects cross-origin and non-JSON requests even without the outer application middleware", async () => {
    app = new Hono().route("/api", createWorkResultRoutes());
    expect((await post("submit", input(), `Bearer ${process.env.API_KEY}`, { Origin: "https://untrusted.invalid" })).status).toBe(401);
    expect((await post("submit", input(), `Bearer ${process.env.API_KEY}`, { "Content-Type": "text/plain" })).status).toBe(400);
    expect((await post("submit", input(), "Bearer wrong-key")).status).toBe(401);
    expect(await db.taskResult.count()).toBe(0);
  });

  it("preserves text and file reads when new writes are disabled", async () => {
    const args = input(), created = await post("submit", args);
    expect(created.status).toBe(200);
    delete process.env.CHRONA_RESULT_WRITES_ENABLED;
    expect((await post("submit", args)).status).toBe(412);
    expect((await post("read", { taskId })).body.version.id).toBe(created.body.receipt.versionId);
    const response = await app.request("http://localhost/api/results/capabilities", { headers: { Authorization: `Bearer ${process.env.API_KEY}` } });
    expect(await response.json()).toMatchObject({ writesEnabled: false, canRead: true, canSubmit: false, canReview: false, uploads: false, artifactLinking: false, artifactBytes: true });
  });

  it("returns bounded closed errors for malformed, oversized, injected and stale inputs", async () => {
    const malformed = await app.request("http://localhost/api/results/submit", { method: "POST", headers: { Authorization: `Bearer ${process.env.API_KEY}`, "Content-Type": "application/json" }, body: "{" });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await post("submit", { ...input(), actorId: "spoofed" })).body.code).toBe("VALIDATION_ERROR");
    const oversized = await post("submit", { ...input(), source: { label: "x".repeat(100 * 1024) } });
    expect(oversized.status).toBe(413);
    expect(JSON.stringify(oversized.body).length).toBeLessThan(200);
    expect((await post("read", { taskId: "missing" })).status).toBe(404);
    const args = input(); await post("submit", args);
    expect((await post("submit", { ...args, requestId: crypto.randomUUID() })).body.code).toBe("REVISION_CONFLICT");
    expect((await post("submit", { ...args, source: { label: "changed" } })).body.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(await db.taskResultVersion.count()).toBe(1);
  });
});
