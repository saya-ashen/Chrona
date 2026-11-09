import { expect, mock, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionEventPage, ExecutionEventPayload, ExecutionResult, ExecutionSnapshot, ExecutionView } from "./external/coding/contract.js";
import type { CodingContext } from "./external/coding/types";
import { projectsInput, projectsOutput } from "./builtin/agent/project-contracts";

// Only the SDK error constructor is needed; no socket, model or host project is used.
mock.module("chrona", () => ({ ModelError: class extends Error { constructor(readonly code: string, message: string) { super(message); } } }));
const { handleCodingCommand } = await import("./external/coding/service");
const { loadSessions } = await import("./external/coding/sessions");
const fault = (code: string) => Object.assign(new Error(code), { code });
const principal = { workspaceId: "fixture-workspace", ownerId: "owner", caller: { kind: "module", moduleId: "coding", hash: "fixture-version" } } as const;
const registered = [{ projectRef: "repo", path: "/fixture/repo", label: "Fixture" }];

async function fixture(run: (f: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>) {
  const f = await makeFixture();
  try { await run(f); } finally { await rm(f.context.dir, { recursive: true, force: true }); }
}
async function makeFixture() {
  const dir = await mkdtemp(join(tmpdir(), "coding-service-integration-"));
  const views = new Map<string, ExecutionView>(), starts = new Map<string, ExecutionView>();
  const snapshots = new Map<string, ExecutionSnapshot>(), controls = new Map<string, unknown>();
  const pages = new Map<string, ExecutionEventPage>();
  const calls: { target: string; args: Record<string, any> }[] = [];
  const faults = { startBefore: "", startAfter: false, controlAfter: false, offline: false, lookupUnavailable: false, inspectIdentity: false, eventIdentity: false, continuationIdentity: false };
  const context: CodingContext = { dir, content: join(dir, "public"), async call<T>(target: string, args: Record<string, any>): Promise<T> {
    calls.push({ target, args: structuredClone(args) });
    if (target === "agent.projects") {
      expect(projectsInput.parse(args)).toEqual({ action: "list" });
      return projectsOutput.parse({ action: "list", principal, projects: registered }) as T;
    }
    if (faults.offline) throw fault("unavailable");
    const workId = String(args["execution-id"]), key = String(args["request-key"]);
    if (target === "agent.lookup") {
      if (faults.lookupUnavailable) throw fault("unavailable");
      const view = starts.get(key); if (!view) throw fault("not_found"); return { ...view } as T;
    }
    if (target === "agent.run") {
      const journal = await loadSessions(context), session = journal.sessions.find(item => item.currentWorkId === workId);
      expect(session?.turns.at(-1)?.start?.workId).toBe(workId);
      expect(session?.turns.at(-1)?.accepted).toBe(false);
      expect(journal.commands.find(item => item.command.requestKey === key)?.receipt.status).toBe("pending");
      expect(JSON.parse(await readFile(join(dir, `${workId}.json`), "utf8")).start.commandKey).toBe(key);
      if (faults.startBefore) throw fault(faults.startBefore);
      const previous = starts.get(key); if (previous) return { execution: { ...previous } } as T;
      const parent = args["resume-from"] ? views.get(args["resume-from"]["work-id"]) : undefined;
      if (parent) {
        expect(parent.stopConfirmed).toBe(true);
        expect(args["resume-from"]).toEqual({ "work-id": parent.workId, "run-id": parent.runId, "attempt-id": parent.attemptId });
        expect(args["project-ref"]).toBe(parent.projectRef);
      }
      const view: ExecutionView = { workId, sessionId: parent && !faults.continuationIdentity ? parent.sessionId : `agent-${workId}`, runId: `run-${workId}`, attemptId: `attempt-${workId}`, projectRef: String(args["project-ref"]), status: "running", cancelRequested: false, stopConfirmed: false };
      views.set(workId, view); starts.set(key, view);
      snapshots.set(workId, { workId, sessionId: view.sessionId, runId: view.runId, attemptId: view.attemptId, status: "running", cancelRequested: false, stopConfirmed: false, highWatermark: 0, finalMessage: null, questions: [], missing: false, expiresAt: "2099-12-01T00:00:00Z" });
      if (faults.startAfter) { faults.startAfter = false; throw fault("unavailable"); }
      return { execution: { ...view } } as T;
    }
    const view = views.get(workId); if (!view) throw fault("not_found");
    if (target === "agent.get") return { ...view } as T;
    if (target === "agent.stream") {
      const page = structuredClone(pages.get(workId) ?? { events: [], cursor: "cursor-0", highWatermark: 0, gap: false, snapshotRequired: false });
      if (faults.eventIdentity && page.events[0]) page.events[0].attemptId = "foreign-attempt";
      return page as T;
    }
    if (target === "agent.inspect") {
      const snapshot = { ...structuredClone(snapshots.get(workId)!), status: view.status, cancelRequested: view.cancelRequested, stopConfirmed: view.stopConfirmed };
      if (faults.inspectIdentity) snapshot.sessionId = "foreign-session";
      return { snapshot, source: { workId, sessionId: view.sessionId, runId: view.runId, attemptId: view.attemptId, baseline: { kind: "commit", digest: "fixture-baseline" }, changes: { scope: "baseline_to_worktree", status: "complete", patch: "diff --git a/f b/f\n+fixture\n", files: [{ path: "f", kind: "tracked" }] } } } as T;
    }
    if (["agent.write", "agent.respond", "agent.interrupt"].includes(target)) {
      expect(args["run-id"]).toBe(view.runId); expect(args["attempt-id"]).toBe(view.attemptId);
      const journal = await loadSessions(context);
      expect(journal.commands.find(item => item.command.requestKey === key)?.receipt.status).toBe("pending");
      if (controls.has(key)) return structuredClone(controls.get(key)) as T;
      let reply: unknown = { accepted: true };
      if (target === "agent.interrupt") { view.cancelRequested = true; view.status = "unknown"; reply = { ...view }; }
      if (target === "agent.respond") {
        const question = snapshots.get(workId)!.questions.find(item => item.requestId === args["question-id"]);
        expect(question?.status).toBe("pending"); question!.status = "answered";
      }
      controls.set(key, reply);
      if (faults.controlAfter) { faults.controlAfter = false; throw fault("unavailable"); }
      return reply as T;
    }
    throw new Error(`Unexpected Agent tool ${target}`);
  } };
  const command = (raw: unknown, client = context): Promise<any> => handleCodingCommand(client, raw);
  async function create(requestKey = "create-1") { return (await command({ op: "conversations.create", requestKey, projectRef: "repo", title: "Ongoing work" })).receipt.sessionId as string; }
  async function send(sessionId: string, requestKey = "send-1", workId: string | null = null, text = "Implement fixture") { return command({ op: "round.send", requestKey, sessionId, workId, text }); }
  async function begin() { const sessionId = await create(); return { sessionId, workId: (await send(sessionId)).receipt.workId as string }; }
  function target(sessionId: string, workId: string) { const view = views.get(workId)!; return { sessionId, workId, runId: view.runId, attemptId: view.attemptId }; }
  function finish(workId: string, status: "completed" | "failed" | "cancelled" = "completed") {
    const view = views.get(workId)!; view.status = status; view.stopConfirmed = true;
    snapshots.get(workId)!.finalMessage = { messageId: "final-1", text: "Fixture changed. Checks not run.", truncated: false };
  }
  function page(workId: string, events: { seq: number; payload: ExecutionEventPayload }[], extra: Partial<ExecutionEventPage> = {}) {
    const view = views.get(workId)!;
    pages.set(workId, { events: events.map(event => ({ workId, sessionId: view.sessionId, runId: view.runId, attemptId: view.attemptId, at: "2026-01-01T00:00:00Z", ...event })), cursor: `cursor-${events.at(-1)?.seq ?? 0}`, highWatermark: events.at(-1)?.seq ?? 0, gap: false, snapshotRequired: false, ...extra });
  }
  function question(workId: string, method: "confirm" | "select" | "input" | "editor", options: string[] = []) {
    snapshots.get(workId)!.questions = [{ requestId: "question-1", title: "Answer exactly", method, options, status: "pending", expiresAt: "2099-12-01T00:00:00Z" }];
  }
  return { context, command, create, send, begin, target, finish, page, question, views, snapshots, pages, calls, faults, controls };
}

test("independent conversations and clients retain multiple rounds in one project-bound Agent session", () => fixture(async f => {
  const first = await f.create(), second = await f.create("create-2"), client = { ...f.context };
  const raw = { op: "round.send", requestKey: "send-1", sessionId: first, workId: null, text: "Implement fixture" };
  const [a, b] = await Promise.all([f.command(raw), f.command({ ...raw }, client)]);
  expect(a).toEqual(b); expect(a.receipt.status).toBe("accepted");
  let workId = a.receipt.workId;
  await f.send(first, "supplement", workId, "Also preserve receipts");
  await f.send(second, "second-start");
  const agentSession = f.views.get(workId)!.sessionId;
  for (let round = 0; round < 4; round++) {
    f.finish(workId);
    const next = (await f.send(first, `round-${round}`, workId, `Round ${round}`)).receipt.workId;
    expect(next).not.toBe(workId); expect(f.views.get(next)!.sessionId).toBe(agentSession);
    expect(f.views.get(next)!.runId).not.toBe(f.views.get(workId)!.runId);
    expect(f.views.get(next)!.attemptId).not.toBe(f.views.get(workId)!.attemptId);
    await expect(f.send(first, `stale-${round}`, workId)).rejects.toMatchObject({ code: "conflict" });
    workId = next;
  }
  const journal = await loadSessions(f.context);
  expect(journal.sessions.find(item => item.id === first)!.workIds).toHaveLength(5);
  expect(journal.sessions.find(item => item.id === second)!.workIds).toHaveLength(1);
  const before = f.calls.filter(call => call.target === "agent.run").length;
  const current = await f.command({ op: "conversations.get", sessionId: first }, client);
  expect(current.session.currentWorkId).toBe(workId);
  expect(current.history.messages.filter((item: { author: string }) => item.author === "你")).toHaveLength(6);
  expect(f.calls.filter(call => call.target === "agent.run")).toHaveLength(before);
  await expect(f.command({ ...raw, text: "Changed replay" })).rejects.toMatchObject({ code: "conflict" });
  expect(await f.command(raw)).toEqual(a);
}));

test.each(["before", "after"] as const)("uncertain start %s admission survives restart without implicit resend", phase => fixture(async f => {
  const sessionId = await f.create();
  if (phase === "before") f.faults.startBefore = "unavailable"; else f.faults.startAfter = true;
  const pending = await f.send(sessionId); expect(pending.receipt.status).toBe("pending");
  expect(await f.send(sessionId)).toEqual(pending);
  await f.command({ op: "conversations.get", sessionId }, { ...f.context });
  await f.command({ op: "conversations.list" });
  expect(f.calls.filter(call => call.target === "agent.run")).toHaveLength(1);
  await expect(f.send(sessionId, "new-key", pending.receipt.workId)).rejects.toMatchObject({ code: "conflict" });
  f.faults.startBefore = "";
  const retry = await f.command({ op: "round.retry", requestKey: "retry", sessionId, originalRequestKey: "send-1" }, { ...f.context });
  expect(retry.receipt.value.receipt.status).toBe("accepted");
  const starts = f.calls.filter(call => call.target === "agent.run");
  expect(starts).toHaveLength(phase === "before" ? 2 : 1);
  if (phase === "before") expect(starts[1]!.args).toEqual(starts[0]!.args);
  expect((await f.command({ op: "receipt", requestKey: "send-1" })).receipt.workId).toBe(pending.receipt.workId);
}));

test("unavailable admission lookup cannot turn a retry into a second execution", () => fixture(async f => {
  const sessionId = await f.create(); f.faults.startAfter = true;
  const pending = await f.send(sessionId); f.faults.lookupUnavailable = true;
  const retry = await f.command({ op: "round.retry", requestKey: "retry", sessionId, originalRequestKey: "send-1" });
  expect(retry.receipt.value.receipt.status).toBe("pending");
  expect(f.calls.filter(call => call.target === "agent.run")).toHaveLength(1);
  expect((await f.command({ op: "receipt", requestKey: "send-1" })).receipt.workId).toBe(pending.receipt.workId);
}));

test("definitively rejected first start keeps its receipt and permits a fresh start", () => fixture(async f => {
  const sessionId = await f.create(); f.faults.startBefore = "forbidden";
  await expect(f.send(sessionId)).rejects.toMatchObject({ code: "forbidden" });
  expect((await f.send(sessionId)).receipt.status).toBe("rejected");
  const rejected = await f.command({ op: "conversations.get", sessionId });
  expect(rejected.session.currentWorkId).toBeNull();
  expect(rejected.history.messages[0].status).toBe("发送未被接受");
  f.faults.startBefore = "";
  expect((await f.send(sessionId, "fresh-start")).receipt.status).toBe("accepted");
}));

test.each(["write", "stop", "answer"] as const)("lost %s response replays the original control identity only on explicit retry", operation => fixture(async f => {
  const { sessionId, workId } = await f.begin(), target = f.target(sessionId, workId);
  f.question(workId, "input"); f.faults.controlAfter = true;
  const raw = operation === "write" ? { op: "round.send", requestKey: "control", sessionId, workId, text: "Supplement" }
    : operation === "stop" ? { op: "round.stop", requestKey: "control", ...target }
    : { op: "round.answer", requestKey: "control", ...target, questionId: "question-1", text: "Exact answer" };
  const pending = await f.command(raw); expect(pending.receipt.status).toBe("pending");
  expect(await f.command(raw, { ...f.context })).toEqual(pending);
  await f.command({ op: "conversations.get", sessionId });
  const tool = operation === "write" ? "agent.write" : operation === "stop" ? "agent.interrupt" : "agent.respond";
  expect(f.calls.filter(call => call.target === tool)).toHaveLength(1);
  await expect(f.send(sessionId, "blocked", workId)).rejects.toMatchObject({ code: "conflict" });
  const retry = await f.command({ op: "round.retry", requestKey: "retry-control", sessionId, originalRequestKey: "control" });
  expect(retry.receipt.value.receipt.status).toBe("accepted");
  const controls = f.calls.filter(call => call.target === tool);
  expect(controls).toHaveLength(2); expect(controls[1]!.args).toEqual(controls[0]!.args);
  if (operation === "stop") {
    expect((await f.send(sessionId, "blocked", workId)).receipt.status).toBe("rejected");
    await expect(f.send(sessionId, "blocked-after-stop", workId)).rejects.toMatchObject({ code: "conflict" });
    f.finish(workId, "cancelled");
    expect((await f.send(sessionId, "next", workId)).receipt.workId).not.toBe(workId);
  }
}));

test.each(["queued", "unknown", "completed", "failed", "cancelled"] as const)("%s without confirmed stop cannot advance the conversation", status => fixture(async f => {
  const { sessionId, workId } = await f.begin(); f.views.get(workId)!.status = status;
  await expect(f.send(sessionId, "next", workId)).rejects.toMatchObject({ code: "conflict" });
  expect(f.calls.filter(call => call.target === "agent.run")).toHaveLength(1);
}));

test("conversation, project, run and attempt fences apply to controls and evidence", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(), other = await f.create("other"), target = f.target(sessionId, workId);
  for (const op of ["events", "snapshot", "round.stop"] as const) {
    const raw = { op, ...target, ...(op === "round.stop" ? { requestKey: "stop" } : {}) };
    await expect(f.command({ ...raw, sessionId: other })).rejects.toMatchObject({ code: "not_found" });
    await expect(f.command({ ...raw, runId: "stale-run" })).rejects.toMatchObject({ code: "conflict" });
    await expect(f.command({ ...raw, attemptId: "stale-attempt" })).rejects.toMatchObject({ code: "conflict" });
  }
  await expect(f.command({ op: "round.retry", requestKey: "retry-other", sessionId: other, originalRequestKey: "send-1" })).rejects.toMatchObject({ code: "not_found" });
  f.views.get(workId)!.projectRef = "foreign-project";
  await expect(f.send(sessionId, "project-change", workId)).rejects.toMatchObject({ code: "conflict" });
  expect(f.calls.filter(call => ["agent.write", "agent.interrupt"].includes(call.target))).toHaveLength(0);
}));

