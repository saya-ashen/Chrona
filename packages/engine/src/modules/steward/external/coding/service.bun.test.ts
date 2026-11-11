import { expect, mock, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodingContext } from "./types";
import { kernelAgentInputs, kernelAgentOutputs } from "./kernel-contract.js";

mock.module("chrona", () => ({ ModelError: class extends Error { constructor(readonly code: string, message: string) { super(message); } } }));
mock.module("chrona/process", () => import("@chrona/process"));
const { handleCodingCommand } = await import("./service");
const { loadSessions } = await import("./sessions");
const { callAgent } = await import("./agent");
const { digest } = await import("./mutations");
const { handleWorkCommand, workPhase } = await import("./work-v2");
const { workStartSchema } = await import("./contract.js");
const { compileModuleOutput, moduleManifestSchema } = await import("@chrona/contracts/steward");
type Run = ReturnType<typeof kernelAgentOutputs.run.parse>;
type Page = ReturnType<typeof kernelAgentOutputs.read.parse>;
type Receipt = { requestKey: string; status: string; sessionId: string; workId: string; value: { receipt: Receipt }; error?: { code: string } };
const fault = (code: string) => Object.assign(new Error(code), { code });
async function fixture(body: (f: Awaited<ReturnType<typeof makeFake>>) => Promise<void>) {
  const f = await makeFake(); try { await body(f); } finally { await rm(f.context.dir, { recursive: true, force: true }); }
}
async function makeFake() {
  const dir = await mkdtemp(join(tmpdir(), "coding-seven-")), projectPath = join(dir, "repo"); await mkdir(projectPath);
  const runs = new Map<string, Run>(), pages = new Map<string, Page>();
  const receipts = new Map<string, { status: string; output?: unknown; error?: { code: string; message: string } }>();
  const calls: { target: string; args: Record<string, unknown>; key?: string }[] = [], lookups: { target: string; key: string }[] = [];
  const faults = { before: "", after: "", malformed: "", reject: "", unavailableLookup: false, stopUnknown: false, stopFalseTerminal: false, wrongRead: false, wrongQuestion: false };
  let projectRef = "";
  const context: CodingContext = { dir, content: join(dir, "content"), async call<T>(target: string, raw: Record<string, unknown>, options?: { key?: string }): Promise<T> {
    calls.push({ target, args: structuredClone(raw), ...(options?.key ? { key: options.key } : {}) });
    const name = target.slice(6) as keyof typeof kernelAgentInputs;
    expect(target.startsWith("agent.")).toBe(true); expect(Object.hasOwn(kernelAgentInputs, name)).toBe(true);
    const args = kernelAgentInputs[name].parse(raw) as Record<string, unknown>;
    if (target !== "agent.read") {
      expect(options?.key).toMatch(/^coding-[a-f0-9]{64}$/);
      const journal = await loadSessions(context); expect(journal.commands.some(item => item.receipt.status === "pending")).toBe(true);
      const key = `${target}:${options!.key}`;
      if (faults.reject === target) { faults.reject = ""; throw fault("invalid"); }
      if (faults.before === target) { faults.before = ""; throw fault("unavailable"); }
      let output: unknown;
      if (target === "agent.run") {
        const run: Run = { runId: `run-${runs.size + 1}`, contextId: String(args.contextId ?? `context-${runs.size + 1}`), status: "running", active: true };
        runs.set(run.runId, run); pages.set(run.runId, { run, items: [], nextCursor: null, ended: false, interactions: [], transcript: [] }); output = { ...run };
      } else {
        const run = runs.get(String(args.runId)); if (!run) throw fault("not_found");
        if (target === "agent.stop") {
          run.status = faults.stopUnknown ? "unknown" : "cancelled"; run.active = faults.stopUnknown;
          if (faults.stopFalseTerminal) { run.status = "cancelled"; run.active = false; }
          output = { ...run, stopConfirmed: !faults.stopUnknown && !faults.stopFalseTerminal };
        } else if (target === "agent.write") {
          const input = args.input as { kind: string; questionId?: string };
          if (input.kind === "answer") {
            const question = pages.get(run.runId)!.interactions.find(item => item.id === input.questionId && item.status === "pending");
            if (!question) throw fault("conflict"); question.status = "answered";
          }
          output = { accepted: true };
        } else throw fault("unsupported");
      }
      receipts.set(key, { status: "succeeded", output: structuredClone(output) });
      if (faults.after === target) { faults.after = ""; throw fault("unavailable"); }
      if (faults.malformed === target) { faults.malformed = ""; return {} as T; }
      return output as T;
    }
    const page = structuredClone(pages.get(String(args.runId))); if (!page) throw fault("not_found");
    if (faults.wrongRead) page.run.contextId = "alien";
    if (faults.wrongQuestion && page.interactions[0]) page.interactions[0].runId = "alien";
    return page as T;
  }, async callStatus(selector) {
    lookups.push({ ...selector }); if (faults.unavailableLookup) throw fault("unavailable");
    return receipts.get(`${selector.target}:${selector.key}`) ?? { status: "unknown" };
  } };
  const command = (raw: unknown, ctx = context) => handleCodingCommand(ctx, raw) as Promise<{ receipt: Receipt }>;
  const registration = await command({ op: "projects.register", requestKey: "register", path: projectPath });
  projectRef = (registration.receipt.value as unknown as { projectRef: string }).projectRef;
  const create = async (key = "create") => (await command({ op: "conversations.create", requestKey: key, projectRef, title: "Fixture" })).receipt.sessionId;
  const send = (sessionId: string, key = "send", workId: string | null = null, text = "Implement fixture") => command({ op: "round.send", requestKey: key, sessionId, workId, text });
  const begin = async () => { const sessionId = await create(), sent = await send(sessionId); return { sessionId, workId: sent.receipt.workId }; };
  const runFor = async (workId: string) => runs.get(JSON.parse(await readFile(join(dir, `${workId}.json`), "utf8")).ref.runId)!;
  const target = async (sessionId: string, workId: string) => { const run = await runFor(workId); return { sessionId, workId, runId: run.runId, attemptId: run.runId }; };
  const finish = async (workId: string, text = "Fixture changed. Checks not run.") => { const run = await runFor(workId); run.status = "finished"; run.active = false; pages.get(run.runId)!.transcript = [{ at: new Date().toISOString(), kind: "text", text }]; };
  const retry = (sessionId: string, key: string) => command({ op: "round.retry", requestKey: `retry-${key}`, sessionId, originalRequestKey: key }, { ...context });
  return { context, command, projectRef, projectPath, calls, runs, pages, receipts, lookups, faults, create, send, begin, runFor, target, finish, retry };
}

