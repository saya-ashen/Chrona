import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { authorize, createClient, type Call } from "./client";
import { PAGE } from "./page";
// @ts-expect-error Chrona supplies the isolated offline test kernel.
import { paths, startModule } from "chrona/testing";
const now = "2026-11-09T10:00:00Z";
const owner = { kind: "owner" as const, via: null };
const web = { kind: "module" as const, module: "web", moduleId: "web-id", hash: "approved-web" };
const calls: Record<string, unknown>[] = [];
let pending = false;
const project = { projectRef: "p1", path: "/tmp/project", label: "示例项目" };
const session = { id: "s1", title: "修复测试", projectRef: "p1", currentWorkId: "w1", workIds: ["w1"], turns: [] };
const view = { workId: "w1", runId: "r1", attemptId: "a1", status: "running", cancelRequested: false, stopConfirmed: false };
function commandReceipt(c: Record<string, unknown>) {
  const status = pending ? "pending" : "accepted";
  if (c.op === "round.retry") return { receipt: { requestKey: c.requestKey, op: c.op, status: "accepted", value: { receipt: { requestKey: c.originalRequestKey, op: "round.send", status } } } };
  return { receipt: { requestKey: c.requestKey, op: c.op, status, ...(c.op === "conversations.create" ? { value: session } : c.op === "projects.register" ? { value: project } : {}) } };
}
const stub = (args: Record<string, unknown>) => {
  assert.deepEqual(Object.keys(args), ["input"]);
  const c = JSON.parse(String(args.input)); calls.push(c);
  switch (c.op) {
    case "projects.list": return { projects: [project], defaultProjectRef: "p1" };
    case "conversations.list": return { sessions: c.projectRef === "p2" ? [] : [session], after: c.after ? null : "s1" };
    case "conversations.get": return { session: { ...session, id: c.sessionId }, view, history: { messages: [{ id: "m1", author: "编码助手", content: "正在修改", timestamp: now, status: "" }], hasEarlier: true, before: "older", limited: false } };
    case "snapshot": return { ...view, questions: [{ requestId: "q1", title: "继续吗？", method: "confirm", options: [], status: "pending" }, { requestId: "old", title: "已回答", method: "input", options: [], status: "answered" }], missing: false, finalMessage: null };
    case "events": return { events: [{ seq: 1, payload: { type: "tool_finished", tool: "edit", summary: "已修改文件", isError: false } }], gap: false };
    case "results": return { results: [{ resultId: "result1", artifactRef: "artifact1", accepted: false, checks: [{ command: "bun test", outcome: "passed", exitCode: 0 }] }] };
    case "read-result": return { mime: "application/json", base64: Buffer.from(JSON.stringify({ finalMessage: { text: "成果已完成", truncated: false }, changes: { status: "complete", patch: "diff --git a/a b/a", files: [{ path: "new.txt", text: "新文件" }] } })).toString("base64") };
    case "receipt": return commandReceipt({ ...c, op: "round.send" });
    default: return commandReceipt(c);
  }
};
const call: Call = async <T>(target: string, args: Record<string, unknown>) => { assert.equal(target, "coding.command"); return stub(args) as T; };
const a = createClient(call), b = createClient(call);
const examples: { tool: string; output: unknown }[] = [];
const catalog = await a.catalog({ project: "p1" });
examples.push({ tool: "ui-catalog", output: catalog });
assert.equal(catalog.projects[0]!.isDefault, true);
assert.equal(catalog.sessions[0]!.title, "修复测试");
await b.catalog({ project: "p2" });
assert.deepEqual(calls.slice(0, 4), [{ op: "projects.list" }, { op: "conversations.list", projectRef: "p1" }, { op: "projects.list" }, { op: "conversations.list", projectRef: "p2" }]);
const detail = await a.work({ "session-id": "s1", before: "older" });
examples.push({ tool: "ui-work", output: detail });
assert.equal(detail.questions.length, 1); assert.equal(detail.questions[0]!.id, "q1");
assert.match(detail.progress[0]!.text, /已修改文件/); assert.match(detail.results[0]!.checks, /passed/);
assert.equal(detail.statusTone, "warning"); assert.equal(detail.canStop, true);
assert.deepEqual(calls.at(-3), { op: "snapshot", sessionId: "s1", workId: "w1", runId: "r1", attemptId: "a1" });
for (const [status, cancelRequested, stopConfirmed, canSend, canStop] of [
  ["queued", false, false, false, true], ["running", false, false, true, true],
  ["running", true, false, false, false], ["unknown", false, false, false, true],
  ["completed", false, false, false, true], ["completed", false, true, true, false],
  ["cancelled", true, true, true, false],
] as const) {
  const state = { ...view, status, cancelRequested, stopConfirmed };
  const client = createClient(async <T>(target: string, args: Record<string, unknown>) => {
    const command = JSON.parse(String(args.input)), response = await call<Record<string, unknown>>(target, args);
    return (command.op === "snapshot" ? { ...response, ...state } : command.op === "conversations.get" ? { ...response, view: state } : response) as T;
  });
  const work = await client.work({ "session-id": "s1" });
  assert.equal(work.canSend, canSend, status); assert.equal(work.canStop, canStop, status);
}
const opened = await a.result({ "session-id": "s1", "work-id": "w1", "result-id": "result1" });
assert.equal(opened.message, "成果已完成"); assert.equal(opened.files[0]!.text, "新文件"); assert.equal(opened.limited, false);
assert.deepEqual(calls.at(-1), { op: "read-result", sessionId: "s1", workId: "w1", resultId: "result1" });
examples.push({ tool: "ui-result", output: opened });
await b.catalog({ project: "p2", after: "s9" });
assert.deepEqual(calls.at(-1), { op: "conversations.list", projectRef: "p2", after: "s9" });
const scope = { project: "p1", "session-id": "s1", "work-id": "w1", "run-id": "r1", "attempt-id": "a1" };
const cases = [
  [{ action: "create", project: "p1", title: "Hello" }, { op: "conversations.create", projectRef: "p1", title: "Hello" }],
  [{ action: "send", project: "p1", "session-id": "s1", "work-id": "", text: "First" }, { op: "round.send", sessionId: "s1", workId: null, text: "First" }],
  [{ action: "send", project: "p1", "session-id": "s1", "work-id": "w1", text: "Continue" }, { op: "round.send", sessionId: "s1", workId: "w1", text: "Continue" }],
  [{ action: "answer", ...scope, question: "q1", text: "是" }, { op: "round.answer", sessionId: "s1", workId: "w1", runId: "r1", attemptId: "a1", questionId: "q1", text: "是" }],
  [{ action: "stop", ...scope }, { op: "round.stop", sessionId: "s1", workId: "w1", runId: "r1", attemptId: "a1" }],
  [{ action: "retry", project: "p1", "session-id": "s1", original: "original" }, { op: "round.retry", sessionId: "s1", originalRequestKey: "original" }],
  [{ action: "register-project", project: "p1", "session-id": "", path: "/tmp/project" }, { op: "projects.register", path: "/tmp/project" }],
  [{ action: "default-project", project: "p1", "session-id": "s1" }, { op: "projects.default", projectRef: "p1" }],
] as const;
for (const [args, command] of cases) {
  const count = calls.length;
  const output = await a.command({ ...args, "request-key": "key-1" });
  assert.equal(calls.length, count + 1, "one UI mutation forwards exactly once");
  assert.deepEqual(calls.at(-1), { ...command, requestKey: "key-1" });
  assert.notEqual(output.nextRequestKey, "key-1");
  if (args.action === "create") assert.equal(output.sessionId, "s1");
  if (args.action === "register-project") { assert.equal(output.project, "p1"); assert.equal(output.sessionId, ""); }
  examples.push({ tool: "ui-command", output });
}
for (const text of ["", "   "]) {
  const output = await a.command({ action: "answer", ...scope, question: "q1", text, "request-key": "blank-answer" });
  assert.equal(output.status, "accepted");
  assert.equal(calls.at(-1)!.text, text);
}
pending = true;
const retried = await a.command({ action: "retry", project: "p1", "session-id": "s1", original: "original", "request-key": "retry-key" });
assert.equal(retried.requestKey, "original"); assert.equal(retried.nextRequestKey, "original"); assert.equal(retried.status, "pending");
examples.push({ tool: "ui-command", output: retried });
const unresolved = await a.command({ action: "send", project: "p1", "session-id": "s1", "work-id": "w1", text: "Continue", "request-key": "keep-this" });
assert.equal(unresolved.nextRequestKey, "keep-this"); assert.equal(unresolved.retryable, true);
examples.push({ tool: "ui-command", output: unresolved });
const receipt = await a.receipt({ "request-key": "keep-this" });
examples.push({ tool: "ui-receipt", output: receipt });
assert.equal(receipt.status, "pending");
for (const args of [
  { action: "relay", target: "agent.run" }, { action: "select", "session-id": "s2" },
  { action: "send", ...scope, text: "Hi", target: "agent.run" },
  { action: "stop", ...scope, "attempt-id": undefined },
  { action: "answer", ...scope, text: "Hi", question: "q", caller: owner },
]) {
  const count = calls.length;
  assert.equal((await a.command({ "request-key": "bad", ...args })).status, "rejected");
  assert.equal(calls.length, count);
}
const denied = createClient(async () => { throw Object.assign(new Error("项目容量已满"), { code: "capacity" }); });
const rejection = await denied.command({ action: "create", project: "p1", title: "New", "request-key": "denied" });
assert.equal(rejection.status, "rejected"); assert.equal(rejection.sessionId, ""); assert.notEqual(rejection.nextRequestKey, "denied");
examples.push({ tool: "ui-command", output: rejection });
const unknown = createClient(async () => { throw new Error("Disconnected"); });
await assert.rejects(unknown.command({ action: "create", project: "p1", title: "New", "request-key": "unknown" }), /Disconnected/);
await assert.rejects(a.result({ "session-id": "s1", "work-id": "w1", "result-id": "../artifact" }), { code: "invalid" });
await assert.rejects(a.result({ "session-id": "s1", "work-id": "w1", "result-id": "r1", path: "/etc/passwd" }), { code: "invalid" });
await assert.rejects(a.catalog({ selectedSession: "s1" }), { code: "invalid" });
await assert.rejects(a.work({ "session-id": "s1", project: "p1" }), { code: "invalid" });
for (const caller of [undefined, { kind: "provider", runId: "p" }, { kind: "kernel" }, { kind: "module", module: "other", moduleId: "other-id", hash: "h" }] as const) assert.throws(() => authorize(caller), { code: "forbidden" });
authorize(owner); authorize(web);
assert.equal(Object.hasOwn(PAGE.spec.state.local, "sessionId"), true);
assert.equal(JSON.stringify(PAGE).includes("coding.command"), false);