test("a continuation returned in another Agent session stays uncertain and blocks another round", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(); f.finish(workId); f.faults.continuationIdentity = true;
  const next = await f.send(sessionId, "continuation", workId);
  expect(next.receipt.status).toBe("pending"); expect(next.receipt.error.code).toBe("conflict");
  await expect(f.send(sessionId, "another", next.receipt.workId)).rejects.toMatchObject({ code: "conflict" });
}));

test.each([
  { method: "confirm", text: "是", value: true }, { method: "confirm", text: "否", value: false },
  { method: "select", text: "  exact option  ", value: 1 },
  ...["input", "editor"].flatMap(method => ["", " \n\t ", "  exact\nanswer  ", "x".repeat(8000)].map(text => ({ method, text, value: text }))),
] as const)("$method answer preserves its native exact value", entry => fixture(async f => {
  const { sessionId, workId } = await f.begin(); f.question(workId, entry.method as "confirm" | "select" | "input" | "editor", ["first", "  exact option  "]);
  const raw = { op: "round.answer", requestKey: "answer", ...f.target(sessionId, workId), questionId: "question-1", text: entry.text };
  const first = await f.command(raw); expect(first.receipt.status).toBe("accepted");
  expect(await f.command(raw)).toEqual(first);
  const replies = f.calls.filter(call => call.target === "agent.respond"); expect(replies).toHaveLength(1);
  expect(JSON.parse(replies[0]!.args.answer)).toEqual({ decision: "submit", value: entry.value });
  expect((await loadSessions(f.context)).sessions[0]!.turns.at(-1)!.text).toBe(entry.text);
}));

