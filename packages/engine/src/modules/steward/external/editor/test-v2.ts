import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { WORK_PROTOCOL, parseWorkResponse, workRequestSchema, editorRequestSchema, type WorkRequest, type WorkView } from "./contract.js";
// @ts-expect-error Chrona supplies the isolated author test kernel.
import { startModule } from "chrona/testing";

if (process.env.CHRONA_WORK_FIXTURES) {
  const fixture = JSON.parse(await readFile(process.env.CHRONA_WORK_FIXTURES, "utf8")) as { requests: WorkRequest[]; responses: unknown[] };
  assert.equal(fixture.requests.length, 13);
  for (const [index, raw] of fixture.requests.entries()) {
    const request = workRequestSchema.parse(raw);
    assert.equal(editorRequestSchema.safeParse(raw).success, false, "v1 must reject v2");
    assert.equal(parseWorkResponse(request, fixture.responses[index]).ok, true);
    assert.throws(() => parseWorkResponse(request, { ...(fixture.responses[index] as object), requestId: "other" }));
  }
}
const group: WorkView = { workId: "parent", kind: "group", goal: "两个子工作", parentWorkId: null, children: ["a", "b"], dependsOnWorkIds: [], blockedBy: [], dependencyResults: [], queueExpiresAt: null, phase: "waiting_dependency", cancelRequested: false, placement: null, workspace: null, execution: null };
let malformed = false, events = 0;
const runtime = await startModule("index.ts", { stubs: {
  "coding.work": (args: Record<string, unknown>) => {
    const request = workRequestSchema.parse(JSON.parse(String(args.input)));
    if (request.command.op === "events") {
      events++; assert.equal(request.command.waitMs, 0);
      return { events: [], cursor: "cursor", highWatermark: 0, gap: false, snapshotRequired: false };
    }
    if (request.command.op === "detach") return { accepted: true };
    return { ...group, ...(malformed ? { workId: "wrong" } : {}) };
  },
} });
async function post(command: object, version: string = WORK_PROTOCOL) {
  const request = { v: version, requestId: "v2-editor-test", command };
  const response = await fetch("http://module/api/editor/v1/commands", { unix: runtime.httpSocket, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
  return { status: response.status, body: await response.json() };
}
try {
  const now = new Date().toISOString();
  await runtime.send({ trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} });
  const response = await post({ op: "get", workId: "parent" });
  assert.equal(response.status, 200); assert.equal(response.body.v, WORK_PROTOCOL);
  assert.equal(response.body.data.execution, null); assert.equal(response.body.data.kind, "group");
  assert.equal((await post({ op: "attach", workId: "parent" })).status, 200);
  assert.equal((await post({ op: "detach", workId: "parent" })).status, 200);
  assert.equal((await post({ op: "events", workId: "a", runId: "r-a", attemptId: "t-a", limit: 1, waitMs: 0 })).status, 200);
  assert.equal(events, 1);
  malformed = true;
  assert.equal((await post({ op: "get", workId: "parent" })).status, 503, "wrong work identity must not reach client");
  assert.equal((await post({ op: "get", workId: "parent", caller: "owner" })).status, 400);
  const unknown = await post({ op: "get", workId: "parent" }, "chrona.execution.v3");
  assert.equal(unknown.body.error.code, "unsupported_version");
} finally { await runtime.stop(); }
