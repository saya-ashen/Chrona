import { expect, mock, spyOn, test } from "bun:test";
import * as filesystem from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionView, ExecutionSnapshot, ExecutionResult } from "./contract.js";
import type { CodingContext } from "./types";

// No SDK socket, model, host project, or database is involved in domain tests.
mock.module("chrona", () => ({ ModelError: class extends Error { constructor(readonly code: string, message: string) { super(message); } } }));
const { handleCodingCommand } = await import("./service");
const { loadSessions } = await import("./sessions");
const { compileModuleOutput, moduleManifestSchema } = await import("@chrona/contracts/steward");
type Reply = { receipt: { requestKey: string; status: string; sessionId: string; workId: string; value: any; error?: { code: string } } };
const principal = { workspaceId: "fixture-workspace", ownerId: "owner", caller: { kind: "module", moduleId: "coding", hash: "fixture-hash" } };
const fault = (code: string) => Object.assign(new Error(code), { code });
async function fixture(run: (fake: Awaited<ReturnType<typeof makeFake>>) => Promise<void>) {
  const fake = await makeFake(); try { await run(fake); } finally { await rm(fake.context.dir, { recursive: true, force: true }); }
}
async function makeFake() {
  const dir = await mkdtemp(join(tmpdir(), "coding-domain-"));
  const views = new Map<string, ExecutionView>(), starts = new Map<string, ExecutionView>(), controls = new Map<string, unknown>();
  const snapshots = new Map<string, ExecutionSnapshot>(), calls: { target: string; args: Record<string, any> }[] = [];
  const registered = [{ projectRef: "repo", path: "/fixture/repo", label: "Fixture" }];
  const faults = { startBefore: false, startAfter: false, stopAfter: false, stopUnknown: false, writeAfter: false, questionIdentity: false, invalidControl: false, invalidStop: false, rejectAnswer: false, answerConflict: false, malformedRejection: false, largeSource: false, largeEvent: false, projectReply: undefined as unknown };
  const context: CodingContext = { dir, content: join(dir, "public"), async call<T>(target: string, args: Record<string, any>): Promise<T> {
    calls.push({ target, args: structuredClone(args) });
    if (target === "agent.work-projects") {
      if (faults.projectReply !== undefined) return faults.projectReply as T;
      if (args.action === "list") return { action: "list", principal, projects: registered } as T;
      const journal = await loadSessions(context);
      expect(journal.commands.at(-1)?.receipt.status).toBe("pending");
      const item = { projectRef: `project-${registered.length}`, path: args.action === "create" ? `/fixture/created/${args.name}` : String(args.path), label: String(args.name ?? "Project") }; registered.push(item); return { action: args.action, principal, project: item } as T;
    }
    const workId = String(args["execution-id"]), key = String(args["request-key"]);
    if (target === "agent.work-lookup") { const view = starts.get(key); if (!view) throw fault("not_found"); return { ...view } as T; }
    if (target === "agent.work-run") {
      const journal = await loadSessions(context), session = journal.sessions.find(item => item.currentWorkId === workId);
      expect(session?.turns.at(-1)?.start?.workId).toBe(workId);
      expect(session?.turns.at(-1)?.accepted).toBe(false);
      expect(journal.commands.find(item => item.command.requestKey === key)?.receipt.status).toBe("pending");
      // The execution start journal is durable independently of the conversation journal.
      expect(JSON.parse(await readFile(join(dir, `${workId}.json`), "utf8")).start.commandKey).toBe(key);
      if (faults.startBefore) throw fault("unavailable");
      const previous = starts.get(key); if (previous) return { execution: { ...previous } } as T;
      const parent = args["resume-from"] ? views.get(args["resume-from"]["work-id"]) : undefined;
      if (parent) expect(parent.stopConfirmed).toBe(true);
      const view: ExecutionView = { workId, sessionId: parent?.sessionId ?? `agent-${workId}`, runId: `run-${workId}`, attemptId: `attempt-${workId}`, projectRef: String(args["project-ref"]), status: "running", cancelRequested: false, stopConfirmed: false };
      views.set(workId, view); starts.set(key, view);
      snapshots.set(workId, { workId, sessionId: view.sessionId, runId: view.runId, attemptId: view.attemptId, status: view.status, cancelRequested: false, stopConfirmed: false, highWatermark: 0, finalMessage: null, questions: [], missing: false, expiresAt: "2099-12-01T00:00:00Z" });
      if (faults.startAfter) { faults.startAfter = false; throw fault("unavailable"); }
      return { execution: { ...view } } as T;
    }
    const view = views.get(workId); if (!view) throw fault("not_found");
    if (target === "agent.work-get") return { ...view } as T;
    if (target === "agent.work-stream") return { events: faults.largeEvent ? Array.from({ length: 8 }, (_, index) => ({ workId, sessionId: view.sessionId, runId: view.runId, attemptId: view.attemptId, seq: index + 1, at: "2026-01-01T00:00:00Z", payload: { type: "message", messageId: `large-${index}`, role: "assistant", text: "\u0001".repeat(5000), complete: true } })) : [], cursor: "cursor-0", highWatermark: 0, gap: false, snapshotRequired: false } as T;
    if (target === "agent.work-inspect") {
      const snapshot = { ...snapshots.get(workId)!, status: view.status, cancelRequested: view.cancelRequested, stopConfirmed: view.stopConfirmed };
      if (faults.questionIdentity) snapshot.sessionId = "alien";
      return { snapshot, source: { workId, sessionId: view.sessionId, runId: view.runId, attemptId: view.attemptId, baseline: { kind: "commit", digest: "fixture-baseline" }, changes: { scope: "baseline_to_worktree", status: "complete", patch: faults.largeSource ? "\u0001".repeat(20_000) : "diff --git a/f b/f\n+fixture\n", files: [{ path: "f", kind: "tracked" }] } } } as T;
    }
    if (["agent.work-write", "agent.work-respond", "agent.work-interrupt"].includes(target)) {
      expect(args["run-id"]).toBe(view.runId); expect(args["attempt-id"]).toBe(view.attemptId);
      const journal = await loadSessions(context);
      expect(journal.commands.find(item => item.command.requestKey === key)?.receipt.status).toBe("pending");
      if (controls.has(key)) return structuredClone(controls.get(key)) as T;
      if (target === "agent.work-interrupt") {
        view.cancelRequested = true;
        if (faults.stopUnknown) view.status = "unknown";
        const reply = { ...view }; controls.set(key, reply);
        if (faults.stopAfter) { faults.stopAfter = false; throw fault("unavailable"); }
        return (faults.invalidStop ? { ...reply, attemptId: "alien" } : reply) as T;
      }
      if (target === "agent.work-respond" && faults.answerConflict) throw fault("conflict");
      if (target === "agent.work-respond" && faults.rejectAnswer) return { accepted: false, error: { code: "conflict", message: "Question already answered" }, ...(faults.malformedRejection ? { extra: true } : {}) } as T;
      const reply = { accepted: true }; controls.set(key, reply);
      if (target === "agent.work-respond") {
        expect(args["question-id"]).toBe("question-1");
        snapshots.get(workId)!.questions[0]!.status = "answered";
      }
      if (faults.writeAfter) { faults.writeAfter = false; throw fault("unavailable"); }
      return (faults.invalidControl ? { accepted: false } : reply) as T;
    }
    throw new Error(`Unexpected tool ${target}`);
  } };
  const command = (raw: unknown, client = context) => handleCodingCommand(client, raw) as Promise<any>;
  async function create(requestKey = "create-1") { return ((await command({ op: "conversations.create", requestKey, projectRef: "repo", title: "Fixture conversation" })) as Reply).receipt.sessionId; }
  async function send(sessionId: string, requestKey = "send-1", workId: string | null = null, text = "Implement fixture") { return await command({ op: "round.send", requestKey, sessionId, workId, text }) as Reply; }
  async function begin() { const sessionId = await create(); const sent = await send(sessionId); return { sessionId, workId: sent.receipt.workId }; }
  function target(sessionId: string, workId: string) { const view = views.get(workId)!; return { sessionId, workId, runId: view.runId, attemptId: view.attemptId }; }
  function finish(workId: string) { const view = views.get(workId)!; view.status = "completed"; view.stopConfirmed = true; snapshots.get(workId)!.finalMessage = { messageId: "final-1", text: "Fixture changed. Checks not run.", truncated: false }; }
  return { context, command, calls, views, snapshots, faults, create, send, begin, target, finish, controls };
}

