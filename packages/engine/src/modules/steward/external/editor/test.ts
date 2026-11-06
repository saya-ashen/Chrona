import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { EXECUTION_PROTOCOL, EDITOR_HTTP, executionInputSchemas, editorResponseSchema, editorRequestSchema, type ExecutionCommand, type ExecutionEventPage } from "./contract.js";
import { editorCommands, handleEditorCommand, parseEditorEventsQuery } from "./protocol";
import { pollEditorEvents } from "./poll";
// @ts-expect-error Chrona supplies the isolated author test kernel.
import { startModule } from "chrona/testing";

if (process.env.CHRONA_EXECUTION_FIXTURES) {
  const fixtures = JSON.parse(await readFile(process.env.CHRONA_EXECUTION_FIXTURES, "utf8")) as { requests: { name: string; valid: boolean; value: unknown }[]; responses: { name: string; valid: boolean; value: unknown }[] };
  for (const item of fixtures.requests) assert.equal(editorRequestSchema.safeParse(item.value).success, item.valid, item.name);
  for (const item of fixtures.responses) assert.equal(editorResponseSchema.safeParse(item.value).success, item.valid, item.name);
}
const query = new URLSearchParams({ v: EXECUTION_PROTOCOL, requestId: "req", workId: "w", runId: "r", attemptId: "a", limit: "100", waitMs: "15000" });
assert.equal(parseEditorEventsQuery(query).waitMs, 15000);
query.append("limit", "1");
assert.throws(() => parseEditorEventsQuery(query), { code: "invalid" });
query.delete("limit"); query.set("limit", "1"); query.set("owner", "forged");
assert.throws(() => parseEditorEventsQuery(query));
const command: Extract<ExecutionCommand, { op: "events" }> = { op: "events", workId: "w", runId: "r", attemptId: "a", limit: 1, waitMs: 15000 };
const empty: ExecutionEventPage = { events: [], cursor: "next", highWatermark: 0, gap: false, snapshotRequired: false };
const original = editorCommands.events;
let reads = 0;
editorCommands.events = async input => { assert.equal(input.waitMs, 0); reads++; return empty; };
try {
  // Abort frees all HTTP slots promptly, including repeated four-reader cycles.
  for (let cycle = 0; cycle < 3; cycle++) {
    const controllers = Array.from({ length: 4 }, () => new AbortController());
    const waiting = controllers.map(controller => pollEditorEvents(new Request("http://module/events", { signal: controller.signal }), command));
    await assert.rejects(pollEditorEvents(new Request("http://module/events"), command), { code: "capacity", retryAfterMs: 250 });
    const started = Date.now();
    controllers.forEach(controller => controller.abort());
    const replies = await Promise.allSettled(waiting);
    assert.ok(replies.every(reply => reply.status === "rejected" && reply.reason.name === "AbortError"));
    assert.ok(Date.now() - started < 500);
  }
  assert.equal(reads, 12);
  assert.deepEqual(await pollEditorEvents(new Request("http://module/events"), { ...command, waitMs: 0 }), empty);
  editorCommands.events = async () => { throw Object.assign(new Error("missing"), { code: "not_found" }); };
  await assert.rejects(pollEditorEvents(new Request("http://module/events"), command), { code: "not_found" });
  editorCommands.events = async () => empty;
  assert.deepEqual(await pollEditorEvents(new Request("http://module/events"), { ...command, waitMs: 0 }), empty);
  // No business cancel and no pending G fifteen-second RPC after abort.
  editorCommands.events = () => new Promise(() => {});
  const controller = new AbortController();
  const read = pollEditorEvents(new Request("http://module/events", { signal: controller.signal }), command);
  controller.abort();
  await assert.rejects(read, { name: "AbortError" });
} finally { editorCommands.events = original; }
assert.deepEqual(await handleEditorCommand({ op: "detach", workId: "w" }), { accepted: true });