test("two clients share durable receipts; generic continuation retains context and creates a fresh run", () => fixture(async f => {
  const sessionId = await f.create(), second = await f.create("create-2");
  const raw = { op: "round.send", requestKey: "send", sessionId, workId: null, text: "Implement fixture" };
  const [a, b] = await Promise.all([f.command(raw), f.command(raw, { ...f.context })]);
  expect(a).toEqual(b); expect(a.receipt.status).toBe("accepted");
  const workId = a.receipt.workId, run = await f.runFor(workId);
  await expect(f.command({ ...raw, text: "Changed" })).rejects.toMatchObject({ code: "conflict" });
  await f.send(sessionId, "followup", workId); await f.send(second, "second");
  expect(f.calls.filter(call => call.target === "agent.write")[0]!.args).toEqual({ runId: run.runId, input: { kind: "message", text: "Implement fixture" } });
  await f.finish(workId); const next = await f.send(sessionId, "continue", workId);
  expect(next.receipt.status).toBe("accepted"); const continued = await f.runFor(next.receipt.workId);
  expect(continued.contextId).toBe(run.contextId); expect(continued.runId).not.toBe(run.runId);
  const start = f.calls.filter(call => call.target === "agent.run").at(-1)!;
  expect(start.args.contextId).toBe(run.contextId); expect(start.args.kind).toBe("conversation"); expect(start.args.providerOptions).toEqual({});
  expect(start.args).not.toHaveProperty("budget"); expect(start.args).not.toHaveProperty("workId"); expect(start.args).not.toHaveProperty("requestKey");
  expect(start.args.prompt).toContain(f.projectPath); expect(start.args.prompt).toContain("AGENTS.md");
  await expect(f.send(sessionId, "stale", workId)).rejects.toMatchObject({ code: "conflict" });
  const count = f.calls.filter(call => call.target === "agent.run").length;
  await f.command({ op: "conversations.get", sessionId }); expect(f.calls.filter(call => call.target === "agent.run")).toHaveLength(count);
}));

test("lost admission response recovers original callStatus across restart without replay", () => fixture(async f => {
  const sessionId = await f.create(); f.faults.after = "agent.run";
  const pending = await f.send(sessionId); expect(pending.receipt.status).toBe("pending");
  expect((await f.send(sessionId)).receipt.status).toBe("pending");
  await f.command({ op: "conversations.get", sessionId }, { ...f.context });
  await expect(f.send(sessionId, "new-key", pending.receipt.workId)).rejects.toMatchObject({ code: "conflict" });
  const result = await f.retry(sessionId, "send"); expect(result.receipt.value.receipt.status).toBe("accepted");
  const calls = f.calls.filter(call => call.target === "agent.run"); expect(calls).toHaveLength(1);
  expect(f.lookups.every(item => item.target === "agent.run" && item.key === calls[0]!.key)).toBe(true);
}));