test("two clients share explicit conversations, duplicate receipts and one continued Agent session", () => fixture(async f => {
  const first = await f.create(), second = await f.create("create-2"), clientB = { ...f.context };
  const raw = { op: "round.send", requestKey: "send-1", sessionId: first, workId: null, text: "Implement fixture" };
  const [a, b] = await Promise.all([f.command(raw), f.command({ ...raw }, clientB)]);
  expect(a).toEqual(b); expect(a.receipt.status).toBe("accepted");
  const workId = a.receipt.workId;
  expect(f.calls.filter(item => item.target === "agent.work-run")).toHaveLength(1);
  await expect(f.command({ ...raw, text: "Different arguments" })).rejects.toMatchObject({ code: "conflict" });
  const write = await f.send(first, "write-1", workId, "Follow up while running");
  expect(write.receipt.workId).toBe(workId); expect(f.controls.size).toBe(1);
  await f.send(second, "other-start");
  f.finish(workId);
  const continued = await f.send(first, "continue-1", workId, "Next round");
  const next = continued.receipt.workId;
  expect(next).not.toBe(workId); expect(f.views.get(next)!.sessionId).toBe(f.views.get(workId)!.sessionId);
  expect(f.views.get(next)!.runId).not.toBe(f.views.get(workId)!.runId);
  await expect(f.send(first, "stale", workId)).rejects.toMatchObject({ code: "conflict" });
  const journal = await loadSessions(f.context);
  expect(journal).not.toHaveProperty("selected"); expect(journal).not.toHaveProperty("draftProject");
  expect(journal.sessions.find(item => item.id === first)!.currentWorkId).toBe(next);
  expect(journal.sessions.find(item => item.id === second)!.workIds).toHaveLength(1);
  const before = f.calls.filter(item => item.target === "agent.work-run").length;
  await f.command({ op: "conversations.get", sessionId: first });
  expect(f.calls.filter(item => item.target === "agent.work-run")).toHaveLength(before);
}));

