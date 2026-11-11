import { expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionResult } from "./external/coding/contract.js";
import type { CodingContext } from "./external/coding/types";
import { kernelAgentInputs, kernelAgentOutputs } from "./external/coding/kernel-contract.js";

// Only the SDK error constructor is needed; no socket, model or host project is used.
mock.module("chrona", () => ({ ModelError: class extends Error { constructor(readonly code: string, message: string) { super(message); } } }));
mock.module("chrona/process", () => import("@chrona/process"));
const { handleCodingCommand } = await import("./external/coding/service");
const { loadSessions } = await import("./external/coding/sessions");
type Run = ReturnType<typeof kernelAgentOutputs.run.parse>;
type Page = ReturnType<typeof kernelAgentOutputs.read.parse>;
const fault = (code: string) => Object.assign(new Error(code), { code });
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

async function fixture(run: (f: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>) {
  const f = await makeFixture();
  try { await run(f); } finally { await rm(f.context.dir, { recursive: true, force: true }); }
}
async function makeFixture() {
  const dir = await mkdtemp(join(tmpdir(), "coding-service-integration-")), projectPath = join(dir, "repo");
  await mkdir(projectPath);
  const runs = new Map<string, Run>(), pages = new Map<string, Page>();
  const receipts = new Map<string, { status: string; output?: unknown; error?: { code: string; message: string } }>();
  const calls: { target: string; args: Record<string, any>; key?: string }[] = [], lookups: { target: string; key: string }[] = [];
  const faults = { startBefore: "", startAfter: false, controlAfter: false, malformed: "", offline: false, lookupUnavailable: false, inspectIdentity: false, eventIdentity: false, continuationIdentity: false, expireCursor: false, stopConfirmed: false };
  const cursorPages = new Map<string, Pick<Page, "items" | "nextCursor">>();
  const context: CodingContext = { dir, content: join(dir, "public"), async call<T>(target: string, raw: Record<string, any>, options?: { key?: string }): Promise<T> {
    calls.push({ target, args: structuredClone(raw), key: options?.key });
    expect(["agent.run", "agent.read", "agent.write", "agent.stop"]).toContain(target);
    const name = target.slice(6) as "run" | "read" | "write" | "stop";
    const args = kernelAgentInputs[name].parse(raw) as Record<string, any>;
    if (faults.offline) throw fault("unavailable");
    if (name === "read") {
      expect(options?.key).toBeUndefined();
      const workId = [...runs].find(([, run]) => run.runId === args.runId)?.[0];
      if (!workId) throw fault("not_found");
      const page = structuredClone(pages.get(workId)!);
      if (faults.expireCursor && args.cursor) { faults.expireCursor = false; throw fault("cursor_expired"); }
      const cursorPage = cursorPages.get(String(args.cursor ?? "")); if (cursorPage) Object.assign(page, structuredClone(cursorPage));
      if (faults.eventIdentity) page.run.contextId = "foreign-context";
      if (faults.inspectIdentity && page.interactions[0]) page.interactions[0].sessionId = "foreign-context";
      return kernelAgentOutputs.read.parse(page) as T;
    }
    expect(options?.key).toMatch(/^coding-[a-f0-9]{64}$/);
    const journal = await loadSessions(context);
    const entry = journal.commands.find(item => `coding-${digest(`${target}:${item.command.requestKey}`)}` === options?.key);
    expect(entry?.receipt.status).toBe("pending");
    const callJournal = JSON.parse(await readFile(join(dir, "sessions", `call-${digest(`${target}:${options!.key}`)}.json`), "utf8"));
    expect(callJournal.state).toBe("pending"); expect(callJournal.args).toEqual(raw);
    const receiptKey = `${target}:${options!.key}`;
    // Duplicate side effects are a fixture failure, even if the fake could dedupe them.
    expect(receipts.has(receiptKey)).toBe(false);
    let output: unknown;
    if (name === "run") {
      const workId = entry!.receipt.workId!, session = journal.sessions.find(item => item.currentWorkId === workId)!;
      expect(session.turns.at(-1)?.accepted).toBe(false);
      expect(JSON.parse(await readFile(join(dir, `${workId}.json`), "utf8")).start.commandKey).toBe(entry!.command.requestKey);
      const admission = JSON.parse(await readFile(join(dir, "sessions", `run-${digest(workId)}.json`), "utf8"));
      expect(admission.project.path).toBe(projectPath); expect(admission.project.identity).toMatch(/^\d+:\d+$/);
      expect(["commit", "snapshot"]).toContain(admission.project.baseline.kind);
      const parent = session.turns.at(-1)?.start?.resumeFrom;
      if (parent) {
        const evidence = JSON.parse(await readFile(join(dir, "sessions", `evidence-${digest(parent.workId)}.json`), "utf8"));
        expect(evidence.stage).toBe("frozen"); expect(evidence.ref.runId).toBe(parent.runId); expect(evidence.ref.attemptId).toBe(parent.attemptId);
      }
      if (faults.startBefore) throw fault(faults.startBefore);
      const run: Run = { runId: `run-${runs.size + 1}`, contextId: args.contextId && !faults.continuationIdentity ? args.contextId : `context-${runs.size + 1}`, status: "running", active: true };
      runs.set(workId, run); pages.set(workId, { run, items: [], nextCursor: null, ended: false, interactions: [], transcript: [] });
      output = { ...run };
    } else {
      const workId = [...runs].find(([, run]) => run.runId === args.runId)?.[0];
      if (!workId) throw fault("not_found");
      const run = runs.get(workId)!;
      if (name === "stop") {
        run.status = faults.stopConfirmed ? "cancelled" : "unknown"; run.active = !faults.stopConfirmed;
        output = { ...run, stopConfirmed: faults.stopConfirmed };
      } else {
        if (args.input.kind === "answer") {
          const question = pages.get(workId)!.interactions.find(item => item.id === args.input.questionId);
          expect(question?.status).toBe("pending"); question!.status = "answered";
        }
        output = { accepted: true };
      }
    }
    output = kernelAgentOutputs[name].parse(output);
    receipts.set(receiptKey, { status: "succeeded", output: structuredClone(output) });
    if (name === "run" && faults.startAfter) { faults.startAfter = false; throw fault("unavailable"); }
    if (name !== "run" && faults.controlAfter) { faults.controlAfter = false; throw fault("unavailable"); }
    if (faults.malformed === target) { faults.malformed = ""; return {} as T; }
    return output as T;
  }, async callStatus(selector) {
    expect(Object.keys(selector).sort()).toEqual(["key", "target"]); lookups.push({ ...selector });
    if (faults.lookupUnavailable) throw fault("unavailable");
    return structuredClone(receipts.get(`${selector.target}:${selector.key}`) ?? { status: "unknown" });
  } };
  const command = (raw: unknown, client = context): Promise<any> => handleCodingCommand(client, raw);
  const projectRef = (await command({ op: "projects.register", requestKey: "register", path: projectPath })).receipt.value.projectRef as string;
  async function create(requestKey = "create-1") { return (await command({ op: "conversations.create", requestKey, projectRef, title: "Ongoing work" })).receipt.sessionId as string; }
  async function send(sessionId: string, requestKey = "send-1", workId: string | null = null, text = "Implement fixture") { return command({ op: "round.send", requestKey, sessionId, workId, text }); }
  async function begin() { const sessionId = await create(); return { sessionId, workId: (await send(sessionId)).receipt.workId as string }; }
  function target(sessionId: string, workId: string) { const run = runs.get(workId)!; return { sessionId, workId, runId: run.runId, attemptId: run.runId }; }
  function text(workId: string, value: string) { pages.get(workId)!.transcript = [{ at: new Date().toISOString(), kind: "text", text: value }]; }
  function finish(workId: string, status = "finished") { const run = runs.get(workId)!; run.status = status; run.active = false; text(workId, "Fixture changed. Checks not run."); }
  function page(workId: string, items: Page["items"], nextCursor: string | null = null) { Object.assign(pages.get(workId)!, { items, nextCursor }); }
  function question(workId: string, method: "confirm" | "select" | "input" | "editor", options: string[] = []) {
    const run = runs.get(workId)!;
    pages.get(workId)!.interactions = [{ id: "question-1", runId: run.runId, sessionId: run.contextId, question: { title: "Answer exactly", message: "Preserve the native value", method, options, timeoutMs: 300000 }, createdAt: new Date().toISOString(), status: "pending", expiresAt: "2099-12-01T00:00:00Z" }];
  }
  return { context, command, create, send, begin, target, finish, page, text, question, runs, pages, calls, lookups, receipts, cursorPages, faults, projectRef, projectPath };
}
const usage = (sequence: number): Page["items"][number] => ({ sequence, at: "2026-11-11T18:00:00Z", kind: "event", payload: { type: "usage", value: { input: sequence * 10, output: sequence } } });

test("independent conversations and clients retain multiple rounds in one project-bound Agent session", () => fixture(async f => {
  const first = await f.create(), second = await f.create("create-2"), client = { ...f.context };
  const raw = { op: "round.send", requestKey: "send-1", sessionId: first, workId: null, text: "Implement fixture" };
  const [a, b] = await Promise.all([f.command(raw), f.command({ ...raw }, client)]);
  expect(a).toEqual(b); expect(a.receipt.status).toBe("accepted");
  let workId = a.receipt.workId;
  await f.send(first, "supplement", workId, "Also preserve receipts");
  await f.send(second, "second-start");
  const agentSession = f.runs.get(workId)!.contextId;
  const start = f.calls.find(call => call.target === "agent.run")!;
  expect(Object.keys(start.args).sort()).toEqual(["kind", "prompt", "providerOptions"]);
  expect(start.args).toMatchObject({ kind: "conversation", providerOptions: {} });
  expect(start.args.prompt).toContain(JSON.stringify(f.projectPath)); expect(start.args.prompt).toContain("AGENTS.md");
  expect(f.calls.find(call => call.target === "agent.write")!.args.input).toEqual({ kind: "message", text: "Also preserve receipts" });
  for (let round = 0; round < 4; round++) {
    f.finish(workId);
    const next = (await f.send(first, `round-${round}`, workId, `Round ${round}`)).receipt.workId;
    expect(next).not.toBe(workId); expect(f.runs.get(next)!.contextId).toBe(agentSession);
    expect(f.runs.get(next)!.runId).not.toBe(f.runs.get(workId)!.runId);
    const execution = (await f.command({ op: "receipt", requestKey: `round-${round}` })).receipt.value.execution;
    expect(execution.attemptId).toBe(execution.runId); expect(execution.projectRef).toBe(f.projectRef);
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
  expect(retry.receipt.value.receipt.status).toBe(phase === "before" ? "pending" : "accepted");
  const starts = f.calls.filter(call => call.target === "agent.run");
  expect(starts).toHaveLength(1);
  expect(f.lookups.every(item => item.target === "agent.run" && item.key === starts[0]!.key)).toBe(true);
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

test("an unavailable receipt port cannot cause a second admission", () => fixture(async f => {
  const sessionId = await f.create(); f.faults.startAfter = true;
  const pending = await f.send(sessionId), client = { ...f.context, callStatus: undefined };
  const retry = await f.command({ op: "round.retry", requestKey: "retry-without-port", sessionId, originalRequestKey: "send-1" }, client);
  expect(retry.receipt.value.receipt).toMatchObject({ status: "pending", workId: pending.receipt.workId });
  expect(f.calls.filter(call => call.target === "agent.run")).toHaveLength(1); expect(f.lookups).toEqual([]);
  expect((await f.command({ op: "receipt", requestKey: "send-1" })).receipt.status).toBe("pending");
}));

test("a definitive failed admission receipt rejects the original intent without resubmission", () => fixture(async f => {
  const sessionId = await f.create(); f.faults.startBefore = "unavailable";
  await f.send(sessionId);
  const call = f.calls.find(item => item.target === "agent.run")!;
  f.receipts.set(`${call.target}:${call.key}`, { status: "failed", error: { code: "forbidden", message: "Admission refused" } });
  const retry = await f.command({ op: "round.retry", requestKey: "retry-failed", sessionId, originalRequestKey: "send-1" });
  expect(retry.receipt.value.receipt).toMatchObject({ status: "rejected", error: { code: "forbidden" } });
  expect((await f.command({ op: "conversations.get", sessionId })).session.currentWorkId).toBeNull();
  f.faults.startBefore = ""; expect((await f.send(sessionId, "fresh")).receipt.status).toBe("accepted");
  expect(f.calls.filter(item => item.target === "agent.run")).toHaveLength(2);
}));

test.each(["agent.run", "agent.write", "agent.stop"])("malformed %s acceptance recovers from the original validated receipt", tool => fixture(async f => {
  const sessionId = await f.create(); let workId: string | null = null;
  if (tool !== "agent.run") workId = (await f.send(sessionId)).receipt.workId;
  f.faults.malformed = tool;
  const command = tool === "agent.stop" ? { op: "round.stop", requestKey: "malformed", ...f.target(sessionId, workId!) }
    : { op: "round.send", requestKey: "malformed", sessionId, workId, text: "Do this once" };
  expect((await f.command(command)).receipt.status).toBe("pending");
  const retry = await f.command({ op: "round.retry", requestKey: "retry-malformed", sessionId, originalRequestKey: "malformed" });
  expect(retry.receipt.value.receipt.status).toBe("accepted");
  expect(f.calls.filter(call => call.target === tool)).toHaveLength(1);
  const call = f.calls.find(item => item.target === tool)!;
  expect(f.lookups).toContainEqual({ target: tool, key: call.key! });
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

test.each(["write", "stop", "answer"] as const)("lost %s response recovers the original control receipt only on explicit retry", operation => fixture(async f => {
  const { sessionId, workId } = await f.begin(), target = f.target(sessionId, workId);
  f.question(workId, "input"); f.faults.controlAfter = true;
  const raw = operation === "write" ? { op: "round.send", requestKey: "control", sessionId, workId, text: "Supplement" }
    : operation === "stop" ? { op: "round.stop", requestKey: "control", ...target }
    : { op: "round.answer", requestKey: "control", ...target, questionId: "question-1", text: "Exact answer" };
  const pending = await f.command(raw); expect(pending.receipt.status).toBe("pending");
  expect(await f.command(raw, { ...f.context })).toEqual(pending);
  await f.command({ op: "conversations.get", sessionId });
  const tool = operation === "stop" ? "agent.stop" : "agent.write";
  expect(f.calls.filter(call => call.target === tool)).toHaveLength(1);
  await expect(f.send(sessionId, "blocked", workId)).rejects.toMatchObject({ code: "conflict" });
  const retry = await f.command({ op: "round.retry", requestKey: "retry-control", sessionId, originalRequestKey: "control" });
  expect(retry.receipt.value.receipt.status).toBe("accepted");
  const controls = f.calls.filter(call => call.target === tool);
  expect(controls).toHaveLength(1);
  expect(f.lookups).toContainEqual({ target: tool, key: controls[0]!.key! });
  if (operation === "stop") {
    expect((await f.send(sessionId, "blocked", workId)).receipt.status).toBe("rejected");
    await expect(f.send(sessionId, "blocked-after-stop", workId)).rejects.toMatchObject({ code: "conflict" });
    f.finish(workId, "cancelled");
    await expect(f.send(sessionId, "still-blocked", workId)).rejects.toMatchObject({ code: "conflict" });
    f.faults.stopConfirmed = true;
    await f.command({ op: "round.stop", requestKey: "confirmed-stop", ...target });
    expect((await f.send(sessionId, "next", workId)).receipt.workId).not.toBe(workId);
  }
}));

test.each(["queued", "unknown", "completed", "failed", "cancelled"] as const)("%s without confirmed stop cannot advance the conversation", status => fixture(async f => {
  const { sessionId, workId } = await f.begin(); f.runs.get(workId)!.status = status;
  await expect(f.send(sessionId, "next", workId)).rejects.toMatchObject({ code: "conflict" });
  expect(f.calls.filter(call => call.target === "agent.run")).toHaveLength(1);
}));

test("conversation, project, run and attempt fences apply to controls and evidence", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(), other = await f.create("other"), target = f.target(sessionId, workId);
  for (const op of ["events", "snapshot", "round.stop"] as const) {
    const raw = { op, ...target, ...(op === "round.stop" ? { requestKey: "stop" } : {}) };
    await expect(f.command({ ...raw, sessionId: other })).rejects.toMatchObject({ code: "not_found" });
    await expect(f.command({ ...raw, ...(op === "round.stop" ? { requestKey: "stale-run-stop" } : {}), runId: "stale-run" })).rejects.toMatchObject({ code: "conflict" });
    await expect(f.command({ ...raw, ...(op === "round.stop" ? { requestKey: "stale-attempt-stop" } : {}), attemptId: "stale-attempt" })).rejects.toMatchObject({ code: "conflict" });
  }
  await expect(f.command({ op: "round.retry", requestKey: "retry-other", sessionId: other, originalRequestKey: "send-1" })).rejects.toMatchObject({ code: "not_found" });
  const workPath = join(f.context.dir, `${workId}.json`), work = JSON.parse(await readFile(workPath, "utf8"));
  work.start.projectRef = "foreign-project"; await writeFile(workPath, JSON.stringify(work));
  await expect(f.send(sessionId, "project-change", workId)).rejects.toMatchObject({ code: "conflict" });
  expect(f.calls.filter(call => ["agent.write", "agent.stop"].includes(call.target))).toHaveLength(0);
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
  const replies = f.calls.filter(call => call.target === "agent.write"); expect(replies).toHaveLength(1);
  expect(replies[0]!.args.input).toEqual({ kind: "answer", questionId: "question-1", answer: { decision: "submit", value: entry.value } });
  expect((await loadSessions(f.context)).sessions[0]!.turns.at(-1)!.text).toBe(entry.text);
}));

test.each([
  { method: "confirm", text: " 是" }, { method: "confirm", text: "yes" },
  { method: "select", text: "exact option" }, { method: "select", text: "1" },
  { method: "input", text: "x".repeat(8001) },
] as const)("$method rejects an invalid exact answer", entry => fixture(async f => {
  const { sessionId, workId } = await f.begin(); f.question(workId, entry.method, ["  exact option  "]);
  await expect(f.command({ op: "round.answer", requestKey: "answer", ...f.target(sessionId, workId), questionId: "question-1", text: entry.text })).rejects.toMatchObject({ code: "invalid" });
  expect(f.calls.filter(call => call.target === "agent.write")).toHaveLength(0);
}));

test("answer preparation requires a matching live pending question and exact snapshot", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(); f.question(workId, "input");
  const raw = { op: "round.answer", requestKey: "answer", ...f.target(sessionId, workId), questionId: "question-1", text: "answer" };
  await expect(f.command({ ...raw, requestKey: "old-question-answer", questionId: "old-question" })).rejects.toMatchObject({ code: "conflict" });
  await expect(f.command({ ...raw, requestKey: "old-attempt-answer", attemptId: "old-attempt" })).rejects.toMatchObject({ code: "conflict" });
  const question = f.pages.get(workId)!.interactions[0]!;
  question.expiresAt = "2000-01-01T00:00:00Z";
  await expect(f.command({ ...raw, requestKey: "expired" })).rejects.toMatchObject({ code: "conflict" });
  question.expiresAt = "2099-12-01T00:00:00Z"; question.status = "answered";
  await expect(f.command({ ...raw, requestKey: "answered" })).rejects.toMatchObject({ code: "conflict" });
  question.status = "pending"; f.faults.inspectIdentity = true;
  await expect(f.command({ ...raw, requestKey: "identity" })).rejects.toMatchObject({ code: "conflict" });
  f.faults.inspectIdentity = false; question.runId = "foreign-run";
  await expect(f.command({ ...raw, requestKey: "foreign-run" })).rejects.toMatchObject({ code: "conflict" });
  question.runId = f.runs.get(workId)!.runId;
  await f.command({ op: "round.stop", requestKey: "stop", ...f.target(sessionId, workId) });
  await expect(f.command({ ...raw, requestKey: "stopped" })).rejects.toMatchObject({ code: "conflict" });
  expect(f.calls.filter(call => call.target === "agent.write")).toHaveLength(0);
}));

test("overlapping generic pages dedupe progress while transcript refresh retains complete cached text offline", () => fixture(async f => {
  const { sessionId, workId } = await f.begin();
  f.page(workId, [usage(1)], "cursor-1"); f.text(workId, "first second");
  const first = await f.command({ op: "conversations.get", sessionId });
  expect(first.history.messages.find((item: { author: string }) => item.author === "编码助手").content).toBe("first second");
  expect(first.history.limited).toBe(false);
  const complete = "first second and more " + "x".repeat(25000);
  f.page(workId, [usage(1), usage(2)], "cursor-2"); f.text(workId, complete);
  const second = await f.command({ op: "conversations.get", sessionId });
  expect(second.history.progress.map((item: { sequence: number }) => item.sequence)).toEqual([1, 2]);
  expect(second.history.messages.filter((item: { author: string }) => item.author === "编码助手").map((item: { content: string }) => item.content).join("")).toBe(complete);
  expect(second.history.limited).toBe(true);
  // A shorter, still-truncated transcript must not replace a fuller durable reply.
  f.text(workId, complete.slice(0, 24500));
  const shorter = await f.command({ op: "conversations.get", sessionId });
  expect(shorter.history.messages.map((item: { content: string }) => item.content)).toEqual(second.history.messages.map((item: { content: string }) => item.content));
  f.faults.offline = true;
  const offline = await f.command({ op: "conversations.get", sessionId }, { ...f.context });
  expect(offline.history.messages).toEqual(shorter.history.messages);
  expect(f.calls.filter(call => call.target === "agent.run")).toHaveLength(1);
}));

test("generic cursors paginate, overlap and expire without replaying usage or losing transcript text", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(); f.text(workId, "Complete");
  f.cursorPages.set("", { items: [usage(1)], nextCursor: "cursor-1" });
  f.cursorPages.set("cursor-1", { items: [usage(1), usage(2)], nextCursor: "cursor-2" });
  f.cursorPages.set("cursor-2", { items: [usage(2), usage(3)], nextCursor: "cursor-3" });
  for (let index = 1; index <= 3; index++) {
    const result = await f.command({ op: "conversations.get", sessionId });
    expect(result.history.progress.map((item: { sequence: number }) => item.sequence)).toEqual(Array.from({ length: index }, (_, n) => n + 1));
    expect(result.history.limited).toBe(false);
  }
  expect(f.calls.some(call => call.target === "agent.read" && call.args.cursor === "cursor-2")).toBe(true);
  f.faults.expireCursor = true;
  const expired = await f.command({ op: "conversations.get", sessionId });
  expect(expired.history.limited).toBe(true); expect(expired.history.progress).toHaveLength(3);
  expect(expired.history.messages.find((item: { author: string }) => item.author === "编码助手").content).toBe("Complete");
}));

test("stopped evidence preserves event pagination and offline final snapshots", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(); f.finish(workId);
  f.cursorPages.set("", { items: [usage(1)], nextCursor: "stopped-1" });
  f.cursorPages.set("stopped-1", { items: [usage(2)], nextCursor: "stopped-2" });
  const first = await f.command({ op: "events", ...f.target(sessionId, workId) });
  expect(first.events.map((item: { seq: number }) => item.seq)).toEqual([1]);
  const frozen = await f.command({ op: "snapshot", ...f.target(sessionId, workId) });
  const next = await f.command({ op: "events", ...f.target(sessionId, workId), cursor: first.cursor });
  expect(next.events.map((item: { seq: number }) => item.seq)).toEqual([2]);
  expect(next.cursor).toBe("stopped-2");
  f.faults.offline = true;
  expect(await f.command({ op: "snapshot", ...f.target(sessionId, workId) })).toEqual(frozen);
  expect(await f.command({ op: "events", ...f.target(sessionId, workId), cursor: next.cursor })).toMatchObject({ events: [], gap: true, cursor: next.cursor });
}));

