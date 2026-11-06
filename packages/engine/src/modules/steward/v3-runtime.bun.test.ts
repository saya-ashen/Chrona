import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUN_LIMITS } from "@chrona/contracts/steward";
import { createRuns, enqueueModuleWake } from "./runs";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
let db: ReturnType<typeof testDb>, ports: StewardPorts, workspaceId: string, sessionId: string;
beforeEach(async () => {
  db = testDb(); workspaceId = (await db.workspace.create({ data: { name: "runtime" } })).id;
  sessionId = (await db.session.create({ data: { workspaceId, key: "web:first", source: "web" } })).id;
  ports = { db, dataDir: await mkdtemp(join(tmpdir(), "chrona-runtime-")), now: () => new Date("2026-10-15T04:00:00Z"), publicUrl: null };
});
afterEach(async () => { await db.$disconnect(); });
test("run cwd and context belong to the session", async () => {
  const run = await createRuns(ports, workspaceId).enqueue({ sessionId, lane: "foreground", trigger: "message", prompt: "Work" });
  expect(run.cwd).toBe(join(ports.dataDir, "sessions", sessionId));
});
test.each([['foreground', 5], ['background', 20], ['build', 60]] as const)("%s has its own %i minute deadline", async (lane, minutes) => {
  const runs = createRuns(ports, workspaceId);
  if (lane === "build") {
    await db.session.update({ where: { id: sessionId }, data: { source: "build" } });
    await db.audit.create({ data: { id: `build-targets:${sessionId}`, workspaceId, subjectId: sessionId, kind: "build_targets", actorKey: "user", details: { name: "sample", modules: ["sample"] } } });
  }
  await runs.enqueue({ sessionId, lane, trigger: lane === 'build' ? 'build' : 'message', prompt: 'Bounded work' });
  const run = (await runs.claimNext(lane))!;
  expect(run.deadlineAt.getTime() - ports.now().getTime()).toBe(minutes * 60_000);
  expect(run.leaseUntil).toEqual(run.deadlineAt);
});
test("one session never runs two lanes concurrently; other sessions remain independent", async () => {
  const runs = createRuns(ports, workspaceId);
  await runs.enqueue({ sessionId, lane: "foreground", trigger: "message", prompt: "One" });
  await runs.enqueue({ sessionId, lane: "background", trigger: "schedule", prompt: "Two" });
  expect(await runs.claimNext("foreground")).not.toBeNull();
  expect(await runs.claimNext("background")).toBeNull();
  const other = await db.session.create({ data: { workspaceId, key: "web:second", source: "web" } });
  await runs.enqueue({ sessionId: other.id, lane: "background", trigger: "schedule", prompt: "Separate" });
  expect((await runs.claimNext("background"))?.sessionId).toBe(other.id);
});
for (const scope of ["session", "global"] as const) test(`${scope} daily run limit defers until local midnight`, async () => {
  const runs = createRuns(ports, workspaceId);
  const other = await db.session.create({ data: { workspaceId, key: "web:other", source: "web" } });
  const count = scope === "session" ? RUN_LIMITS.maxRunsPerSessionPerDay : RUN_LIMITS.maxRunsPerDay;
  await db.run.createMany({ data: Array.from({ length: count }, (_, index) => ({ workspaceId, sessionId: scope === "session" ? sessionId : other.id, lane: "foreground", trigger: "message", status: "finished", provider: "fixture", tokenHash: `history-${index}`, cwd: "unused", prompt: "", startedAt: ports.now(), endedAt: ports.now() })) });
  const queued = await runs.enqueue({ sessionId, lane: "foreground", trigger: "message", prompt: "Limited" });
  expect(await runs.claimNext("foreground")).toBeNull();
  expect((await db.run.findUniqueOrThrow({ where: { id: queued.id } })).leaseUntil?.toISOString()).toBe("2026-10-15T16:00:00.000Z");
});
test("module wake seam creates fresh independent sessions and validates ownership", async () => {
  const module = await db.module.create({ data: { workspaceId, name: "fixture" } });
  const first = await enqueueModuleWake(ports, workspaceId, module.id, "One");
  const second = await enqueueModuleWake(ports, workspaceId, module.id, "Two");
  expect(first.sessionId).not.toBe(second.sessionId);
  const session = await db.session.findUniqueOrThrow({ where: { id: first.sessionId! } });
  expect(session.source).toBe("module"); expect(session.moduleId).toBe(module.id); expect(session.providerSessionId).toBeNull();
  await expect(enqueueModuleWake(ports, workspaceId, "missing", "No")).rejects.toMatchObject({ code: "not_found" });
});