test("unknown admission remains pending across restart; reads and duplicate commands never resend", () => fixture(async f => {
  const sessionId = await f.create(); f.faults.startAfter = true;
  const first = await f.send(sessionId); expect(first.receipt.status).toBe("pending");
  expect((await f.send(sessionId)).receipt.status).toBe("pending");
  await f.command({ op: "conversations.get", sessionId }, { ...f.context });
  expect(f.calls.filter(item => item.target === "agent.work-run")).toHaveLength(1);
  await expect(f.send(sessionId, "new-key", first.receipt.workId)).rejects.toMatchObject({ code: "conflict" });
  const retry = await f.command({ op: "round.retry", requestKey: "retry-1", sessionId, originalRequestKey: "send-1" }, { ...f.context });
  expect(retry.receipt.status).toBe("accepted"); expect(retry.receipt.value.receipt.status).toBe("accepted");
  expect(f.calls.filter(item => item.target === "agent.work-run")).toHaveLength(1);
  expect((await f.command({ op: "receipt", requestKey: "send-1" })).receipt.workId).toBe(first.receipt.workId);
}));

test("explicit retry resubmits an unadmitted start with the durable original identity", () => fixture(async f => {
  const sessionId = await f.create(); f.faults.startBefore = true;
  const pending = await f.send(sessionId); expect(pending.receipt.status).toBe("pending");
  await f.command({ op: "conversations.get", sessionId });
  expect(f.calls.filter(item => item.target === "agent.work-run")).toHaveLength(1);
  f.faults.startBefore = false;
  await f.command({ op: "round.retry", requestKey: "retry-1", sessionId, originalRequestKey: "send-1" });
  const starts = f.calls.filter(item => item.target === "agent.work-run"); expect(starts).toHaveLength(2); expect(starts[0]!.args).toEqual(starts[1]!.args);
}));

test("unknown stop fences advancement and stop recovery retains exact run and key", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(); const target = f.target(sessionId, workId);
  f.faults.stopAfter = true; f.faults.stopUnknown = true;
  const stop = { op: "round.stop", requestKey: "stop-1", ...target };
  expect((await f.command(stop)).receipt.status).toBe("pending");
  expect((await f.command(stop)).receipt.status).toBe("pending");
  expect(f.calls.filter(item => item.target === "agent.work-interrupt")).toHaveLength(1);
  await expect(f.send(sessionId, "next", workId)).rejects.toMatchObject({ code: "conflict" });
  await f.command({ op: "round.retry", requestKey: "retry-stop", sessionId, originalRequestKey: "stop-1" });
  expect((await f.send(sessionId, "next", workId)).receipt.status).toBe("rejected");
  await expect(f.command({ ...stop, requestKey: "stale-stop", attemptId: "old-attempt" })).rejects.toMatchObject({ code: "conflict" });
  expect(f.calls.filter(item => item.target === "agent.work-run")).toHaveLength(1);
  f.finish(workId); await f.send(sessionId, "next-after-stop", workId);
  expect(f.calls.filter(item => item.target === "agent.work-run")).toHaveLength(2);
}));

