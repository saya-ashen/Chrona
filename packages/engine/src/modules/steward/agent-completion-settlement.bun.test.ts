import { afterEach, expect, test } from "bun:test";
import { approvedCompletionFixture } from "./agent-completion-settlement.fixture";
import { settleRunCompletion } from "./agent-completion-settlement";
import { finishRunFromProviderStatus } from "./agent-provider-finalization";
import { reconcileAgentStops } from "./agent-recovery";
import { startLocalProvider } from "./local-runtime";
import { createRuns } from "./runs";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); }, 30000);
const finished = { outcome: "finished" as const, sessionId: null, error: null };
const result = { text: "durable late completion: api_key=private-provider-value", inputTokens: 2, outputTokens: 3 };

async function assertSettled(f: Awaited<ReturnType<typeof approvedCompletionFixture>>, status: string, events: number) {
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { method: "model" } })).toMatchObject({ status, inputTokens: status === "executed" ? 2 : null, outputTokens: status === "executed" ? 3 : null });
  expect(await f.db.runEvent.count({ where: { runId: f.runId, kind: "completion" } })).toBe(events);
  expect(await f.db.audit.count({ where: { kind: "module_model_call", subjectId: f.caller.moduleId } })).toBe(1);
  expect(f.requests.filter(name => name === "complete")).toHaveLength(1);
  expect(f.releases.every(release => release.status === status && release.events === events)).toBe(true);
}

test.each(["recover", "stop"])("%s retains late completion and tokens before confirming actual stop; repeated settlement is idempotent", async path => {
  const f = await approvedCompletionFixture(cleanups);
  await f.becomeUnknown();
  await reconcileAgentStops(f.ports, f.workspaceId);
  expect(await f.invoke("read", { runId: f.runId })).toMatchObject({ run: { status: "unknown", active: true }, ended: false });
  expect(f.releases).toEqual([]);
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { method: "model" } })).toMatchObject({ status: "pending", inputTokens: null, outputTokens: null });
  const late = { operationId: f.runId, outcome: finished, failure: false, completion: result };
  f.setStatus(late);
  if (path === "stop") expect(await f.invoke("stop", { runId: f.runId }, "late-stop")).toMatchObject({ status: "cancelled", active: false, stopConfirmed: true });
  else await reconcileAgentStops(f.ports, f.workspaceId);
  expect(await f.invoke("read", { runId: f.runId })).toMatchObject({ run: { status: path === "stop" ? "cancelled" : "finished", active: false }, ended: true, items: [{ kind: "completion", payload: { text: "durable late completion: api_key=[redacted]", inputTokens: 2, outputTokens: 3 } }] });
  expect(await f.db.run.findUniqueOrThrow({ where: { id: f.runId } })).toMatchObject({ stopStatus: "confirmed", cancelRequestedAt: path === "stop" ? expect.any(Date) : null });
  // Exercise both a repeat scan and a stale concurrent observer after the Run already finished.
  await reconcileAgentStops(f.ports, f.workspaceId);
  await Promise.all([settleRunCompletion(f.ports, f.workspaceId, f.runId, { result }), finishRunFromProviderStatus(f.ports, f.workspaceId, f.runId, late)]);
  await f.invoke("stop", { runId: f.runId }, "repeat-stop");
  await assertSettled(f, "executed", 1);
  expect(f.releases.length).toBeGreaterThan(0);
  expect(await f.db.audit.count({ where: { kind: "run_finished", subjectId: f.runId } })).toBe(2); // unknown, then confirmed
});

test.each(["recover", "stop"])("%s keeps a finished receipt with missing result unknown and holds accounting and capacity", async path => {
  const f = await approvedCompletionFixture(cleanups);
  await f.becomeUnknown();
  for (const completion of [undefined, null]) {
    f.setStatus({ outcome: finished, failure: false, ...(completion === undefined ? {} : { completion }) });
    if (path === "stop") expect(await f.invoke("stop", { runId: f.runId }, `missing-${completion}`)).toMatchObject({ status: "unknown", active: true, stopConfirmed: false });
    else await reconcileAgentStops(f.ports, f.workspaceId);
  }
  await expect(settleRunCompletion(f.ports, f.workspaceId, f.runId, { outcome: finished })).rejects.toMatchObject({ code: "unknown" });
  expect(await f.db.run.findUniqueOrThrow({ where: { id: f.runId } })).toMatchObject({ stopStatus: "unknown" });
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { method: "model" } })).toMatchObject({ status: "pending", inputTokens: null, outputTokens: null });
  expect(await f.db.audit.count({ where: { kind: "module_model_call" } })).toBe(0);
  expect(f.releases).toEqual([]);
  await expect(f.invoke("run", { kind: "completion", prompt: "blocked", contextId: (await f.db.run.findUniqueOrThrow({ where: { id: f.runId } })).sessionId }, "blocked")).rejects.toMatchObject({ code: "conflict" });
  expect(f.requests.filter(name => name === "complete")).toHaveLength(1);
});