test("missing admission receipt and unavailable callStatus never cause resubmission", () => fixture(async f => {
  const sessionId = await f.create(); f.faults.before = "agent.run";
  expect((await f.send(sessionId)).receipt.status).toBe("pending");
  f.faults.unavailableLookup = true; await f.retry(sessionId, "send"); f.faults.unavailableLookup = false;
  expect((await f.command({ op: "receipt", requestKey: "send" })).receipt.status).toBe("pending");
  await f.command({ op: "round.retry", requestKey: "retry-again", sessionId, originalRequestKey: "send" });
  expect(f.calls.filter(call => call.target === "agent.run")).toHaveLength(1);
}));

for (const operation of ["agent.write", "agent.stop"] as const) test(`lost ${operation} response restores the fixed target and options key`, () => fixture(async f => {
  const { sessionId, workId } = await f.begin(); f.faults.after = operation;
  const raw = operation === "agent.write" ? { op: "round.send", requestKey: "control", sessionId, workId, text: "Follow up" } : { op: "round.stop", requestKey: "control", ...await f.target(sessionId, workId) };
  expect((await f.command(raw)).receipt.status).toBe("pending"); expect((await f.command(raw)).receipt.status).toBe("pending");
  await expect(f.send(sessionId, "blocked", workId)).rejects.toMatchObject({ code: "conflict" });
  expect((await f.retry(sessionId, "control")).receipt.value.receipt.status).toBe("accepted");
  const calls = f.calls.filter(call => call.target === operation); expect(calls).toHaveLength(1);
  expect(f.lookups.at(-1)).toEqual({ target: operation, key: calls[0]!.key! });
}));

for (const terminal of [false, true]) test(`unconfirmed stop fences continuation (terminal view: ${terminal})`, () => fixture(async f => {
  const { sessionId, workId } = await f.begin(); f.faults.stopUnknown = !terminal; f.faults.stopFalseTerminal = terminal;
  const stopped = await f.command({ op: "round.stop", requestKey: "stop", ...await f.target(sessionId, workId) });
  expect(stopped.receipt.status).toBe("accepted");
  await expect(f.send(sessionId, "next", workId)).rejects.toMatchObject({ code: "conflict" });
  expect(f.calls.filter(call => call.target === "agent.run")).toHaveLength(1);
  await expect(readFile(join(f.context.dir, "sessions", `evidence-${digest(workId)}.json`))).rejects.toMatchObject({ code: "ENOENT" });
  f.faults.stopUnknown = false; f.faults.stopFalseTerminal = false;
  await f.command({ op: "round.stop", requestKey: "confirm-stop", ...await f.target(sessionId, workId) });
  expect((await f.send(sessionId, "next-confirmed", workId)).receipt.status).toBe("accepted");
}));

test("confirmed stop freezes a fresh final reply and unavailable snapshot diff", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(), run = await f.runFor(workId);
  f.pages.get(run.runId)!.transcript = [{ at: new Date().toISOString(), kind: "text", text: "Partial Coding reply" }];
  const result = await f.command({ op: "round.stop", requestKey: "stop", ...await f.target(sessionId, workId) });
  expect(result.receipt.status).toBe("accepted");
  expect((await f.command({ op: "receipt", requestKey: "stop" })).receipt.status).toBe("accepted");
  expect(f.calls.filter(call => call.target === "agent.stop")).toHaveLength(1);
  expect((await f.send(sessionId, "continue-after-stop", workId)).receipt.status).toBe("accepted");
}));

test("malformed acknowledgements remain pending and recover via the original kernel receipt", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(); f.faults.malformed = "agent.write";
  expect((await f.send(sessionId, "write", workId)).receipt.status).toBe("pending");
  expect((await f.retry(sessionId, "write")).receipt.value.receipt.status).toBe("accepted");
  expect(f.calls.filter(call => call.target === "agent.write")).toHaveLength(1);
}));