test("malformed control acknowledgements retain pending identities until explicit recovery", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(); f.faults.invalidControl = true;
  expect((await f.send(sessionId, "write", workId)).receipt.status).toBe("pending");
  expect((await f.send(sessionId, "write", workId)).receipt.status).toBe("pending");
  expect(f.calls.filter(call => call.target === "agent.work-write")).toHaveLength(1);
  await expect(f.send(sessionId, "blocked", workId)).rejects.toMatchObject({ code: "conflict" });
  f.faults.invalidControl = false;
  await f.command({ op: "round.retry", requestKey: "recover-write", sessionId, originalRequestKey: "write" });
  expect((await f.command({ op: "receipt", requestKey: "write" })).receipt.status).toBe("accepted");
  f.faults.invalidStop = true;
  const stop = { op: "round.stop", requestKey: "stop", ...f.target(sessionId, workId) };
  expect((await f.command(stop)).receipt.status).toBe("pending");
  await expect(f.send(sessionId, "blocked-stop", workId)).rejects.toMatchObject({ code: "conflict" });
  f.faults.invalidStop = false;
  await f.command({ op: "round.retry", requestKey: "recover-stop", sessionId, originalRequestKey: "stop" });
  expect((await f.command({ op: "receipt", requestKey: "stop" })).receipt.status).toBe("accepted");
  await expect(f.send(sessionId, "blocked-stopping", workId)).rejects.toMatchObject({ code: "conflict" });
  expect(f.calls.filter(call => call.target === "agent.work-run")).toHaveLength(1);
}));

test("answers bind conversation, run, attempt and live pending question identity", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(); const target = f.target(sessionId, workId);
  const other = await f.create("other");
  f.snapshots.get(workId)!.questions = [{ requestId: "question-1", title: "Proceed?", method: "confirm", options: [], status: "pending", expiresAt: "2099-12-01T00:00:00Z" }];
  const raw = { op: "round.answer", requestKey: "answer-1", ...target, questionId: "question-1", text: "是" };
  await expect(f.command({ ...raw, requestKey: "wrong-session", sessionId: other })).rejects.toMatchObject({ code: "conflict" });
  await expect(f.command({ ...raw, requestKey: "wrong-run", runId: "old-run" })).rejects.toMatchObject({ code: "conflict" });
  await expect(f.command({ ...raw, requestKey: "wrong-question", questionId: "old-question" })).rejects.toMatchObject({ code: "conflict" });
  f.faults.questionIdentity = true; await expect(f.command({ ...raw, requestKey: "wrong-snapshot" })).rejects.toMatchObject({ code: "conflict" }); f.faults.questionIdentity = false;
  expect((await f.command(raw)).receipt.status).toBe("accepted");
  expect((await f.command(raw)).receipt.status).toBe("accepted");
  const replies = f.calls.filter(item => item.target === "agent.work-respond"); expect(replies).toHaveLength(1);
  expect(JSON.parse(replies[0]!.args.answer)).toEqual({ decision: "submit", value: true });
  await expect(f.command({ ...raw, requestKey: "answer-2" })).rejects.toMatchObject({ code: "conflict" });
}));

test("immutable results are scoped, verified, accepted once and never committed", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(); f.finish(workId);
  const [result] = (await f.command({ op: "results", sessionId, workId })).results as ExecutionResult[];
  expect(result!.accepted).toBe(false);
  const path = join(f.context.content, `${result!.artifactRef}.json`), bytes = await readFile(path, "utf8");
  const read = { op: "read-result", sessionId, workId, resultId: result!.resultId };
  expect(Buffer.from((await f.command(read)).base64, "base64").toString()).toBe(bytes);
  const other = await f.create("other");
  await expect(f.command({ ...read, sessionId: other })).rejects.toMatchObject({ code: "not_found" });
  await expect(f.command({ ...read, resultId: "alien" })).rejects.toMatchObject({ code: "not_found" });
  const accept = { op: "accept", requestKey: "accept-1", sessionId, workId, resultId: result!.resultId };
  expect((await f.command(accept)).receipt.value).toEqual({ accepted: true }); await f.command(accept);
  expect((await f.command({ op: "results", sessionId, workId })).results[0].accepted).toBe(true);
  expect(await readFile(path, "utf8")).toBe(bytes);
  await writeFile(join(f.context.dir, "artifacts", `${result!.artifactRef}.json`), `${bytes} `);
  await expect(f.command(read)).rejects.toMatchObject({ code: "conflict" });
  expect(f.calls.every(item => ["agent.work-projects", "agent.work-run", "agent.work-get", "agent.work-lookup", "agent.work-stream", "agent.work-inspect"].includes(item.target))).toBe(true);
}));