test.each([
  { method: "confirm", text: " 是" }, { method: "confirm", text: "yes" },
  { method: "select", text: "exact option" }, { method: "select", text: "1" },
  { method: "input", text: "x".repeat(8001) },
] as const)("$method rejects an invalid exact answer", entry => fixture(async f => {
  const { sessionId, workId } = await f.begin(); f.question(workId, entry.method, ["  exact option  "]);
  await expect(f.command({ op: "round.answer", requestKey: "answer", ...f.target(sessionId, workId), questionId: "question-1", text: entry.text })).rejects.toMatchObject({ code: "invalid" });
  expect(f.calls.filter(call => call.target === "agent.respond")).toHaveLength(0);
}));

test("answer preparation requires a matching live pending question and exact snapshot", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(); f.question(workId, "input");
  const raw = { op: "round.answer", requestKey: "answer", ...f.target(sessionId, workId), questionId: "question-1", text: "answer" };
  await expect(f.command({ ...raw, questionId: "old-question" })).rejects.toMatchObject({ code: "conflict" });
  await expect(f.command({ ...raw, attemptId: "old-attempt" })).rejects.toMatchObject({ code: "conflict" });
  const question = f.snapshots.get(workId)!.questions[0]!;
  question.expiresAt = "2000-01-01T00:00:00Z";
  await expect(f.command(raw)).rejects.toMatchObject({ code: "conflict" });
  question.expiresAt = "2099-12-01T00:00:00Z"; question.status = "answered";
  await expect(f.command(raw)).rejects.toMatchObject({ code: "conflict" });
  question.status = "pending"; f.faults.inspectIdentity = true;
  await expect(f.command(raw)).rejects.toMatchObject({ code: "conflict" });
  f.faults.inspectIdentity = false; f.views.get(workId)!.cancelRequested = true;
  await expect(f.command(raw)).rejects.toMatchObject({ code: "conflict" });
  expect(f.calls.filter(call => call.target === "agent.respond")).toHaveLength(0);
}));

