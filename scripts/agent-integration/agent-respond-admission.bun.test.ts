import { afterEach, expect, test } from "bun:test";
import { z } from "zod";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionPrincipal, ProviderInteraction } from "@chrona/contracts/steward";
import { testDb } from "../../packages/engine/src/modules/steward/test-db";
import type { StewardPorts } from "../../packages/engine/src/modules/steward/ports";
import { createExecutions } from "../../packages/engine/src/modules/steward/execution";
import { createExecutionEventStore } from "../../packages/engine/src/modules/steward/execution-event-store";
import { createRuns, liveRuns } from "../../packages/engine/src/modules/steward/runs";
import { createProviderChannel } from "../../packages/engine/src/modules/steward/provider-channel";
import { admitAgentPrimitive } from "../../packages/engine/src/modules/steward/agent-primitives";
import { isExecutionControlRejected } from "../../packages/engine/src/modules/steward/execution-control-error";
import { StewardError } from "../../packages/engine/src/modules/steward/errors";
import { createAgentPrimitives } from "../../packages/engine/src/modules/steward/builtin/agent/primitives";
import { primitiveOutputs } from "@chrona/contracts/steward";
import manifest from "../../packages/engine/src/modules/steward/builtin/agent/module.json";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); liveRuns.clear(); });

async function fixture() {
  const db = testDb({ injectedAgent: false });
  const root = await mkdtemp(join(tmpdir(), "chrona-agent-respond-"));
  cleanup.push(async () => { await db.$disconnect(); await rm(root, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "respond-admission" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "respond-caller", activeHash: "hash", status: "active" } });
  const principal: ExecutionPrincipal = { workspaceId: workspace.id, ownerId: "owner", caller: { kind: "module", moduleId: module.id, hash: "hash" } };
  let now = new Date("2026-11-09T10:00:00Z");
  const ports: StewardPorts = { db, dataDir: root, publicUrl: null, now: () => now,
    resolveExecutionProject: async (_, projectRef) => ({ projectRef, executor: "server", canonicalPath: root, baseline: "commit:fixture" }) };
  ports.executionEvents = createExecutionEventStore(ports);
  const service = ports.executions = createExecutions(ports);
  const ref = await service.start(principal, { workId: "work", commandKey: "start", projectRef: "project", goal: "Offline fixture", budget: { timeoutMs: 60_000, maxToolCalls: 5 } });
  const run = (await createRuns(ports, workspace.id).claimNext("background"))!;
  liveRuns.set(run.id, { inject: async () => {}, abort: async () => {}, done: new Promise(() => {}) });
  let publish!: (request: ProviderInteraction) => void;
  const published = new Promise<ProviderInteraction>(resolve => { publish = resolve; });
  let answers = 0;
  const channel = createProviderChannel(ports, run, async request => {
    if (request.status === "pending") publish(request);
    if (request.status === "answered") answers++;
  });
  cleanup.push(() => channel.close());
  const waiting = channel.events.question({ method: "confirm", title: "Continue?", message: "Offline question", options: [], timeoutMs: 30_000 }, new AbortController().signal);
  const question = await published;
  const args = { executionId: ref.workId, runId: ref.runId, attemptId: ref.attemptId, requestKey: "answer", questionId: question.id, answer: JSON.stringify({ decision: "submit", value: true }) };
  const command = { ...ref, op: "answer" as const, commandKey: args.requestKey, requestId: question.id, answer: { decision: "submit" as const, value: true } };
  return { db, ports, principal, service, args, command, waiting, answers: () => answers,
    respond: () => admitAgentPrimitive(ports, principal, "respond", args),
    expire: () => { now = new Date("2026-11-09T10:00:31Z"); } };
}

const expired = { accepted: false, error: { code: "conflict", message: "Provider interaction is no longer active" } } as const;
test("expiry before admission explicitly rejects, rolls back the key, and preserves legacy errors", async () => {
  const f = await fixture(); f.expire();
  expect(await f.respond()).toEqual(expired);
  expect(await f.db.executionCommand.count()).toBe(0);
  expect(f.answers()).toBe(0);
  try { await f.service.answer(f.principal, f.command); throw new Error("Expected rejection"); }
  catch (error) {
    expect(error).toBeInstanceOf(StewardError);
    expect(error).toMatchObject(expired.error);
    expect(isExecutionControlRejected(error)).toBe(true);
  }
});

test("a request lost before admission then retried after expiry explicitly rejects", async () => {
  const f = await fixture(), answer = f.service.answer;
  f.service.answer = async () => { throw new Error("Request lost before arrival"); };
  await expect(f.respond()).rejects.toThrow("Request lost before arrival");
  expect(await f.db.executionCommand.count()).toBe(0);
  f.service.answer = answer; f.expire();
  expect(await f.respond()).toEqual(expired);
  expect(await f.db.executionCommand.count()).toBe(0);
  expect(f.answers()).toBe(0);
});