test("project registry uses Agent only, default is shared business preference and requests are strict", () => fixture(async f => {
  const register = { op: "projects.register", requestKey: "register", path: "/fixture/new" };
  const first = await f.command(register); expect(await f.command(register)).toEqual(first);
  await f.command({ op: "projects.create", requestKey: "create-project", name: "created" });
  await f.command({ op: "projects.default", requestKey: "default", projectRef: first.receipt.value.projectRef });
  expect((await f.command({ op: "projects.list" })).defaultProjectRef).toBe(first.receipt.value.projectRef);
  expect(f.calls.filter(item => item.target === "agent.work-projects" && item.args.action === "register")).toHaveLength(1);
  for (const raw of [null, [], { op: "projects.list", cwd: "/tmp" }, { op: "round.send", requestKey: "k", sessionId: "s", text: "hi" }, { op: "projects.register", requestKey: "../escape", path: "/tmp" }, { op: "projects.create", requestKey: "k", path: "relative" }, { op: "conversations.get", sessionId: "../escape" }, { op: "events", sessionId: "s", workId: "w", runId: "r", attemptId: "a", limit: 101 }, { op: "conversations.create", requestKey: "x", projectRef: "repo", title: "x".repeat(201) }]) await expect(f.command(raw)).rejects.toMatchObject({ code: "invalid" });
  await expect(f.command({ op: "round.send", requestKey: "large", sessionId: "s", workId: null, text: "界".repeat(20_000) })).rejects.toMatchObject({ code: "too_large" });
  const manifest = moduleManifestSchema.parse(await Bun.file(join(import.meta.dir, "module.json")).json());
  expect(manifest.tools.map(tool => tool.name)).toEqual(["command"]);
  expect(manifest.tools[0]!.visibility).toEqual(["owner"]);
  expect(compileModuleOutput(manifest.tools[0]!.output!).safeParse(first).success).toBe(true);
  expect(manifest.listen).toBe("/api/coding"); expect(manifest.uses).toContain("*");
}));

test("conversation list, round summaries and full history remain paged without losing turns", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(); const second = await f.create("second");
  const page = await f.command({ op: "conversations.list", limit: 1 });
  expect(page.sessions.map((item: { id: string }) => item.id)).toEqual([sessionId]); expect(page.after).toBe(sessionId);
  expect((await f.command({ op: "conversations.list", limit: 1, after: page.after })).sessions[0].id).toBe(second);
  for (let index = 0; index < 8; index++) await f.send(sessionId, `long-${index}`, workId, `${index}:` + "x".repeat(19_000));
  const latest = await f.command({ op: "conversations.get", sessionId });
  expect(Buffer.byteLength(JSON.stringify(latest.session.turns))).toBeLessThan(32_100);
  expect(latest.session.hasEarlierTurns).toBe(true); expect(latest.history.hasEarlier).toBe(true);
  const earlier = await f.command({ op: "conversations.get", sessionId, before: latest.history.before });
  expect(earlier.history.messages[0].content).toBe("Implement fixture");
  const all = [...earlier.history.messages, ...latest.history.messages];
  expect(new Set(all.map((item: { id: string }) => item.id)).size).toBe(9);
  expect(all.at(-1).content).toBe("7:" + "x".repeat(19_000));
  await expect(f.command({ op: "conversations.get", sessionId, workBefore: "alien" })).rejects.toMatchObject({ code: "invalid" });
}));

for (const op of ["conversations.create", "projects.default"] as const) {
  for (const lostReply of [false, true]) test(`${op} atomically commits acceptance and state through ${lostReply ? "lost reply" : "save interruption"}`, () => fixture(async f => {
    const raw = op === "conversations.create" ? { op, requestKey: "local", projectRef: "repo", title: "Atomic" } : { op, requestKey: "local", projectRef: "repo" };
    const original = filesystem.rename; let replacements = 0;
    const interrupted = spyOn(filesystem, "rename").mockImplementation(async (from, to) => {
      replacements++;
      expect(JSON.parse(await readFile(String(from), "utf8")).commands.at(-1).receipt.status).toBe("accepted");
      if (lostReply) await original(from, to);
      throw fault("interrupted");
    });
    try { await expect(f.command(raw)).rejects.toMatchObject({ code: "interrupted" }); } finally { interrupted.mockRestore(); }
    expect(replacements).toBe(1);
    const persisted = await loadSessions({ ...f.context });
    expect(persisted.commands).toHaveLength(lostReply ? 1 : 0);
    if (lostReply) expect(persisted.commands[0]!.receipt.status).toBe("accepted");
    const retry = await f.command(raw, { ...f.context });
    expect(retry.receipt.status).toBe("accepted");
    const recovered = await loadSessions(f.context);
    expect(recovered.commands).toHaveLength(1);
    if (op === "conversations.create") expect(recovered.sessions.map(item => item.id)).toEqual([retry.receipt.sessionId]);
    else expect(recovered.defaultProjectRef).toBe("repo");
  }));
}