test("question answers bind conversation/run/context and use discriminated generic write", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(), target = await f.target(sessionId, workId), run = await f.runFor(workId);
  const page = f.pages.get(run.runId)!;
  page.interactions = [{ id: "question", runId: run.runId, sessionId: run.contextId, question: { method: "confirm", title: "Proceed?", message: "", options: [], timeoutMs: 300000 }, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), status: "pending" }];
  const raw = { op: "round.answer", requestKey: "answer", ...target, questionId: "question", text: "是" };
  await expect(f.command({ ...raw, requestKey: "wrong-run", runId: "alien" })).rejects.toMatchObject({ code: "conflict" });
  await expect(f.command({ ...raw, requestKey: "wrong-question", questionId: "old" })).rejects.toMatchObject({ code: "conflict" });
  f.faults.wrongQuestion = true; await expect(f.command({ ...raw, requestKey: "wrong-context" })).rejects.toMatchObject({ code: "conflict" }); f.faults.wrongQuestion = false;
  expect((await f.command(raw)).receipt.status).toBe("accepted"); expect((await f.command(raw)).receipt.status).toBe("accepted");
  expect(f.calls.filter(call => call.target === "agent.write")).toHaveLength(1);
  expect(f.calls.find(call => call.target === "agent.write")!.args.input).toEqual({ kind: "answer", questionId: "question", answer: { decision: "submit", value: true } });
  await expect(f.command({ ...raw, requestKey: "already-answered" })).rejects.toMatchObject({ code: "conflict" });
}));

for (const method of ["input", "editor", "select"] as const) test(`${method} answers preserve provider values`, () => fixture(async f => {
  const { sessionId, workId } = await f.begin(), run = await f.runFor(workId);
  f.pages.get(run.runId)!.interactions = [{ id: "question", runId: run.runId, sessionId: null, question: { method, title: "Answer", message: "", options: method === "select" ? ["A", "B"] : [], timeoutMs: 1000 }, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), status: "pending" }];
  const text = method === "select" ? "B" : " \n ";
  await f.command({ op: "round.answer", requestKey: "answer", ...await f.target(sessionId, workId), questionId: "question", text });
  expect(f.calls.find(call => call.target === "agent.write")!.args.input).toMatchObject({ answer: { decision: "submit", value: method === "select" ? 1 : text } });
}));

test("history and frozen results survive restart with explicit snapshot provenance", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(), run = await f.runFor(workId), target = await f.target(sessionId, workId);
  const page = f.pages.get(run.runId)!;
  page.items = [{ sequence: 1, at: new Date().toISOString(), kind: "usage", payload: { type: "usage", value: { input: 5, output: 3 } } }]; page.nextCursor = "opaque:one";
  await f.finish(workId, "Real fake-provider reply");
  const detail = await handleCodingCommand(f.context, { op: "conversations.get", sessionId }) as { history: { messages: { content: string }[] } };
  expect(detail.history.messages.some(item => item.content === "Real fake-provider reply")).toBe(true);
  await handleCodingCommand({ ...f.context }, { op: "conversations.get", sessionId });
  expect(f.calls.some(call => call.target === "agent.read")).toBe(true);
  const result = await handleCodingCommand(f.context, { op: "results", sessionId, workId }) as { results: { baseline: { kind: string }; resultId: string }[] };
  expect(result.results[0]!.baseline.kind).toBe("snapshot");
  f.faults.wrongRead = true;
  expect(await handleCodingCommand(f.context, { op: "snapshot", ...target })).toMatchObject({ stopConfirmed: true });
  expect(f.calls.every(call => ["agent.run", "agent.read", "agent.write", "agent.stop"].includes(call.target))).toBe(true);
}));

test("project registry is Coding-owned, canonical, strict, and never changes kernel launch authority", () => fixture(async f => {
  const alias = join(f.context.dir, "alias"); await symlink(f.projectPath, alias);
  const registered = await f.command({ op: "projects.register", requestKey: "alias", path: alias });
  expect(registered.receipt.value).toMatchObject({ projectRef: f.projectRef, path: f.projectPath });
  const created = await f.command({ op: "projects.create", requestKey: "create-managed", name: "New" });
  expect(created.receipt.status).toBe("accepted");
  expect(await f.command({ op: "projects.create", requestKey: "create-managed", name: "New" })).toEqual(created);
  expect(f.calls).toHaveLength(0);
  await expect(f.command({ op: "projects.list", cwd: "/host" })).rejects.toMatchObject({ code: "invalid" });
  await expect(f.command({ op: "round.send", requestKey: "bad", sessionId: "chat", workId: null, text: "x", providerOptions: { cwd: "/host" } })).rejects.toMatchObject({ code: "invalid" });
  const sessionId = await f.create(); await f.send(sessionId);
  expect(f.calls[0]!.args).not.toHaveProperty("cwd"); expect(f.calls[0]!.args).not.toHaveProperty("placement");
  const before = f.calls.length;
  for (const operation of ["start-v2", "placement", "locations", "workspace-cleanup"]) await expect(callAgent(f.context, operation, {})).rejects.toMatchObject({ code: "unsupported" });
  const start = workStartSchema.parse({ kind: "execution", workId: "unshipped", commandKey: "unshipped", goal: "Fixture", placement: { executorId: "server", projectRef: "repo", mappingRevision: 1 }, workspace: { mode: "existing", baseline: { kind: "commit", digest: "a".repeat(40) } }, queueExpiresAt: new Date(Date.now() + 60000).toISOString(), budget: { timeoutMs: 1000, maxToolCalls: 1 } });
  await expect(handleWorkCommand(f.context, { op: "start", input: start })).rejects.toMatchObject({ code: "unsupported" });
  expect(f.calls.length).toBe(before);
  for (const [status, stopConfirmed, cancelRequested, phase] of [["completed", false, false, "unknown"], ["completed", true, false, "completed"], ["cancelled", false, true, "stopping"], ["unknown", false, false, "unknown"], ["failed", true, false, "failed"]] as const) {
    expect(workPhase({ workId: "w", sessionId: "s", runId: "r", attemptId: "t", projectRef: "p", status, stopConfirmed, cancelRequested })).toBe(phase);
  }
}));

