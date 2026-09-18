import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { db, resetTestDb, seedWorkspace } from "@chrona/db";
import { createChronaEngine, createManagementClient } from "@chrona/engine";
import { MANAGEMENT_ACCESS_PRESETS } from "@chrona/contracts/api";
import { resetEnvCacheForTests } from "../../config/env";
import { apiKeyAuth } from "../../middleware/auth";
import { createWorkRecordRoutes } from "./work-records.routes";
const previousKey = process.env.API_KEY, previousEnabled = process.env.CHRONA_WORK_WRITES_ENABLED, previousOrigins = process.env.ALLOWED_ORIGINS;
let app: Hono;
const capture = () => ({ requestId: crypto.randomUUID(), title: "Invitation", context: { kind: "meeting", window: { startsAt: "2031-01-01T10:00:00+08:00", endsAt: "2031-01-01T11:00:00+08:00", timezone: "Asia/Shanghai" } } });
function restore(name: string, value: string | undefined) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
async function post(path: string, body: unknown, authorization = `Bearer ${process.env.API_KEY}`, extra: Record<string, string> = {}) {
  const response = await app.request(`http://localhost/api/work-records/${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}), ...extra }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json(), response };
}
beforeEach(async () => { await resetTestDb(); await seedWorkspace(); process.env.API_KEY = crypto.randomUUID(); process.env.CHRONA_WORK_WRITES_ENABLED = "true"; delete process.env.ALLOWED_ORIGINS; resetEnvCacheForTests(); app = new Hono().use("/api/*", apiKeyAuth()).route("/api", createWorkRecordRoutes()); });
afterEach(async () => { restore("API_KEY", previousKey); restore("CHRONA_WORK_WRITES_ENABLED", previousEnabled); restore("ALLOWED_ORIGINS", previousOrigins); resetEnvCacheForTests(); await resetTestDb(); });
describe("work recording owner HTTP and scoped management boundary", () => {
  it("shares work identity and history between scoped external capture and owner confirmation", async () => {
    const client = await createManagementClient({ name: "Recorder", publicUrl: "http://localhost:3101", scopes: [...MANAGEMENT_ACCESS_PRESETS["work-record"]] });
    const engine = createChronaEngine(), identity = await engine.management.authorize(client.token);
    const result = await engine.management.call(identity, "chrona_work_capture", capture());
    expect(result.ok).toBe(true); if (!result.ok) throw Error("capture failed");
    const receipt = (result.data as { receipt: { taskId: string; revision: string } }).receipt;
    const update = { taskId: receipt.taskId, requestId: crypto.randomUUID(), expectedRevision: receipt.revision, action: { type: "propose", change: { type: "cancel", reason: "Source reports cancellation" } } };
    expect((await engine.management.call(identity, "chrona_work_update", update)).ok).toBe(true);
    const read = await post("read", { taskId: receipt.taskId });
    expect(read.body.entries[0].actorKey).toBe(`external:${identity.id}`);
    const resolution = { taskId: receipt.taskId, requestId: crypto.randomUUID(), expectedRevision: read.body.record.revision, action: { type: "resolve", entryId: read.body.pendingChanges[0].id, decision: "apply", reason: "Checked source" } };
    expect(await engine.management.call(identity, "chrona_work_update", resolution)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    const applied = await post("update", resolution); expect(applied.status).toBe(200);
    expect((await post("update", resolution)).body).toEqual({ ...applied.body, replayed: true });
    expect((await post("read", { taskId: receipt.taskId })).body.record.cancelled).toBe(true);
    expect(await db.managementCommand.count()).toBe(0); expect(await db.workCommand.count()).toBe(3); expect(await db.run.count()).toBe(0);
    const created = await db.event.findFirst({ where: { eventType: "task.created", taskId: receipt.taskId } });
    expect(created).toMatchObject({ actorType: "agent", actorId: `external:${identity.id}` });
    expect(read.response.headers.get("cache-control")).toBe("no-store");
  });
  it("keeps legacy and result credentials unchanged, and gives work writers no lifecycle or review authority", async () => {
    const engine = createChronaEngine();
    for (const preset of ["read", "full", "assistant", "results-files-submit", "work-read", "work-record"] as const) {
      const client = await createManagementClient({ name: preset, publicUrl: "http://localhost:3101", scopes: [...MANAGEMENT_ACCESS_PRESETS[preset]] });
      const identity = await engine.management.authorize(client.token);
      const result = await engine.management.call(identity, "chrona_work_capture", capture());
      if (preset === "work-record") {
        expect(result.ok).toBe(true);
        expect(await engine.management.call(identity, "chrona_task_create", { requestId: crypto.randomUUID(), title: "Escalate", mode: "todo" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
        expect((await post("capture", capture(), `Bearer ${client.token}`)).status).toBe(401);
      } else expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    }
    expect(await db.task.count()).toBe(1);
    await expect(createManagementClient({ name: "Incomplete", publicUrl: "http://localhost:3101", scopes: ["tasks:read", "work:write"] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
  it("requires owner origin and JSON, blocks malformed/oversized input, and preserves reads with writes off", async () => {
    expect((await post("capture", capture(), "")).status).toBe(401);
    expect((await post("capture", capture(), `Bearer ${process.env.API_KEY}`, { Origin: "https://untrusted.invalid" })).status).toBe(401);
    expect((await post("capture", capture(), `Bearer ${process.env.API_KEY}`, { "Content-Type": "text/plain" })).status).toBe(400);
    expect((await post("capture", { ...capture(), title: "x".repeat(34000) })).status).toBe(413);
    expect((await post("capture", { ...capture(), autoExecute: true })).body.code).toBe("VALIDATION_ERROR");
    const args = capture(), first = await post("capture", args); expect(first.status).toBe(200);
    delete process.env.CHRONA_WORK_WRITES_ENABLED;
    expect((await post("capture", args)).status).toBe(403);
    expect((await post("read", { taskId: first.body.receipt.taskId })).body.canWrite).toBe(false);
  });
  it("refreshes reduced and revoked capabilities before replay", async () => {
    const engine = createChronaEngine(), client = await createManagementClient({ name: "Recorder", publicUrl: "http://localhost:3101", scopes: [...MANAGEMENT_ACCESS_PRESETS["work-record"]] });
    const identity = await engine.management.authorize(client.token), args = capture();
    expect((await engine.management.call(identity, "chrona_work_capture", args)).ok).toBe(true);
    await db.managementClient.update({ where: { id: client.clientId }, data: { scopes: ["tasks:read", "work:read"] } });
    expect(await engine.management.call(identity, "chrona_work_capture", args)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    await db.managementClient.update({ where: { id: client.clientId }, data: { revokedAt: new Date() } });
    expect(await engine.management.call(identity, "chrona_work_search", {})).toMatchObject({ ok: false, error: { code: "AUTH_REQUIRED" } });
    expect(await db.workCommand.count()).toBe(1);
  });
});