test("admitted answer with lost response replays accepted after question and run expiry without redelivery", async () => {
  const f = await fixture(), answer = f.service.answer;
  f.service.answer = async (...args) => { await answer(...args); throw new Error("Accepted response lost"); };
  await expect(f.respond()).rejects.toThrow("Accepted response lost");
  expect(await f.waiting).toEqual(f.command.answer);
  expect(f.answers()).toBe(1);
  f.service.answer = answer; f.expire();
  await f.db.run.update({ where: { id: f.args.runId }, data: { status: "timed_out" } });
  liveRuns.delete(f.args.runId);
  expect(await f.respond()).toEqual({ accepted: true });
  expect(await f.db.executionCommand.count()).toBe(1);
  expect(await f.db.runInteraction.count({ where: { status: { not: "pending" } } })).toBe(1);
  expect(f.answers()).toBe(1);
});

test("unknown delivery storage failure stays thrown after durable acceptance", async () => {
  const f = await fixture();
  await f.db.$executeRawUnsafe("CREATE TRIGGER fail_answer_delivery BEFORE UPDATE OF status ON RunInteraction WHEN NEW.status != 'pending' BEGIN SELECT RAISE(ABORT, 'Synthetic delivery failure'); END");
  try {
    await expect(f.respond()).rejects.toThrow();
    expect(await f.db.executionCommand.count()).toBe(1);
    expect(await f.waiting).toEqual({ decision: "cancel" });
    expect(f.answers()).toBe(0);
    f.expire();
    expect(await f.respond()).toEqual({ accepted: true });
    expect(await f.db.runInteraction.count({ where: { status: { not: "pending" } } })).toBe(0);
  } finally { await f.db.$executeRawUnsafe("DROP TRIGGER fail_answer_delivery"); }
});

test("a live-state conflict during delivery is unknown rather than explicit non-admission", async () => {
  const f = await fixture();
  await f.db.$executeRawUnsafe("CREATE TRIGGER stop_after_admission AFTER INSERT ON ExecutionCommand BEGIN UPDATE Run SET status = 'failed' WHERE id = (SELECT runId FROM ExecutionAttempt WHERE id = NEW.attemptId); END");
  try {
    try { await f.respond(); throw new Error("Expected delivery conflict"); }
    catch (error) {
      expect(error).toMatchObject({ code: "conflict", message: "Run is no longer active" });
      expect(isExecutionControlRejected(error)).toBe(false);
    }
    expect(await f.db.executionCommand.count()).toBe(1);
    f.expire();
    expect(await f.respond()).toEqual({ accepted: true });
    expect(f.answers()).toBe(0);
  } finally { await f.db.$executeRawUnsafe("DROP TRIGGER stop_after_admission"); }
});

test("admission database failure remains thrown and rolls back the command", async () => {
  const f = await fixture();
  await f.db.$executeRawUnsafe("CREATE TRIGGER fail_command_storage BEFORE INSERT ON ExecutionCommand BEGIN SELECT RAISE(ABORT, 'Synthetic admission storage failure'); END");
  try {
    await expect(f.respond()).rejects.toThrow();
    expect(await f.db.executionCommand.count()).toBe(0);
    expect(f.answers()).toBe(0);
  } finally { await f.db.$executeRawUnsafe("DROP TRIGGER fail_command_storage"); }
});

test.each(["live", "invalid"])("known %s validation rejects before command consumption", async kind => {
  const f = await fixture();
  if (kind === "live") liveRuns.delete(f.args.runId);
  else f.args.answer = JSON.stringify({ decision: "submit", value: "invalid confirm" });
  expect(await f.respond()).toMatchObject({ accepted: false, error: { code: kind === "live" ? "conflict" : "invalid" } });
  expect(await f.db.executionCommand.count()).toBe(0);
  expect(f.answers()).toBe(0);
});

test("Agent respond contract and callback retain explicit false and existing success", async () => {
  const callback = createAgentPrimitives(async () => expired, async () => { throw new Error("Unexpected process control"); });
  const f = await fixture();
  expect(primitiveOutputs.respond.parse(await callback("respond", f.args, "call"))).toEqual(expired);
  expect(primitiveOutputs.respond.parse({ accepted: true })).toEqual({ accepted: true });
  expect(primitiveOutputs.respond.safeParse({ accepted: false }).success).toBe(false);
  const schema: unknown = manifest.tools.find(tool => tool.name === "respond")!.output;
  const { $schema: _schema, ...expected } = z.toJSONSchema(primitiveOutputs.respond);
  expect(schema).toEqual(expected);
});