test("stream overlap, snapshot refresh and truncated final text preserve the complete cached reply", () => fixture(async f => {
  const { sessionId, workId } = await f.begin();
  f.page(workId, [{ seq: 1, payload: { type: "text_delta", messageId: "reply", delta: "first " } }], { snapshotRequired: true });
  f.snapshots.get(workId)!.finalMessage = { messageId: "reply", text: "first second", truncated: true };
  const first = await f.command({ op: "conversations.get", sessionId });
  expect(first.history.messages.find((item: { author: string }) => item.author === "编码助手").content).toBe("first second");
  f.page(workId, [{ seq: 1, payload: { type: "text_delta", messageId: "reply", delta: "first " } }, { seq: 2, payload: { type: "text_delta", messageId: "reply", delta: "second and more" } }]);
  const second = await f.command({ op: "conversations.get", sessionId });
  const reply = second.history.messages.find((item: { author: string }) => item.author === "编码助手");
  expect(reply.content).toBe("first second and more");
  expect(reply.timestamp).toBe("2026-01-01T00:00:00Z");
  expect(second.history.limited).toBe(true);
  f.faults.offline = true;
  const offline = await f.command({ op: "conversations.get", sessionId }, { ...f.context });
  expect(offline.history.messages).toEqual(second.history.messages);
  expect(f.calls.filter(call => call.target === "agent.run")).toHaveLength(1);
}));