const calls: { target: string; input: Record<string, unknown> }[] = [];
const view = { workId: "w", sessionId: "actual-session", runId: "r", attemptId: "a", projectRef: "repo", status: "running", cancelRequested: false, stopConfirmed: false };
const stubs = Object.fromEntries(["create", "get", "list", "send", "answer", "cancel", "results", "accept"].map(tool => [`coding.${tool}`, (input: Record<string, unknown>) => {
  calls.push({ target: `coding.${tool}`, input: JSON.parse(String(input.input)) });
  if (tool === "list") return { works: [view], after: null };
  if (tool === "results") return { results: [] };
  if (["send", "answer", "accept"].includes(tool)) return { accepted: true };
  return view;
}]));
const runtime = await startModule("index.ts", { stubs: {
  ...stubs,
  "executions.lookup-start": (input: Record<string, unknown>) => { calls.push({ target: "executions.lookup-start", input }); return view; },
  "executions.events": (input: Record<string, unknown>) => { calls.push({ target: "executions.events", input }); executionInputSchemas.events.parse(input); assert.equal(input.waitMs, 0); return empty; },
  "executions.snapshot": (input: Record<string, unknown>) => { calls.push({ target: "executions.snapshot", input }); executionInputSchemas.snapshot.parse(input); return { workId: "w", sessionId: "actual-session", runId: "r", attemptId: "a", status: "running", cancelRequested: false, stopConfirmed: false, highWatermark: 0, finalMessage: null, questions: [], missing: false, expiresAt: "2026-12-01T00:00:00Z" }; },
} });
async function post(command: object, requestId = "req") {
  const response = await fetch(`http://module${EDITOR_HTTP.commands}`, { unix: runtime.httpSocket, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ v: EXECUTION_PROTOCOL, requestId, command }) });
  const body = await response.json();
  assert.ok(editorResponseSchema.safeParse(body).success);
  return { status: response.status, body };
}
try {
  const now = "2026-11-05T00:00:00Z";
  await runtime.send({ trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} });
  assert.equal((await post({ op: "start", workId: "w", projectRef: "repo", commandKey: "key", goal: "fix", budget: { timeoutMs: 1000, maxToolCalls: 1 } })).status, 200);
  for (const op of ["get", "attach", "detach", "results"] as const) assert.equal((await post({ op, workId: "w" })).status, 200);
  assert.equal((await post({ op: "lookup_start", commandKey: "key" })).status, 200);
  assert.equal((await post({ op: "list", limit: 10 })).status, 200);
  assert.equal((await post({ op: "send", workId: "w", runId: "r", attemptId: "a", commandKey: "send-1", text: "next" })).status, 200);
  assert.equal((await post({ op: "answer", workId: "w", runId: "r", attemptId: "a", commandKey: "answer-1", requestId: "q", answer: { decision: "submit", value: 0 } })).status, 200);
  assert.equal((await post({ op: "cancel", workId: "w", runId: "r", attemptId: "a", commandKey: "cancel-1" })).status, 200);
  assert.equal((await post({ op: "accept", workId: "w", resultId: "result", commandKey: "accept-1" })).status, 200);
  assert.equal((await post({ ...command, waitMs: 0 })).status, 200);
  assert.equal((await post({ op: "snapshot", workId: "w", runId: "r", attemptId: "a" })).status, 200);
  assert.equal((await post({ ...command, attemptId: "wrong", waitMs: 0 })).status, 409);
  assert.equal((await post({ op: "get", workId: "w", owner: "forged" })).status, 400);
  const badId = await post({ op: "get", workId: "w" }, "bad/id");
  assert.equal(badId.body.requestId, "invalid");
  assert.equal(badId.status, 400);
  const q = new URLSearchParams({ v: EXECUTION_PROTOCOL, requestId: "req", workId: "w", runId: "r", attemptId: "a", limit: "1", waitMs: "0" });
  const get = await fetch(`http://module${EDITOR_HTTP.events}?${q}`, { unix: runtime.httpSocket });
  assert.equal(get.status, 200);
  q.append("limit", "1");
  assert.equal((await fetch(`http://module${EDITOR_HTTP.events}?${q}`, { unix: runtime.httpSocket })).status, 400);
  assert.equal(calls.filter(call => call.target === "coding.cancel").length, 1);
  assert.equal(calls.filter(call => call.target === "coding.create").length, 1);
  assert.ok(!editorRequestSchema.safeParse({ v: EXECUTION_PROTOCOL, requestId: "req", command: { ...command, principal: "owner" } }).success);
} finally { await runtime.stop(); }