// Large legal Agent pages can exceed Coding's smaller encoded envelope budget.
const legalEvents = Array.from({ length: 100 }, (_, i) => ({ workId: "w1", sessionId: "agent-s1", runId: "r1", attemptId: "a1", seq: i + 1, at: now, payload: { type: "tool_finished", tool: "edit", summary: "\u0001".repeat(390), isError: false } }));
const legalPage = { events: legalEvents, gap: false, highWatermark: 100, snapshotRequired: false };
const pageBytes = Buffer.byteLength(JSON.stringify({ result: { result: legalPage } }));
assert.ok(pageBytes > 230 * 1024 && pageBytes < 256 * 1024);
for (const succeedsAt of [25, 5, 1, 0]) {
  const limits: number[] = [];
  const client = createClient(async <T>(target: string, args: Record<string, unknown>) => {
    const command = JSON.parse(String(args.input));
    if (command.op === "events") {
      limits.push(command.limit);
      if (command.limit > succeedsAt) throw Object.assign(new Error("Encoded page too large"), { code: "too_large" });
      return { ...legalPage, events: legalEvents.slice(0, command.limit) } as T;
    }
    return call<T>(target, args);
  });
  const work = await client.work({ "session-id": "s1" });
  assert.deepEqual(limits, [100, 25, 5, 1].slice(0, succeedsAt === 25 ? 2 : succeedsAt === 5 ? 3 : 4));
  assert.equal(work.limited, true); assert.equal(work.status, "正在执行"); assert.equal(work.canStop, true);
  assert.equal(work.questions[0]!.id, "q1"); assert.equal(work.messages[0]!.content, "正在修改");
  assert.match(work.results[0]!.checks, /passed/); assert.equal(work.progress.length, succeedsAt);
}
for (const knownSnapshot of [false, true]) {
  const client = createClient(async <T>(target: string, args: Record<string, unknown>) => {
    const command = JSON.parse(String(args.input));
    if (command.op === "snapshot") throw Object.assign(new Error("Snapshot too large"), { code: "too_large" });
    const response = await call<Record<string, unknown>>(target, args);
    if (command.op === "conversations.get" && knownSnapshot) (response.history as { snapshot?: unknown }).snapshot = stub({ input: JSON.stringify({ op: "snapshot" }) });
    return response as T;
  });
  const work = await client.work({ "session-id": "s1" });
  assert.equal(work.limited, true); assert.equal(work.status, "正在执行"); assert.equal(work.canSend, true);
  assert.equal(work.messages[0]!.content, "正在修改"); assert.match(work.results[0]!.checks, /passed/);
  assert.equal(work.questions.length, knownSnapshot ? 1 : 0); assert.equal(work.progress.length, 1);
}
for (const op of ["snapshot", "events"]) for (const code of ["forbidden", "unauthorized", "conflict", "unavailable", undefined]) {
  const error = Object.assign(new Error("Refresh failed"), code ? { code } : {});
  let attempts = 0;
  const client = createClient(async <T>(target: string, args: Record<string, unknown>) => {
    if (JSON.parse(String(args.input)).op === op) { attempts++; throw error; }
    return call<T>(target, args);
  });
  await assert.rejects(client.work({ "session-id": "s1" }), e => e === error);
  assert.equal(attempts, 1);
}
for (const lostReply of [false, true]) {
  const rejected = { requestKey: "stale-client", op: "round.send", status: "rejected", error: { code: "conflict", message: "Conversation has advanced to another round" } };
  const client = createClient(async <T>(_target: string, args: Record<string, unknown>) => {
    const command = JSON.parse(String(args.input));
    if (command.op === "receipt") return { receipt: rejected } as T;
    throw Object.assign(new Error(lostReply ? "Disconnected" : rejected.error.message), lostReply ? {} : { code: "conflict" });
  });
  await assert.rejects(client.command({ action: "send", project: "p1", "session-id": "s1", "work-id": "w1", text: "Stale", "request-key": rejected.requestKey }));
  const recovered = await client.receipt({ "request-key": rejected.requestKey, "session-id": "s1", project: "p1" });
  assert.equal(recovered.status, "rejected"); assert.equal(recovered.retryable, false);
  assert.notEqual(recovered.nextRequestKey, rejected.requestKey); assert.equal(recovered.message, rejected.error.message);
}
const missingReceipt = createClient(async () => { throw Object.assign(new Error("Receipt not yet present"), { code: "not_found" }); });
await assert.rejects(missingReceipt.receipt({ "request-key": "in-flight" }), { code: "not_found" });