test("only exact pre-admission answer rejection rejects a turn; unknown conflicts remain pending", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(), target = f.target(sessionId, workId);
  const question = { requestId: "question-1", title: "Input", method: "input" as const, options: [], status: "pending" as const, expiresAt: "2099-12-01T00:00:00Z" };
  f.snapshots.get(workId)!.questions = [question];
  const raw = { op: "round.answer", requestKey: "rejected", ...target, questionId: "question-1", text: "" };
  f.faults.rejectAnswer = true;
  await expect(f.command(raw)).rejects.toMatchObject({ code: "conflict" });
  expect((await f.command({ op: "receipt", requestKey: raw.requestKey })).receipt.status).toBe("rejected");
  const journal = await loadSessions(f.context), turn = journal.sessions[0]!.turns.at(-1)!;
  expect(turn).toMatchObject({ accepted: false, rejected: { code: "conflict" }, text: "" });
  expect((await f.command(raw)).receipt.status).toBe("rejected");
  expect(f.calls.filter(call => call.target === "agent.work-respond")).toHaveLength(1);
  // A rejected answer does not fence ordinary follow-up turns.
  expect((await f.send(sessionId, "follow", workId)).receipt.status).toBe("accepted");
  f.faults.malformedRejection = true;
  expect((await f.command({ ...raw, requestKey: "unknown" })).receipt.status).toBe("pending");
  f.faults.rejectAnswer = false; f.faults.malformedRejection = false; f.faults.answerConflict = true;
  await f.command({ op: "round.retry", requestKey: "retry", sessionId, originalRequestKey: "unknown" });
  expect((await f.command({ op: "receipt", requestKey: "unknown" })).receipt.status).toBe("pending");
}));

test("input/editor answers preserve empty and whitespace text while send remains nonblank", () => fixture(async f => {
  const { sessionId, workId } = await f.begin();
  for (const [index, text] of ["", " \t\n", "x".repeat(8000)].entries()) {
    f.snapshots.get(workId)!.questions = [{ requestId: "question-1", title: "Input", method: index === 1 ? "editor" : "input", options: [], status: "pending", expiresAt: "2099-12-01T00:00:00Z" }];
    expect((await f.command({ op: "round.answer", requestKey: `answer-${index}`, ...f.target(sessionId, workId), questionId: "question-1", text })).receipt.status).toBe("accepted");
    expect(JSON.parse(f.calls.filter(call => call.target === "agent.work-respond").at(-1)!.args.answer)).toEqual({ decision: "submit", value: text });
  }
  for (const text of ["\0", "x".repeat(8001)]) await expect(f.command({ op: "round.answer", requestKey: "bad", ...f.target(sessionId, workId), questionId: "question-1", text })).rejects.toMatchObject({ code: "invalid" });
  for (const text of ["", " \t\n"]) await expect(f.send(sessionId, "blank", workId, text)).rejects.toMatchObject({ code: "invalid" });
}));

test("project inputs and tagged Agent action/principal/output are strict and bounded", () => fixture(async f => {
  for (const raw of [
    { op: "projects.register", requestKey: "k", path: "/fixture/repo", name: "extra" },
    ...["../escape", "space name", "x".repeat(65), "a/b", "a\\b"].map(name => ({ op: "projects.create", requestKey: "k", name })),
    { op: "projects.create", requestKey: "k", name: "safe", path: "/fixture/repo" },
  ]) await expect(f.command(raw)).rejects.toMatchObject({ code: "invalid" });
  expect((await f.command({ op: "projects.create", requestKey: "safe", name: "a".repeat(64) })).receipt.status).toBe("accepted");
  expect(f.calls.find(call => call.args.action === "create")!.args).toEqual({ action: "create", name: "a".repeat(64) });
  const item = { projectRef: "repo", path: "/fixture/repo", label: "Fixture" };
  for (const reply of [
    { projects: [item] }, { action: "register", principal, projects: [item] },
    { action: "list", principal: { ...principal, ownerId: "other" }, projects: [item] },
    { action: "list", principal: { ...principal, caller: { ...principal.caller, extra: true } }, projects: [item] },
    { action: "list", principal, projects: [item], extra: true },
    { action: "list", principal, projects: Array.from({ length: 101 }, (_, i) => ({ ...item, projectRef: `p${i}` })) },
  ]) { f.faults.projectReply = reply; await expect(f.command({ op: "projects.list" })).rejects.toMatchObject({ code: "conflict" }); }
  f.faults.projectReply = { action: "register", principal, project: item };
  expect((await f.command({ op: "projects.create", requestKey: "wrong-action", name: "safe" })).receipt.status).toBe("pending");
}));