test("expired and pre-admission rejected answers retain definitive receipts without retries", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(), target = await f.target(sessionId, workId), run = await f.runFor(workId);
  const question: Page["interactions"][number] = { id: "question", runId: run.runId, sessionId: run.contextId, question: { method: "input", title: "Answer", message: "", options: [], timeoutMs: 1000 }, createdAt: new Date(Date.now() - 2000).toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString(), status: "pending" };
  f.pages.get(run.runId)!.interactions = [question];
  const raw = { op: "round.answer", requestKey: "expired", ...target, questionId: "question", text: "Answer" };
  await expect(f.command(raw)).rejects.toMatchObject({ code: "conflict" });
  expect(f.calls.filter(call => call.target === "agent.write")).toHaveLength(0);
  question.expiresAt = new Date(Date.now() + 60000).toISOString(); f.faults.reject = "agent.write";
  await expect(f.command({ ...raw, requestKey: "rejected" })).rejects.toMatchObject({ code: "invalid" });
  expect((await f.command({ op: "receipt", requestKey: "rejected" })).receipt.status).toBe("rejected");
  await f.command({ ...raw, requestKey: "rejected" });
  expect(f.calls.filter(call => call.target === "agent.write")).toHaveLength(1);
  await expect(f.send(sessionId, "changed-body", workId, "Different message")).resolves.toMatchObject({ receipt: { status: "accepted" } });
}));

test("a missing callStatus port never replays a lost admission", () => fixture(async f => {
  const sessionId = await f.create(); f.faults.after = "agent.run";
  await f.send(sessionId);
  const ctx = { ...f.context, callStatus: undefined };
  const result = await f.command({ op: "round.retry", requestKey: "retry-no-port", sessionId, originalRequestKey: "send" }, ctx);
  expect(result.receipt.value.receipt.status).toBe("pending");
  expect(f.calls.filter(call => call.target === "agent.run")).toHaveLength(1);
}));

test("large transcript and escaped output stay bounded with explicit missing evidence", () => fixture(async f => {
  const { sessionId, workId } = await f.begin(); await f.finish(workId, "\u0001".repeat(60000));
  const detail = await handleCodingCommand(f.context, { op: "conversations.get", sessionId }) as { history: { limited: boolean; snapshotOmitted: boolean; messages: { content: string }[] } };
  expect(detail.history.limited).toBe(true); expect(detail.history.snapshotOmitted).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(detail))).toBeLessThan(230 * 1024);
  const manifest = moduleManifestSchema.parse(await Bun.file(join(import.meta.dir, "module.json")).json());
  expect(compileModuleOutput(manifest.tools[0]!.output).safeParse(detail).success).toBe(true);
  type History = { messages: { author: string; content: string }[]; before: string | null };
  let history = (detail as unknown as { history: History }).history;
  let text = history.messages.filter(item => item.author === "编码助手").map(item => item.content).join("");
  const cursors = new Set<string>();
  while (history.before) {
    expect(cursors.has(history.before)).toBe(false); cursors.add(history.before);
    history = (await f.command({ op: "conversations.get", sessionId, before: history.before }, { ...f.context }) as unknown as { history: History }).history;
    text = history.messages.filter(item => item.author === "编码助手").map(item => item.content).join("") + text;
  }
  expect(text).toBe("\u0001".repeat(60000));
  expect(cursors.size).toBeGreaterThan(0);
}));