// A real SDK process with only local fake targets proves registration and caller
// enforcement at the tool handler, beyond direct helper tests.
const runtime = await startModule(join(paths.module, "index.ts"), { stubs: { "coding.command": stub, "web.page-set": (args: Record<string, unknown>) => { assert.deepEqual(args, PAGE); return { ok: true }; } } });
const tool = (id: string, args: Record<string, unknown>, caller: object | null = owner) => runtime.send({ trigger: { kind: "tool", id, firedAt: now, args, ...(caller ? { caller } : {}) }, now, params: {} });
try {
  const activated = await runtime.send({ trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} });
  assert.equal(activated.error, undefined);
  const request = await tool("ui-request", {}, web);
  assert.ok(request.result?.result); examples.push({ tool: "ui-request", output: request.result!.result });
  const catalogReply = await tool("ui-catalog", { project: "p1" }, web);
  assert.equal(catalogReply.error, undefined);
  for (const caller of [null, { kind: "provider", runId: "p" }, { kind: "module", module: "coding-web-other", moduleId: "other", hash: "h" }]) {
    const count = runtime.calls.length;
    const denied = await tool("ui-catalog", {}, caller);
    assert.ok(denied.error); assert.equal(runtime.calls.length, count);
  }
  const relay = await tool("ui-command", { action: "relay", target: "agent.run", "request-key": "no" });
  assert.equal((relay.result?.result as { status: string }).status, "rejected");
  const independent = await tool("ui-catalog", { project: "p2" });
  assert.equal(independent.error, undefined);
  assert.equal(runtime.calls.filter((c: { params: { target: string } }) => targetName(c.params.target) === "web.page-set").length, 1);
} finally {
  const count = runtime.calls.length;
  await runtime.stop();
  assert.equal(runtime.calls.length, count, "detaching the UI process never stops Coding");
}
assert.equal(calls.some(c => Object.hasOwn(c, "selected") || Object.hasOwn(c, "clientId")), false);
await writeFile(join(paths.data, "output-examples.json"), JSON.stringify(examples));

function targetName(raw: unknown): string {
  if (typeof raw === "string") return raw;
  const target = raw as { moduleId: string; tool: string };
  const names: Record<string, string> = {};
  return `${names[target.moduleId] ?? target.moduleId.replace(/-id$/, "")}.${target.tool}`;
}