test.each([
  { name: "invalid counters", completion: { ...result, outputTokens: -1 }, error: "Invalid provider completion result" },
  { name: "invalid text", completion: { ...result, text: 42 }, error: "Invalid provider completion result" },
  { name: "output overrun", completion: { ...result, outputTokens: 11 }, error: "Provider exceeded completion output budget" },
  { name: "retention overrun", completion: { ...result, text: "x".repeat(65536) }, error: "Provider completion result could not be retained" },
])("late $name settles explicit failure without retaining invalid output", async ({ completion, error }) => {
  const f = await approvedCompletionFixture(cleanups);
  await f.becomeUnknown();
  f.setStatus({ outcome: finished, failure: false, completion });
  await reconcileAgentStops(f.ports, f.workspaceId);
  expect(await f.db.run.findUniqueOrThrow({ where: { id: f.runId } })).toMatchObject({ status: "failed", stopStatus: "confirmed", error });
  await assertSettled(f, "failed", 0);
  expect(f.releases).toHaveLength(1);
  await reconcileAgentStops(f.ports, f.workspaceId);
  expect(await settleRunCompletion(f.ports, f.workspaceId, f.runId, { result })).toMatchObject({ outcome: "failed" });
  await assertSettled(f, "failed", 0);
});

test.each(["failed", "timed_out", "unavailable"])("confirmed non-finished %s settles failure before finalization", async outcome => {
  const f = await approvedCompletionFixture(cleanups);
  await f.becomeUnknown();
  f.setStatus({ outcome: { outcome, sessionId: null, error: "Provider stopped" }, failure: false });
  await reconcileAgentStops(f.ports, f.workspaceId);
  expect(await f.db.run.findUniqueOrThrow({ where: { id: f.runId } })).toMatchObject({ status: outcome === "unavailable" ? "provider_unavailable" : outcome, stopStatus: "confirmed" });
  await assertSettled(f, "failed", 0);
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { method: "model" } })).toMatchObject({ error: outcome === "timed_out" ? "timeout" : "provider_error" });
});

test("live observer shares settlement and explicitly fails output overrun", async () => {
  const f = await approvedCompletionFixture(cleanups);
  f.setStatus({ outcome: finished, failure: false, completion: { ...result, outputTokens: 11 } });
  const handle = await startLocalProvider(f.ports, f.workspaceId, f.input);
  expect(await handle.done).toMatchObject({ outcome: "failed", error: "Provider exceeded completion output budget" });
  await assertSettled(f, "failed", 0);
  expect(f.releases).toHaveLength(1);
});

test("accounting failure rolls back the result event and prevents Run finalization and release", async () => {
  const f = await approvedCompletionFixture(cleanups);
  await f.becomeUnknown();
  f.setStatus({ outcome: finished, failure: false, completion: result });
  await f.db.$executeRawUnsafe(`CREATE TRIGGER fail_completion_settlement BEFORE UPDATE OF status ON ModuleCall WHEN OLD.method = 'model' AND NEW.status = 'executed' BEGIN SELECT RAISE(ABORT, 'fixture settlement failure'); END`);
  await expect(reconcileAgentStops(f.ports, f.workspaceId)).rejects.toThrow();
  expect(await f.db.runEvent.count({ where: { kind: "completion" } })).toBe(0);
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { method: "model" } })).toMatchObject({ status: "pending" });
  expect(await f.db.run.findUniqueOrThrow({ where: { id: f.runId } })).toMatchObject({ stopStatus: "unknown" });
  expect(f.releases).toEqual([]);
  await f.db.$executeRawUnsafe("DROP TRIGGER fail_completion_settlement");
  await reconcileAgentStops(f.ports, f.workspaceId);
  await assertSettled(f, "executed", 1);
});

test("mismatched operation or reservation ownership cannot settle a completion", async () => {
  const f = await approvedCompletionFixture(cleanups);
  await f.becomeUnknown();
  f.setStatus({ operationId: "another-operation", outcome: finished, failure: false, completion: result });
  await reconcileAgentStops(f.ports, f.workspaceId);
  expect(await f.db.run.findUniqueOrThrow({ where: { id: f.runId } })).toMatchObject({ stopStatus: "unknown" });
  f.setStatus({ outcome: finished, failure: false, completion: result });
  await f.db.moduleCall.updateMany({ where: { method: "model" }, data: { hash: "other-version" } });
  await expect(reconcileAgentStops(f.ports, f.workspaceId)).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { method: "model" } })).toMatchObject({ status: "pending" });
  expect(await f.db.runEvent.count({ where: { kind: "completion" } })).toBe(0);
  expect(f.releases).toEqual([]);
  await f.db.agentRunProvider.update({ where: { runId: f.runId }, data: { kind: "conversation" } });
  await expect(settleRunCompletion(f.ports, f.workspaceId, f.runId, { result })).rejects.toMatchObject({ code: "conflict" });
});

test("live settlement and late recovery retain one redacted event and one accounting audit", async () => {
  const f = await approvedCompletionFixture(cleanups);
  const completion = { ...result, text: `${f.input.token} api_key=private-provider-value` };
  f.setStatus({ outcome: finished, failure: false, completion });
  const handle = await startLocalProvider(f.ports, f.workspaceId, f.input);
  expect(await handle.done).toEqual(finished);
  await createRuns(f.ports, f.workspaceId).finish(f.runId, finished, { stopEvidence: "provider_exited" });
  await finishRunFromProviderStatus(f.ports, f.workspaceId, f.runId, { operationId: f.runId, outcome: finished, completion, failure: false });
  await assertSettled(f, "executed", 1);
  expect((await f.db.runEvent.findFirstOrThrow({ where: { kind: "completion" } })).payload).toMatchObject({ text: "[redacted] api_key=[redacted]" });
});