test("snapshot refresh hints alone do not mark loss, but gaps and foreign event identity do", () => fixture(async f => {
  const { sessionId, workId } = await f.begin();
  f.page(workId, [{ seq: 1, payload: { type: "message", messageId: "reply", role: "assistant", text: "Complete", complete: true } }], { snapshotRequired: true });
  expect((await f.command({ op: "conversations.get", sessionId })).history.limited).toBe(false);
  f.faults.eventIdentity = true;
  await expect(f.command({ op: "events", ...f.target(sessionId, workId) })).rejects.toMatchObject({ code: "conflict" });
  f.faults.eventIdentity = false;
  f.page(workId, [], { gap: true, snapshotRequired: true });
  expect((await f.command({ op: "conversations.get", sessionId })).history.limited).toBe(true);
}));

test("Unicode assistant history and long user history remain recoverable through bounded pages", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(), second = await f.create("second");
  const list = await f.command({ op: "conversations.list", limit: 1 });
  expect(list.sessions.map((item: { id: string }) => item.id)).toEqual([sessionId]);
  expect((await f.command({ op: "conversations.list", after: list.after, limit: 1 })).sessions[0].id).toBe(second);
  for (let index = 0; index < 8; index++) await f.send(sessionId, `long-${index}`, workId, `${index}:` + "x".repeat(19000));
  const reply = "界🙂".repeat(16000);
  const characters = Array.from(reply), chunks: { seq: number; payload: ExecutionEventPayload }[] = [];
  for (let offset = 0; offset < characters.length; offset += 4096) chunks.push({ seq: chunks.length + 1, payload: { type: "text_delta", messageId: "unicode", delta: characters.slice(offset, offset + 4096).join("") } });
  f.page(workId, chunks);
  const latest = await f.command({ op: "conversations.get", sessionId });
  expect(Buffer.byteLength(JSON.stringify(latest.session.turns))).toBeLessThan(32100);
  expect(latest.session.hasEarlierTurns).toBe(true);
  let page = latest.history; const messages = [...page.messages];
  while (page.hasEarlier) { page = (await f.command({ op: "conversations.get", sessionId, before: page.before })).history; messages.unshift(...page.messages); }
  expect(new Set(messages.map(item => item.id)).size).toBe(messages.length);
  expect(messages.filter(item => item.author === "你")).toHaveLength(9);
  expect(messages.filter(item => item.author === "编码助手").map(item => item.content).join("")).toBe(reply);
  await expect(f.command({ op: "conversations.get", sessionId, before: "missing" })).rejects.toMatchObject({ code: "invalid" });
  await expect(f.command({ op: "conversations.get", sessionId, workBefore: "missing" })).rejects.toMatchObject({ code: "invalid" });
}));