test("encoded envelopes bound escaped event/snapshot pages and explicitly omit conversation snapshots", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(), target = f.target(sessionId, workId);
  const { executionEventPageSchema, executionSnapshotSchema } = await import("./contract.js");
  const wireBytes = (value: unknown) => Buffer.byteLength(JSON.stringify({ result: { result: value } }));
  f.faults.largeEvent = true;
  const agentPage = await f.context.call("agent.work-stream", { "execution-id": workId });
  expect(executionEventPageSchema.safeParse(agentPage).success).toBe(true);
  expect(wireBytes(agentPage)).toBeGreaterThan(230 * 1024);
  await expect(f.command({ op: "events", ...target, limit: 100 })).rejects.toMatchObject({ code: "too_large" });
  await expect(f.command({ op: "events", ...target, limit: 101 })).rejects.toMatchObject({ code: "invalid" });
  f.faults.largeEvent = false;
  const snapshot = f.snapshots.get(workId)!;
  snapshot.finalMessage = { messageId: "large-final", text: "\u0001".repeat(24_000), truncated: false };
  snapshot.questions = Array.from({ length: 2 }, (_, i) => ({ requestId: `question-${i}`, title: "Select", method: "select", options: Array(30).fill("\u0001".repeat(300)), status: "pending", expiresAt: "2099-12-01T00:00:00Z" }));
  expect(executionSnapshotSchema.safeParse(snapshot).success).toBe(true);
  expect(wireBytes(snapshot)).toBeGreaterThan(230 * 1024);
  await expect(f.command({ op: "snapshot", ...target })).rejects.toMatchObject({ code: "too_large" });
  const detail = await f.command({ op: "conversations.get", sessionId });
  expect(detail.history).toMatchObject({ snapshot: null, snapshotOmitted: true, limited: true });
  expect(wireBytes(detail)).toBeLessThanOrEqual(230 * 1024);
  expect(detail.view).not.toHaveProperty("finalMessage");
  // A failure encoding an already accepted duplicate never demotes the saved receipt.
  const journal = await loadSessions(f.context), entry = journal.commands.find(item => item.command.requestKey === "send-1")!;
  entry.receipt.value = { escaped: "\u0001".repeat(40_000) };
  const { saveSessions } = await import("./sessions"); await saveSessions(f.context, journal);
  await expect(f.send(sessionId)).rejects.toMatchObject({ code: "too_large" });
  expect((await loadSessions(f.context)).commands.find(item => item.command.requestKey === "send-1")!.receipt.status).toBe("accepted");
}));

test("result artifacts bound escaped JSON and base64 plus envelope with explicit omissions", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(); f.finish(workId); f.faults.largeSource = true;
  f.snapshots.get(workId)!.finalMessage = { messageId: "final-1", text: "\u0001".repeat(24_000), truncated: false };
  const [result] = (await f.command({ op: "results", sessionId, workId })).results;
  const read = await f.command({ op: "read-result", sessionId, workId, resultId: result.resultId });
  const bytes = Buffer.from(read.base64, "base64"), artifact = JSON.parse(bytes.toString());
  expect(bytes.byteLength).toBeLessThanOrEqual(96 * 1024);
  expect(artifact.changes).toMatchObject({ status: "partial", reason: "limit", patch: "" });
  expect(artifact.finalMessage).toMatchObject({ text: "", truncated: true }); expect(artifact.missing).toBe(true);
  expect(Buffer.byteLength(JSON.stringify({ result: { result: read } }))).toBeLessThanOrEqual(230 * 1024);
  // Exercise an artifact near the budget that survives intact, including escaped final text.
  const other = await f.create("near-create"), next = (await f.send(other, "near-send")).receipt.workId;
  f.finish(next); f.faults.largeSource = false;
  f.snapshots.get(next)!.finalMessage = { messageId: "final-1", text: "\u0001".repeat(16_000), truncated: false };
  const [near] = (await f.command({ op: "results", sessionId: other, workId: next })).results;
  const nearRead = await f.command({ op: "read-result", sessionId: other, workId: next, resultId: near.resultId });
  const nearBytes = Buffer.from(nearRead.base64, "base64");
  expect(nearBytes.byteLength).toBeGreaterThan(95_000); expect(nearBytes.byteLength).toBeLessThanOrEqual(96 * 1024);
  expect(JSON.parse(nearBytes.toString()).finalMessage.truncated).toBe(false);
  expect(Buffer.byteLength(JSON.stringify({ result: { result: nearRead } }))).toBeLessThanOrEqual(230 * 1024);
}));

