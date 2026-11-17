import { createTestAgentContext } from "../__testing__/test-provider";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUN_LIMITS } from "@chrona/contracts/steward";
import { createStewardService } from "./service";
import { testDb } from "../__testing__/test-db";
import type { StewardPorts } from "../ports";

let db: ReturnType<typeof testDb>, ports: StewardPorts, service: ReturnType<typeof createStewardService>;
let api: ReturnType<typeof service.forWorkspace>, workspaceId: string, sessionId: string, now: Date;
const finished = { outcome: "finished", sessionId: null, error: null } as const;
beforeEach(async () => {
  db = testDb();
  workspaceId = (await db.workspace.create({ data: { name: "run-governance", settings: { timezone: "Asia/Shanghai" } } })).id;
  sessionId = (await createTestAgentContext(db, workspaceId)).id;
  now = new Date("2026-10-15T15:59:00Z");
  ports = { db, dataDir: await mkdtemp(join(tmpdir(), "chrona-core-")), now: () => now, publicUrl: null };
  service = createStewardService(ports);
  api = service.forWorkspace(workspaceId);
});
afterEach(async () => {
  await db.$disconnect();
  await rm(ports.dataDir, { recursive: true, force: true });
});
const enqueue = (id = sessionId, lane: "foreground" | "background" = "foreground") => api.runs.enqueue({ sessionId: id, lane, trigger: "message", prompt: "Bounded work" });
async function cancel(runId: string) {
  await db.run.update({ where: { id: runId }, data: { cancelRequestedAt: new Date() } });
}

