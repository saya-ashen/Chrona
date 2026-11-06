import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { testDb } from "./test-db";
import { createExecutorAuth } from "./executor-auth";
import { createExecutorControl } from "./executor-control";
import { createExecutionEventStore } from "./execution-event-store";
import { createRemoteExecutionSink } from "./executor-event-ingress";
import { createRemoteCompletion } from "./execution-remote-completion";
import { EXECUTOR_PROTOCOL, executorDigest, type ExecutorAssignment } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";

import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { createExecutions } from "./execution";
import { createRuns } from "./runs";
import { executionDigest } from "./execution-state";

async function setup() {
  const db = testDb(); let now = new Date();
  await db.workspace.create({ data: { id: "w-device", name: "Device controller test" } });
  const ports: StewardPorts = { db, now: () => now, dataDir: "/tmp/not-read", publicUrl: null };
  ports.executionEvents = createExecutionEventStore(ports);
  ports.remoteExecutionSink = createRemoteExecutionSink(ports);
  ports.remoteCompletion = createRemoteCompletion(ports);
  const control = createExecutorControl(ports), auth = createExecutorAuth(ports), credential = randomBytes(32).toString("hex");
  const code = await auth.createPairing({ workspaceId: "w-device", ownerId: "owner" });
  const receipt = await auth.pair(credential, { v: EXECUTOR_PROTOCOL, requestId: "pair", code: code.code, label: "Test" });
  const fence = { executorId: receipt.executorId, generation: 1, incarnation: "original" };
  const request = () => ({ v: EXECUTOR_PROTOCOL, requestId: crypto.randomUUID(), ...fence });
  const recovery = await auth.authenticateReconcile(credential, fence);
  expect(await control.controller.reconcile(recovery, { ...request(), entries: [], complete: true, after: null }, AbortSignal.timeout(1000))).toMatchObject({ reconciled: true });
  const who = await auth.authenticate(credential, fence, "active");
  return { db, ports, control, auth, credential, fence, request, who, now, setNow: (value: Date) => { now = value; } };
}
async function assignment(f: Awaited<ReturnType<typeof setup>>, index: number) {
  const session = await f.db.session.create({ data: { workspaceId: f.who.workspaceId, key: `device-${index}`, source: "web" } });
  const deadlineAt = new Date(f.now.getTime() + 60000);
  const run = await f.db.run.create({ data: { workspaceId: f.who.workspaceId, sessionId: session.id, lane: "background", trigger: "execution", provider: "fixed-device", prompt: "probe", cwd: "/tmp/server-log-not-device", status: "running", startedAt: f.now, deadlineAt, tokenHash: `hash-${index}` } });
  const attempt = await f.db.executionAttempt.create({ data: { workspaceId: f.who.workspaceId, ownerId: "owner", callerKey: "owner", workId: `work-${index}`, commandKey: `start-${index}`, requestDigest: "digest", runId: run.id, projectRef: "project", projectDigest: "mapping", resolvedCwd: null, logDir: run.cwd, baseline: `commit:${"a".repeat(40)}`, budget: { timeoutMs: 60000, maxToolCalls: 2 }, executorId: f.fence.executorId, executorGeneration: 1, directoryIdentity: "b".repeat(64), mappingRevision: 1, heldDirectory: `physical-${index}` } });
  const mapping = { executorId: f.fence.executorId, projectRef: "project", mappingRevision: 1, directoryIdentity: "b".repeat(64), baseline: { kind: "commit" as const, digest: "a".repeat(40) }, label: "Project" };
  let value!: ExecutorAssignment;
  await f.db.$transaction(async tx => {
    const target = await f.control.admission.reserve(tx, { ref: { workId: attempt.workId, runId: run.id, sessionId: session.id, attemptId: attempt.id }, fence: f.fence, mapping, deadlineAt });
    value = { ...target, executorId: f.fence.executorId, incarnation: f.fence.incarnation, mapping, workspaceRef: `workspace-${index}`, workspaceMode: "existing", goal: "Test", budget: { timeoutMs: 60000, maxToolCalls: 2 }, deadlineAt: deadlineAt.toISOString() };
    await f.control.admission.prepare(tx, value, await executorDigest(value));
    await f.ports.executionEvents!.admit(tx, { workspaceId: f.who.workspaceId, ownerId: f.who.ownerId, caller: { kind: "owner" } }, target);
  });
  return value;
}
async function independent(f: Awaited<ReturnType<typeof setup>>) {
  const [path] = await f.db.$queryRawUnsafe<{ file: string }[]>("PRAGMA database_list");
  return new PrismaClient({ adapter: new PrismaBunSqlite({ url: `file:${path!.file}` }) });
}
function cancel(f: Awaited<ReturnType<typeof setup>>, a: ExecutorAssignment) {
  return createExecutions(f.ports).cancel({ workspaceId: f.who.workspaceId, ownerId: f.who.ownerId, caller: { kind: "owner" } }, { op: "cancel", workId: a.workId, runId: a.runId, attemptId: a.attemptId, commandKey: "cancel" });
}
test.each(["cancel-first", "poll-first"])("independent SQLite writers: %s preserves offered ambiguity", async order => {
  const f = await setup(), other = await independent(f);
  try {
    const a = await assignment(f, 1);
    const poll = () => createExecutorControl({ ...f.ports, db: other }).controller.poll(f.who, { ...f.request(), waitMs: 0 }, AbortSignal.timeout(1000));
    if (order === "poll-first") expect((await poll()).launches).toHaveLength(1);
    const view = await cancel(f, a);
    expect(view.stopConfirmed).toBe(order === "cancel-first");
    const row = await f.db.executionAttempt.findUniqueOrThrow({ where: { id: a.attemptId }, include: { run: true, assignment: true } });
    if (order === "cancel-first") {
      expect(row.run.status).toBe("cancelled"); expect(row.heldDirectory).toBeNull();
      expect(row.assignment?.tombstoneDigest).toBe(executionDigest({ assignmentId: a.assignmentId, launchDigest: row.assignment?.launchDigest, kind: "never_offered" }));
      expect((await poll()).launches).toHaveLength(0);
      expect(row.assignment?.final).toBeNull(); expect(row.assignment?.finalizedAt).toBeNull();
    } else { expect(row.run.status).toBe("running"); expect(row.heldDirectory).not.toBeNull(); }
  } finally { await other.$disconnect(); await f.db.$disconnect(); }
});
test.each(["startedAt", "processIdentity", "sourceHighWatermark", "sourceProducedThrough", "receiptCount", "receiptBytes", "finalDigest", "final", "finalizedAt", "tombstoneDigest", "sourceReceipt"])("unoffered %s is progress, never stop proof", async field => {
  const f = await setup();
  try {
    const a = await assignment(f, 1);
    const value = field.endsWith("At") ? f.now : ["processIdentity", "final", "sourceReceipt"].includes(field) ? { unexpected: true } : ["finalDigest", "tombstoneDigest"].includes(field) ? "f".repeat(64) : 1;
    if (field === "sourceReceipt") await f.db.executionAttempt.update({ where: { id: a.attemptId }, data: { sourceReceipt: { unexpected: true } } });
    else await f.db.executorAssignment.update({ where: { attemptId: a.attemptId }, data: { [field]: value } });
    expect((await cancel(f, a)).stopConfirmed).toBe(false);
    expect((await f.db.executionAttempt.findUniqueOrThrow({ where: { id: a.attemptId } })).heldDirectory).not.toBeNull();
  } finally { await f.db.$disconnect(); }
});
test("expiry confirms only never-offered; completion outbox rolls back atomically", async () => {
  const f = await setup();
  try {
    const a = await assignment(f, 1); f.setNow(new Date(f.now.getTime() + 60_001));
    f.ports.onExecutionFinishedIn = async () => { throw new Error("outbox failure"); };
    await expect(createRuns(f.ports, f.who.workspaceId).expireLeases()).rejects.toThrow("outbox failure");
    expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: a.attemptId } })).toMatchObject({ stopConfirmedAt: null, capabilityRevokedAt: null });
    expect((await f.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: a.attemptId } })).tombstoneDigest).toBeNull();
    f.ports.onExecutionFinishedIn = undefined;
    await createRuns(f.ports, f.who.workspaceId).expireLeases();
    expect(await f.db.run.findUniqueOrThrow({ where: { id: a.runId } })).toMatchObject({ status: "timed_out" });
    expect((await f.db.executionAttempt.findUniqueOrThrow({ where: { id: a.attemptId } })).heldDirectory).toBeNull();
  } finally { await f.db.$disconnect(); }
});