test("snapshot hints alone preserve completeness; skipped sequences, native events and foreign read identity are explicit", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(); f.page(workId, [usage(1)]); f.text(workId, "Complete");
  expect((await f.command({ op: "conversations.get", sessionId })).history.limited).toBe(false);
  f.faults.eventIdentity = true;
  await expect(f.command({ op: "events", ...f.target(sessionId, workId) })).rejects.toMatchObject({ code: "conflict" });
  f.faults.eventIdentity = false;
  f.page(workId, [usage(3)]);
  expect((await f.command({ op: "conversations.get", sessionId })).history.limited).toBe(true);
  f.page(workId, [{ sequence: 4, at: new Date().toISOString(), kind: "native", payload: { type: "text_delta", delta: "not a Coding event" } }]);
  const events = await f.command({ op: "events", ...f.target(sessionId, workId) });
  expect(events).toMatchObject({ events: [], gap: true, snapshotRequired: true });
  expect((await f.command({ op: "conversations.get", sessionId })).history.messages.find((item: { author: string }) => item.author === "编码助手").content).toBe("Complete");
}));

test("Unicode assistant history and long user history remain recoverable through bounded pages", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(), second = await f.create("second");
  const list = await f.command({ op: "conversations.list", limit: 1 });
  expect(list.sessions.map((item: { id: string }) => item.id)).toEqual([sessionId]);
  expect((await f.command({ op: "conversations.list", after: list.after, limit: 1 })).sessions[0].id).toBe(second);
  for (let index = 0; index < 8; index++) await f.send(sessionId, `long-${index}`, workId, `${index}:` + "x".repeat(19000));
  const reply = "界🙂".repeat(16000);
  f.text(workId, reply);
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

for (const kind of ["nonGit", "unborn"] as const) test(`fresh ${kind} snapshot result retains final reply with explicit unavailable changes`, () => fixture(async f => {
  if (kind === "unborn") git(f.projectPath, "init", "--quiet");
  const { sessionId, workId } = await f.begin(); f.finish(workId);
  const [result] = (await f.command({ op: "results", sessionId, workId })).results as ExecutionResult[];
  expect(result!.baseline.kind).toBe("snapshot");
  const artifact = JSON.parse(Buffer.from((await f.command({ op: "read-result", sessionId, workId, resultId: result!.resultId })).base64, "base64").toString());
  expect(artifact.finalMessage.text).toContain("Checks not run");
  expect(artifact.changes).toMatchObject({ status: "unavailable", reason: "snapshot_unresolvable" });
  const current = await f.command({ op: "conversations.get", sessionId });
  expect(current.history.messages.find((item: { author: string }) => item.author === "编码助手").content).toContain("Checks not run");
}));

function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" }, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}
async function committedProject(path: string) {
  git(path, "init", "--quiet"); await writeFile(join(path, "tracked.txt"), "base\n");
  git(path, "add", "."); git(path, "commit", "--quiet", "-m", "fixture");
  return git(path, "rev-parse", "HEAD");
}

test("fresh Git results retain baseline evidence, immutable bytes and scoped replayable acceptance", () => fixture(async f => {
  const head = await committedProject(f.projectPath);
  const { sessionId, workId } = await f.begin();
  await writeFile(join(f.projectPath, "tracked.txt"), "first round\n"); f.finish(workId);
  const baseline = { kind: "commit" as const, digest: head };
  const [result] = (await f.command({ op: "results", sessionId, workId })).results as ExecutionResult[];
  const artifactRef = result!.artifactRef, path = join(f.context.dir, "artifacts", `${artifactRef}.json`), bytes = await readFile(path, "utf8");
  expect(JSON.parse(bytes).changes.patch).toContain("+first round");
  await rename(f.projectPath, join(f.context.dir, "moved"));
  f.faults.offline = true;
  expect((await f.command({ op: "results", sessionId, workId }, { ...f.context })).results[0].resultId).toBe(result!.resultId);
  expect(result!.accepted).toBe(false); expect(result!.checks).toEqual([]); expect(result!.baseline).toEqual(baseline);
  const read = { op: "read-result", sessionId, workId, resultId: result!.resultId };
  expect(Buffer.from((await f.command(read)).base64, "base64").toString()).toBe(bytes);
  expect(await readFile(join(f.context.content, `${artifactRef}.json`), "utf8")).toBe(bytes);
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
  expect(f.calls.every(call => ["agent.run", "agent.read"].includes(call.target))).toBe(true);
}));

test("continuation freezes its parent's Git observation before dispatch and retains separate round results", () => fixture(async f => {
  const head = await committedProject(f.projectPath);
  await writeFile(join(f.projectPath, "admission-dirt"), "already dirty\n");
  const { sessionId, workId } = await f.begin();
  await writeFile(join(f.projectPath, "tracked.txt"), "first round\n"); f.finish(workId);
  const next = await f.send(sessionId, "second-round", workId), second = next.receipt.workId;
  expect(next.receipt.status).toBe("accepted");
  const evidence = JSON.parse(await readFile(join(f.context.dir, "sessions", `evidence-${digest(workId)}.json`), "utf8"));
  expect(evidence.stage).toBe("frozen"); expect(evidence.source.baseline).toEqual({ kind: "commit", digest: head });
  expect(evidence.source.changes.patch).toContain("+first round");
  expect(evidence.source.changes.files.find((file: { path: string }) => file.path === "admission-dirt").text).toBe("already dirty\n");
  await writeFile(join(f.projectPath, "tracked.txt"), "second round\n"); f.finish(second);
  const artifact = async (id: string) => {
    const result = (await f.command({ op: "results", sessionId, workId: id })).results[0];
    return Buffer.from((await f.command({ op: "read-result", sessionId, workId: id, resultId: result.resultId })).base64, "base64").toString();
  };
  const first = await artifact(workId), later = await artifact(second);
  expect(JSON.parse(first).changes.patch).toContain("+first round"); expect(JSON.parse(first).changes.patch).not.toContain("+second round");
  expect(JSON.parse(later).changes.patch).toContain("+second round"); expect(await artifact(workId)).toBe(first);
}));

test("startup observation recovers a lost admission receipt, freezes stop evidence and supports offline fresh publication", () => fixture(async f => {
  await committedProject(f.projectPath); f.faults.startAfter = true;
  const sessionId = await f.create(), receipt = await f.send(sessionId), workId = receipt.receipt.workId;
  expect(receipt.receipt.status).toBe("pending");
  await writeFile(join(f.projectPath, "tracked.txt"), "recovered round\n"); f.finish(workId);
  const { observeCodingEvidence } = await import("./external/coding/evidence-observer");
  await observeCodingEvidence({ ...f.context });
  expect(f.calls.filter(call => call.target === "agent.run")).toHaveLength(1);
  expect(f.lookups.some(item => item.target === "agent.run")).toBe(true);
  await rename(f.projectPath, join(f.context.dir, "moved")); f.faults.offline = true;
  const [result] = (await f.command({ op: "results", sessionId, workId })).results;
  const artifact = JSON.parse(Buffer.from((await f.command({ op: "read-result", sessionId, workId, resultId: result.resultId })).base64, "base64").toString());
  expect(artifact.changes.patch).toContain("+recovered round");
}));

test("unknown admission and unconfirmed stop cannot produce frozen evidence during startup observation", () => fixture(async f => {
  f.faults.startBefore = "unavailable";
  const sessionId = await f.create(), receipt = await f.send(sessionId), workId = receipt.receipt.workId;
  const { observeCodingEvidence } = await import("./external/coding/evidence-observer");
  await observeCodingEvidence({ ...f.context });
  await expect(readFile(join(f.context.dir, "sessions", `evidence-${digest(workId)}.json`))).rejects.toMatchObject({ code: "ENOENT" });
  expect(f.calls.filter(call => call.target === "agent.run")).toHaveLength(1);
}));

test("unwritable parent evidence prevents continuation dispatch until a durable freeze is possible", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(); f.finish(workId);
  const path = join(f.context.dir, "sessions", `evidence-${digest(workId)}.json`); await mkdir(path);
  await expect(f.send(sessionId, "blocked-continuation", workId)).rejects.toThrow();
  expect(f.calls.filter(call => call.target === "agent.run")).toHaveLength(1);
  await rm(path, { recursive: true });
  expect((await f.send(sessionId, "restored-continuation", workId)).receipt.status).toBe("accepted");
}));