test("results retain baseline evidence, immutable bytes and scoped replayable acceptance", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(); f.finish(workId);
  const [result] = (await f.command({ op: "results", sessionId, workId })).results as ExecutionResult[];
  expect(result!.accepted).toBe(false); expect(result!.checks).toEqual([]);
  const path = join(f.context.dir, "artifacts", `${result!.artifactRef}.json`), bytes = await readFile(path, "utf8"), artifact = JSON.parse(bytes);
  expect(artifact.baseline).toEqual({ kind: "commit", digest: "fixture-baseline" });
  expect(artifact.changes.scope).toBe("baseline_to_worktree"); expect(artifact.finalMessage.text).toContain("Checks not run");
  const read = { op: "read-result", sessionId, workId, resultId: result!.resultId };
  expect(Buffer.from((await f.command(read)).base64, "base64").toString()).toBe(bytes);
  expect(await readFile(join(f.context.content, `${result!.artifactRef}.json`), "utf8")).toBe(bytes);
  const other = await f.create("other");
  await expect(f.command({ ...read, sessionId: other })).rejects.toMatchObject({ code: "not_found" });
  await expect(f.command({ ...read, resultId: "foreign-result" })).rejects.toMatchObject({ code: "not_found" });
  const accept = { op: "accept", requestKey: "accept", sessionId, workId, resultId: result!.resultId };
  const accepted = await f.command(accept); expect(accepted.receipt.value).toEqual({ accepted: true });
  expect(await f.command(accept, { ...f.context })).toEqual(accepted);
  await expect(f.command({ ...accept, resultId: "foreign-result" })).rejects.toMatchObject({ code: "conflict" });
  expect((await f.command({ op: "results", sessionId, workId })).results[0].accepted).toBe(true);
  expect(await readFile(path, "utf8")).toBe(bytes);
  await writeFile(path, `${bytes} `);
  await expect(f.command(read)).rejects.toMatchObject({ code: "conflict" });
  expect(f.calls.every(call => ["agent.projects", "agent.run", "agent.get", "agent.lookup", "agent.stream", "agent.inspect"].includes(call.target))).toBe(true);
}));