test("expiry rechecks stale candidate after independent writer renews lease", async () => {
  const f = await setup(), other = await independent(f);
  try {
    const a = await assignment(f, 1), now = new Date(f.now.getTime() + 10_000);
    f.setNow(now);
    await f.db.run.update({ where: { id: a.runId }, data: { leaseUntil: new Date(now.getTime() - 1) } });
    const db = new Proxy(f.db, { get(target, key) {
      if (key !== "run") return Reflect.get(target, key);
      return new Proxy(target.run, { get(model, property) {
        if (property !== "findMany") return Reflect.get(model, property);
        return async (...args: Parameters<typeof model.findMany>) => {
          const candidates = await model.findMany(...args);
          await other.$transaction(async tx => {
            await tx.$executeRaw`UPDATE "Workspace" SET "id"="id" WHERE "id"=${f.who.workspaceId}`;
            await tx.run.update({ where: { id: a.runId }, data: { leaseUntil: new Date(now.getTime() + 30_000) } });
          });
          return candidates;
        };
      } });
    } });
    await createRuns({ ...f.ports, db }, f.who.workspaceId).expireLeases();
    expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: a.attemptId } })).toMatchObject({ stopConfirmedAt: null, capabilityRevokedAt: null });
    expect((await f.db.run.findUniqueOrThrow({ where: { id: a.runId } })).status).toBe("running");
  } finally { await other.$disconnect(); await f.db.$disconnect(); }
});
test.each(["cancel-first", "poll-first"])("independent Bun process writer ordering: %s", async order => {
  const f = await setup();
  const children: ReturnType<typeof Bun.spawn>[] = [];
  const timer = setTimeout(() => { for (const child of children) if (child.exitCode === null) child.kill("SIGKILL"); }, 10_000);
  try {
    const a = await assignment(f, 1);
    const [path] = await f.db.$queryRawUnsafe<{ file: string }[]>("PRAGMA database_list");
    const script = join(mkdtempSync(join(tmpdir(), "chrona-never-offered-test-")), "writer.ts");
    writeFileSync(script, `
      import { PrismaClient } from ${JSON.stringify(import.meta.resolve("@chrona/db/generated/prisma/client"))};
      import { PrismaBunSqlite } from ${JSON.stringify(import.meta.resolve("prisma-adapter-bun-sqlite"))};
      import { createExecutions } from ${JSON.stringify(import.meta.resolve("./execution"))};
      import { createExecutorControl } from ${JSON.stringify(import.meta.resolve("./executor-control"))};
      import { createExecutionEventStore } from ${JSON.stringify(import.meta.resolve("./execution-event-store"))};
      const db = new PrismaClient({adapter:new PrismaBunSqlite({url:${JSON.stringify(`file:${path!.file}`)}})});
      const ports = {db,now:()=>new Date(${JSON.stringify(f.now.toISOString())}),dataDir:"/tmp/not-read",publicUrl:null};
      ports.executionEvents=createExecutionEventStore(ports);
      console.log("ready");
      for await(const line of console) {
        if(line === "poll") console.log(JSON.stringify(await createExecutorControl(ports).controller.poll(${JSON.stringify(f.who)},${JSON.stringify({ ...f.request(), waitMs: 0 })},AbortSignal.timeout(3000))));
        else console.log(JSON.stringify(await createExecutions(ports).cancel(${JSON.stringify({ workspaceId: f.who.workspaceId, ownerId: f.who.ownerId, caller: { kind: "owner" } })},${JSON.stringify({ op: "cancel", workId: a.workId, runId: a.runId, attemptId: a.attemptId, commandKey: "process-cancel" })})));
        break;
      }
      await db.$disconnect();
    `);
    for (const operation of order === "cancel-first" ? ["cancel", "poll"] : ["poll", "cancel"]) {
      const child = Bun.spawn([process.execPath, script], { cwd: process.cwd(), stdin: "pipe", stdout: "pipe", stderr: "pipe" }); children.push(child);
      const reader = child.stdout.getReader(); expect(new TextDecoder().decode((await reader.read()).value)).toBe("ready\n");
      child.stdin.write(operation + "\n"); child.stdin.end();
      let output = ""; for (;;) { const next = await reader.read(); if (next.done) break; output += new TextDecoder().decode(next.value); }
      expect(await child.exited, await new Response(child.stderr).text()).toBe(0);
      const value = JSON.parse(output);
      if (operation === "poll") expect(value.launches).toHaveLength(order === "poll-first" ? 1 : 0);
    }
    const row = await f.db.executionAttempt.findUniqueOrThrow({ where: { id: a.attemptId } });
    expect(!!row.stopConfirmedAt).toBe(order === "cancel-first");
  } finally { clearTimeout(timer); for (const child of children) if (child.exitCode === null) child.kill("SIGKILL"); await Promise.all(children.map(child => child.exited)); await f.db.$disconnect(); }
}, 15_000);
