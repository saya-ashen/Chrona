import { afterEach, expect, test } from "bun:test";
import { appendRunEventIn, retainedToolOutput } from "./run-events";
import { testDb } from "../__testing__/test-db";

let db: ReturnType<typeof testDb> | undefined;
afterEach(async () => { await db?.$disconnect(); db = undefined; });

test.each([
  ["ordinary", { receiptId: "receipt", members: [{ hash: "abc" }] }, false, "complete"],
  ["credential field", { password: "private" }, false, "filtered"],
  ["credential text", { text: "Bearer private-token" }, false, "filtered"],
  ["oversized text", { result: "x".repeat(40000) }, false, "filtered"],
  ["sensitive tool", { receiptId: "receipt" }, true, "omitted"],
] as const)("%s retains an explicit completeness marker", (_name, output, sensitive, state) => {
  const result = retainedToolOutput(output, sensitive);
  expect(result.outputState).toBe(state);
  expect(JSON.stringify(result)).not.toContain("private");
  if (state === "complete") expect(result.output).toEqual(output);
});

test("telemetry and tool results share a transactional cursor, with no gaps after rollback", async () => {
  db = testDb();
  const workspace = await db.workspace.create({ data: { name: "events" } });
  const run = await db.run.create({ data: { workspaceId: workspace.id, lane: "foreground", trigger: "source", provider: "fake", tokenHash: "test", prompt: "", cwd: "/tmp" } });
  const at = new Date();
  await db.$transaction(tx => appendRunEventIn(tx, run.id, "progress", { phase: "working" }, at));
  await expect(db.$transaction(async tx => { await appendRunEventIn(tx, run.id, "tool-result", {}, at); throw new Error("rollback"); })).rejects.toThrow("rollback");
  await db.$transaction(tx => appendRunEventIn(tx, run.id, "tool-result", { callId: "actual" }, at));
  expect((await db.runEvent.findMany({ where: { runId: run.id }, orderBy: { sequence: "asc" } })).map(row => [row.sequence, row.kind])).toEqual([[1, "progress"], [2, "tool-result"]]);
});

test("Run finalization retains outstanding tool identity as unknown and a late actual receipt can reconcile it", async () => {
  db = testDb();
  const workspace = await db.workspace.create({ data: { name: "interrupted tool" } });
  const run = await db.run.create({ data: { workspaceId: workspace.id, lane: "foreground", trigger: "source", provider: "fake", tokenHash: "interrupted", prompt: "", cwd: "/tmp", status: "running" } });
  const call = await db.moduleInvocation.create({ data: { workspaceId: workspace.id, runId: run.id, caller: "module:entry", target: "result", tool: "write", key: "one", args: { input: "not part of result evidence" }, mode: "sync", status: "running", targetBound: true, targetModuleId: "exact-application", targetHash: "old-version", targetContractHash: "a".repeat(64) } });
  const { createRuns } = await import("./runs");
  const ports = { db, dataDir: "/tmp", publicUrl: null, now: () => new Date() };
  await createRuns(ports, workspace.id).finish(run.id, { outcome: "failed", sessionId: null, error: "Provider exited" }, { stopEvidence: "provider_exited" });
  expect(await db.moduleInvocation.findUniqueOrThrow({ where: { id: call.id } })).toMatchObject({ status: "unknown", runId: run.id });
  const uncertain = await db.runEvent.findFirstOrThrow({ where: { runId: run.id, kind: "tool-result" } });
  expect(uncertain.payload).toMatchObject({ value: { callId: call.id, runId: run.id, moduleId: "exact-application", hash: "old-version", status: "unknown", outputState: "omitted", output: null } });
  expect(JSON.stringify(uncertain.payload)).not.toContain("not part of result evidence");
  const { appendRunToolResultIn } = await import("./run-events");
  await db.$transaction(async tx => {
    const actual = await tx.moduleInvocation.update({ where: { id: call.id }, data: { status: "succeeded", output: { receiptId: "original-call" } } });
    await appendRunToolResultIn(tx, actual, ports.now(), false);
  });
  expect(await db.moduleInvocation.count()).toBe(1);
  const events = await db.runEvent.findMany({ where: { runId: run.id }, orderBy: { sequence: "asc" } });
  expect(events.map(row => row.sequence)).toEqual([1, 2]);
  expect(events[1]!.payload).toMatchObject({ value: { callId: call.id, status: "succeeded", outputState: "complete", output: { receiptId: "original-call" } } });
});
