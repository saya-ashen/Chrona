import { strict as assert } from "node:assert";
import { pollEditorEvents } from "./poll";
import type { ExecutionCommand, ExecutionEventPage } from "./contract.js";

const command: Extract<ExecutionCommand, { op: "events" }> = { op: "events", workId: "w", runId: "r", attemptId: "a", limit: 10, waitMs: 1 };
const page: ExecutionEventPage = { events: [], cursor: "next", highWatermark: 0, gap: false, snapshotRequired: false };
const request = () => new Request("http://module/events");
const realNow = Date.now;
try {
  let now = 1000, reads = 0;
  Date.now = () => now;
  const quiet = pollEditorEvents(request(), command, async input => { assert.equal(input.waitMs, 0); reads++; return page; });
  setTimeout(() => { now = 1001; }, 0);
  assert.deepEqual(await quiet, page);
  assert.equal(reads, 1, "deadline after pause returns the existing cursor without a final read");
  const event: ExecutionEventPage = { ...page, highWatermark: 1, events: [{ workId: "w", sessionId: "s", runId: "r", attemptId: "a", seq: 1, at: "2026-11-06T00:00:00Z", payload: { type: "message", messageId: "late", role: "assistant", text: "arrived in last pause", complete: true } }] };
  assert.deepEqual(await pollEditorEvents(request(), { ...command, cursor: page.cursor, waitMs: 0 }, async input => { assert.equal(input.cursor, "next"); return event; }), event, "the next cursor read retains the late event");
  now = 2000;
  const controller = new AbortController();
  const aborted = pollEditorEvents(new Request("http://module/events", { signal: controller.signal }), command, async () => page);
  setTimeout(() => { now = 2001; controller.abort(); }, 0);
  await assert.rejects(aborted, { name: "AbortError" });
  now = 3000;
  await assert.rejects(pollEditorEvents(request(), command, async () => { now = 18001; await new Promise(resolve => setTimeout(resolve, 10)); return page; }), { code: "unavailable" }, "a genuinely overdue routed read still fails");
  await assert.rejects(pollEditorEvents(request(), command, async () => { throw Object.assign(new Error("failed routed read"), { code: "unavailable" }); }), { code: "unavailable" });
} finally { Date.now = realNow; }