test("the service admits only active workspace Agent contexts and stores their private cwd", async () => {
  const foreignWorkspace = await db.workspace.create({ data: { name: "foreign" } });
  const foreign = await createTestAgentContext(db, foreignWorkspace.id);
  await expect(enqueue(foreign.id)).rejects.toMatchObject({ code: "not_found" });
  await expect(api.runs.enqueue({ lane: "foreground", trigger: "message", prompt: "No session" })).rejects.toMatchObject({ code: "invalid" });
  await db.agentContext.update({ where: { id: sessionId }, data: { status: "ended" } });
  await expect(enqueue()).rejects.toMatchObject({ code: "not_found" });
  expect(await db.run.count()).toBe(0);
  await db.agentContext.update({ where: { id: sessionId }, data: { status: "active" } });
  const queued = await enqueue();
  expect(queued).toMatchObject({ workspaceId, sessionId, status: "queued", cwd: join(ports.dataDir, "sessions", sessionId) });
  expect((await stat(queued.cwd)).isDirectory()).toBe(true);
  expect(api).not.toHaveProperty("schedules");
  await expect(service.forWorkspace(foreignWorkspace.id).runs.finish(queued.id, finished, { stopEvidence: "provider_exited" })).rejects.toMatchObject({ code: "not_found" });
  expect((await db.run.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe("queued");
});

test("claim rotates the stored capability and finishing revokes it before another claim", async () => {
  const queued = await enqueue();
  const run = (await api.runs.claimNext("foreground"))!;
  expect(run.id).toBe(queued.id);
  const stored = await db.run.findUniqueOrThrow({ where: { id: run.id } });
  expect(stored.tokenHash).toBe(createHash("sha256").update(run.token).digest("hex"));
  expect(stored.tokenHash).not.toBe(queued.tokenHash);
  expect(stored.tokenHash).not.toBe(run.token);
  expect(await api.runs.authenticate(run.token)).toMatchObject({ workspaceId, run: { id: run.id }, session: { id: sessionId } });
  const next = await enqueue();
  expect(await api.runs.claimNext("foreground")).toBeNull();
  await api.runs.finish(run.id, finished, { stopEvidence: "provider_exited" });
  await expect(api.runs.authenticate(run.token)).rejects.toMatchObject({ code: "forbidden" });
  await expect(service.tools.catalog(run.token)).rejects.toMatchObject({ code: "forbidden" });
  expect((await api.runs.claimNext("foreground"))?.id).toBe(next.id);
});

test.each(["deadline", "lease", "cancel"] as const)("%s invalidates a capability and takes precedence over successful completion", async reason => {
  await enqueue();
  const run = (await api.runs.claimNext("foreground"))!;
  if (reason === "cancel") await cancel(run.id);
  else {
    const boundary = new Date(now.getTime() + 1000);
    await db.run.update({ where: { id: run.id }, data: reason === "deadline" ? { deadlineAt: boundary } : { leaseUntil: boundary } });
    now = new Date(boundary.getTime() - 1);
    expect((await api.runs.authenticate(run.token)).run.id).toBe(run.id);
    now = boundary;
  }
  await expect(api.runs.authenticate(run.token)).rejects.toMatchObject({ code: "forbidden" });
  await expect(service.tools.call(run.token, "chrona_reply", { text: "Too late" })).rejects.toMatchObject({ code: "forbidden" });
  expect((await db.run.findUniqueOrThrow({ where: { id: run.id } })).toolCalls).toEqual([]);
  await api.runs.finish(run.id, finished, { stopEvidence: "provider_exited" });
  expect(await db.run.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: reason === "cancel" ? "cancelled" : "timed_out", leaseUntil: null, endedAt: now });
});

test("lease expiry holds lane and session capacity until actual stop", async () => {
  await db.workspace.update({ where: { id: workspaceId }, data: { settings: { runTimeoutMinutes: 1 } } });
  await enqueue();
  const running = (await api.runs.claimNext("foreground"))!;
  const background = await enqueue(sessionId, "background");
  expect(await api.runs.claimNext("background")).toBeNull();
  now = new Date(running.leaseUntil!.getTime() - 1);
  expect(await api.runs.expireLeases()).toBe(0);
  now = running.leaseUntil!;
  expect(await api.runs.expireLeases()).toBe(1);
  expect(await api.runs.expireLeases()).toBe(0);
  expect(await db.run.findUniqueOrThrow({ where: { id: running.id } })).toMatchObject({ status: "failed", stopStatus: "unknown", leaseUntil: null });
  expect(await api.runs.claimNext("background")).toBeNull();
  await api.runs.finish(running.id, finished, { stopEvidence: "provider_exited" });
  expect((await api.runs.claimNext("background"))?.id).toBe(background.id);
  expect(await db.audit.count({ where: { subjectId: running.id, kind: "run_finished" } })).toBe(2);
});

test.each(["inactive", "cancelled"] as const)("claim rechecks a queued run's %s admission and continues to eligible work", async reason => {
  const stale = await enqueue();
  const other = await createTestAgentContext(db, workspaceId);
  now = new Date(now.getTime() + 1);
  const eligible = await enqueue(other.id);
  if (reason === "inactive") await db.agentContext.update({ where: { id: sessionId }, data: { status: "ended" } });
  else await cancel(stale.id);
  expect((await api.runs.claimNext("foreground"))?.id).toBe(eligible.id);
  expect(await db.run.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({ status: "cancelled", startedAt: null, endedAt: now });
});

for (const scope of ["session", "workspace"] as const) test(`${scope} budget admits its last slot, defers excess and resets at local midnight`, async () => {
  const historySession = scope === "session" ? sessionId : (await createTestAgentContext(db, workspaceId)).id;
  const limit = scope === "session" ? RUN_LIMITS.maxRunsPerSessionPerDay : RUN_LIMITS.maxRunsPerDay;
  await db.run.createMany({ data: Array.from({ length: limit - 1 }, (_, index) => ({ workspaceId, sessionId: historySession, lane: "foreground", trigger: "message", status: index % 2 ? "failed" : "finished", provider: "fixture", tokenHash: `history-${index}`, cwd: ports.dataDir, prompt: "", startedAt: now, endedAt: now })) });
  const last = await enqueue();
  expect((await api.runs.claimNext("foreground"))?.id).toBe(last.id);
  await api.runs.finish(last.id, finished, { stopEvidence: "provider_exited" });
  const excess = await enqueue();
  expect(await api.runs.claimNext("foreground")).toBeNull();
  expect(await db.run.findUniqueOrThrow({ where: { id: excess.id } })).toMatchObject({ status: "queued", startedAt: null, leaseUntil: new Date("2026-10-15T16:00:00Z") });
  if (scope === "session") {
    const independent = await createTestAgentContext(db, workspaceId);
    const independentRun = await enqueue(independent.id);
    expect((await api.runs.claimNext("foreground"))?.id).toBe(independentRun.id);
    await api.runs.finish(independentRun.id, finished, { stopEvidence: "provider_exited" });
  } else {
    const foreignWorkspace = await db.workspace.create({ data: { name: "independent" } });
    const foreignSession = await createTestAgentContext(db, foreignWorkspace.id);
    const foreignRuns = service.forWorkspace(foreignWorkspace.id).runs;
    const independent = await foreignRuns.enqueue({ sessionId: foreignSession.id, lane: "foreground", trigger: "message", prompt: "Separate budget" });
    expect((await foreignRuns.claimNext("foreground"))?.id).toBe(independent.id);
  }
  now = new Date("2026-10-15T15:59:59.999Z");
  expect(await api.runs.claimNext("foreground")).toBeNull();
  now = new Date("2026-10-15T16:00:00Z");
  expect((await api.runs.claimNext("foreground"))?.id).toBe(excess.id);
});

test("failed tool dispatch consumes the last call slot and the next call is rejected before dispatch", async () => {
  await enqueue();
  const run = (await api.runs.claimNext("foreground"))!;
  const history = Array.from({ length: RUN_LIMITS.maxChronaToolCalls - 1 }, () => ({ tool: "unavailable_tool", at: now.toISOString(), ok: false }));
  await db.run.update({ where: { id: run.id }, data: { toolCalls: history } });
  await expect(service.tools.call(run.token, "removed_tool", {})).rejects.toMatchObject({ code: "forbidden", message: "Provider tools require an application Agent context" });
  await expect(service.tools.call(run.token, "unavailable_tool", {})).rejects.toMatchObject({ code: "forbidden", message: "Chrona tool call limit reached" });
  const stored = await db.run.findUniqueOrThrow({ where: { id: run.id } });
  expect(stored.toolCalls).toEqual([...history, { tool: "removed_tool", at: now.toISOString(), ok: false }]);
  expect(await db.audit.count({ where: { subjectId: run.id, kind: "tool_started" } })).toBe(1);
  expect(await db.audit.count({ where: { subjectId: run.id, kind: "tool_limit_rejected" } })).toBe(1);
});