for (const stale of [false, true]) test(`${stale ? "stale second-client" : "current stopping-round"} prepare rejection survives lost reply and exact replay without effects`, () => fixture(async f => {
  const { sessionId, workId } = await f.begin();
  if (stale) { f.finish(workId); await f.send(sessionId, "advance", workId); }
  else f.views.get(workId)!.cancelRequested = true;
  const raw = { op: "round.send" as const, requestKey: "rejected-prepare", sessionId, workId, text: "Second client" };
  const before = await loadSessions(f.context), effects = f.calls.filter(c => ["agent.work-run", "agent.work-write", "agent.work-respond", "agent.work-interrupt"].includes(c.target));
  await expect(f.command(raw)).rejects.toMatchObject({ code: "conflict" });
  // The first HTTP reply may be lost; querying with a fresh client still proves rejection.
  const queried = await f.command({ op: "receipt", requestKey: raw.requestKey }, { ...f.context });
  expect(queried.receipt).toMatchObject({ requestKey: raw.requestKey, op: raw.op, status: "rejected", error: { code: "conflict" } });
  const saved = await loadSessions(f.context), rejection = saved.commands.pop()!;
  expect(saved).toEqual(before); expect(rejection.command).toEqual(raw);
  expect(rejection.signature).toBe((await import("./commands")).commandSignature(raw as import("./commands").Mutation));
  if (!stale) f.views.get(workId)!.cancelRequested = false;
  const callCount = f.calls.length;
  expect(await f.command(raw, { ...f.context })).toEqual(queried);
  await expect(f.command({ ...raw, text: "Different" })).rejects.toMatchObject({ code: "conflict" });
  expect(f.calls).toHaveLength(callCount);
  expect(f.calls.filter(c => ["agent.work-run", "agent.work-write", "agent.work-respond", "agent.work-interrupt"].includes(c.target))).toEqual(effects);
}));

for (const code of ["invalid", "conflict", "not_found", "forbidden", "capacity", "unavailable", "EIO"]) test(`prepare ${code} records only definitive rejection and preserves the original error`, () => fixture(async f => {
  const raw = { op: "conversations.create", requestKey: "prepare-failure", projectRef: "repo", title: "Must not appear" };
  const error = fault(code), client: CodingContext = { ...f.context, async call() { throw error; } };
  const before = await loadSessions(f.context);
  await expect(f.command(raw, client)).rejects.toBe(error);
  const saved = await loadSessions(f.context);
  if (["unavailable", "EIO"].includes(code)) {
    expect(saved).toEqual(before);
    await expect(f.command({ op: "receipt", requestKey: raw.requestKey })).rejects.toMatchObject({ code: "not_found" });
  } else {
    const rejection = saved.commands.pop()!;
    expect(saved).toEqual(before);
    expect(rejection.receipt).toMatchObject({ status: "rejected", error: { code } });
    expect((await f.command(raw)).receipt).toEqual(rejection.receipt);
  }
}));

test("a failed prepare-rejection save preserves the journal and does not publish a receipt", () => fixture(async f => {
  const { sessionId } = await f.begin(), path = join(f.context.dir, "sessions", "index.json"), before = await readFile(path, "utf8");
  const raw = { op: "round.send", requestKey: "stale-save", sessionId, workId: null, text: "Stale" };
  const interrupted = spyOn(filesystem, "rename").mockImplementation(async () => { throw fault("EIO"); });
  try { await expect(f.command(raw)).rejects.toMatchObject({ code: "EIO" }); } finally { interrupted.mockRestore(); }
  expect(await readFile(path, "utf8")).toBe(before);
  await expect(f.command({ op: "receipt", requestKey: raw.requestKey })).rejects.toMatchObject({ code: "not_found" });
  await expect(f.command(raw)).rejects.toMatchObject({ code: "conflict" });
  expect((await f.command(raw)).receipt.status).toBe("rejected");
}));

for (const code of ["conflict", "not_found", "unavailable", "EIO"]) test(`external execute ${code} remains pending rather than creating prepare rejection evidence`, () => fixture(async f => {
  const raw = { op: "projects.register", requestKey: "external-failure", path: "/fixture/new" };
  const client: CodingContext = { ...f.context, async call() { throw fault(code); } };
  expect((await f.command(raw, client)).receipt.status).toBe("pending");
  expect((await f.command({ op: "receipt", requestKey: raw.requestKey })).receipt.status).toBe("pending");
  expect((await f.command(raw)).receipt.status).toBe("pending");
}));
