import { expect, test } from "bun:test";
import { providerAnswerSchema } from "@chrona/contracts/steward";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAGE } from "./external/coding/page";
import { pageErrors } from "./builtin/web/pages";
import { workbenchCatalog, workbenchCommand, workbenchDetail } from "./external/coding/workbench";
import { codingSessions, loadSessions, saveSessions } from "./external/coding/sessions";
import type { CodingContext } from "./external/coding/types";
import type { ExecutionSnapshot, ExecutionView, ExecutionEventPage } from "./external/coding/contract.js";

const until = "2099-12-01T00:00:00Z";
const missing = () => Object.assign(new Error("not found"), { code: "not_found" });
async function fixture(run: (fake: Awaited<ReturnType<typeof makeFake>>) => Promise<void>) {
  const fake = await makeFake();
  try { await run(fake); } finally { await rm(fake.context.dir, { recursive: true, force: true }); }
}
async function makeFake() {
  const dir = await mkdtemp(join(tmpdir(), "coding-conversations-"));
  const views = new Map<string, ExecutionView>(), snapshots = new Map<string, ExecutionSnapshot>(), receipts = new Map<string, ExecutionView>();
  const pages = new Map<string, ExecutionEventPage[]>();
  const starts: Record<string, unknown>[] = [], writes: Record<string, unknown>[] = [], answers: unknown[] = [], requests: string[] = [];
  let loseReceipt = false, unavailable = false;
  const registered = [{ projectRef: "repo", path: "/host/repo", label: "repo" }];
  const context: CodingContext = { dir, content: join(dir, "public"), async call<T>(target: string, args: Record<string, unknown>): Promise<T> {
    requests.push(target);
    if (target === "projects.list") return { projects: registered } as T;
    if (target === "projects.register") { expect(Object.keys(args)).toEqual(["path"]); const project = { projectRef: "added", path: String(args.path), label: "added" }; registered.push(project); return project as T; }
    const workId = String(args["execution-id"]);
    if (target === "agent.run") {
      const journal = await loadSessions(context);
      const session = journal.sessions.find(item => item.workIds.includes(workId));
      // Admission is never attempted until the exact input and conversation binding are durable.
      expect(session?.selectedWorkId).toBe(workId);
      expect(session?.turns?.at(-1)?.accepted).toBe(false);
      expect(session?.turns?.at(-1)?.start?.workId).toBe(workId);
      starts.push(args);
      const resume = args["resume-from"] as { "work-id": string } | undefined;
      const parent = resume ? views.get(resume["work-id"]) : undefined;
      const view: ExecutionView = { workId, sessionId: parent?.sessionId ?? `session-${workId}`, runId: `run-${workId}`, attemptId: `attempt-${workId}`, projectRef: String(args["project-ref"]), status: "running", cancelRequested: false, stopConfirmed: false };
      views.set(workId, view); receipts.set(String(args["request-key"]), view);
      const { projectRef: _, ...ref } = view;
      snapshots.set(workId, { ...ref, highWatermark: 0, finalMessage: null, questions: [], missing: false, expiresAt: until });
      if (loseReceipt) { loseReceipt = false; throw Object.assign(new Error("receipt lost"), { code: "unavailable" }); }
      return { execution: view } as T;
    }
    if (target === "agent.lookup") { const view = receipts.get(String(args["request-key"])); if (!view) throw missing(); return { ...view } as T; }
    if (unavailable) throw Object.assign(new Error("offline"), { code: "unavailable" });
    const view = views.get(workId), snapshot = snapshots.get(workId);
    if (!view || !snapshot) throw missing();
    if (target === "agent.get") return { ...view } as T;
    if (target === "agent.inspect") return { snapshot: { ...snapshot, status: view.status, stopConfirmed: view.stopConfirmed, cancelRequested: view.cancelRequested }, source: { workId, sessionId: view.sessionId, runId: view.runId, attemptId: view.attemptId, baseline: { kind: "snapshot", digest: "fixture" }, changes: { scope: "baseline_to_worktree", status: "unavailable", reason: "not_git", patch: "", files: [] } } } as T;
    if (target === "agent.stream") {
      expect(args["run-id"]).toBe(view.runId); expect(args["attempt-id"]).toBe(view.attemptId);
      const page: ExecutionEventPage = { events: [], cursor: `cursor-${workId}`, highWatermark: snapshot.highWatermark, gap: false, snapshotRequired: false };
      return (pages.get(workId)?.shift() ?? page) as T;
    }
    if (target === "agent.write") { writes.push(args); return { accepted: true } as T; }
    if (target === "agent.respond") { answers.push(providerAnswerSchema.parse(JSON.parse(String(args.answer)))); return { accepted: true } as T; }
    if (target === "agent.interrupt") { view.cancelRequested = true; return { ...view } as T; }
    throw new Error(`Unexpected target ${target}`);
  } };
  return { context, views, snapshots, pages, starts, writes, answers, requests, registered,
    loseReceipt() { loseReceipt = true; }, offline() { unavailable = true; },
    complete(workId: string, text = `完整回复 ${workId}`) { Object.assign(views.get(workId)!, { status: "completed", stopConfirmed: true }); snapshots.get(workId)!.finalMessage = { messageId: `final-${workId}`, text, truncated: false }; },
  };
}
const create = { action: "create", "request-key": "one", project: "repo", text: "fix the fixture" };

test("coding page uses registered generic conversation components and has no acceptance gate", async () => {
  const manifest = JSON.parse(await readFile(join(import.meta.dirname, "external/coding/module.json"), "utf8"));
  const tools = new Map<string, { properties?: Record<string, unknown> }>(manifest.tools.map((tool: { name: string; parameters: object }) => [tool.name, tool.parameters]));
  expect(pageErrors(PAGE, tools, "coding")).toEqual([]);
  // json-render repeats children inside its item scope; repeating a leaf silently renders one blank row.
  for (const element of Object.values(PAGE.spec.elements)) {
    if (!("repeat" in element)) continue;
    expect(element.children.length).toBeGreaterThan(0);
    expect(JSON.stringify(element.props)).not.toContain('"$item"');
  }
  expect(manifest.uses).toContain("projects.list"); expect(manifest.uses).toContain("projects.register");
  expect(manifest.tools.find((tool: { name: string }) => tool.name === "ui-command").visibility).toEqual(["owner"]);
  expect(JSON.stringify(PAGE)).not.toContain("验收"); expect(JSON.stringify(PAGE)).not.toContain('"action":"accept"');
});

test("completed conversation starts fresh rounds in the same Provider session and restores selection", () => fixture(async fake => {
  const first = await workbenchCommand(fake.context, create);
  await workbenchCommand({ ...fake.context }, create);
  expect(fake.starts).toHaveLength(1);
  const timestamp = (await loadSessions(fake.context)).sessions[0]!.turns![0]!.createdAt;
  await workbenchCommand(fake.context, { action: "send", "request-key": "supplement", "work-id": first.workId, text: "also check this" });
  expect(fake.writes).toHaveLength(1);
  fake.complete(first.workId, "完整的最终回复\n\n```ts\nconst fixed = true;\n```");
  const finished = await workbenchDetail(fake.context, first.workId);
  expect(finished.canSend).toBe(true);
  expect(finished.messages.find(message => message.author === "编码助手")?.content).toContain("const fixed");
  const send = { action: "send", "request-key": "two", "session-id": first.sessionId, "work-id": first.workId, text: "now add a test" };
  const second = await workbenchCommand(fake.context, send);
  expect(second.sessionId).toBe(first.sessionId); expect(second.workId).toBe("web-two");
  expect(fake.starts[1]?.["resume-from"]).toEqual({ "work-id": "web-one", "run-id": "run-web-one", "attempt-id": "attempt-web-one" });
  expect(fake.views.get(second.workId)?.sessionId).toBe(fake.views.get(first.workId)?.sessionId);
  expect(fake.views.get(second.workId)?.runId).not.toBe(fake.views.get(first.workId)?.runId);
  await workbenchCommand({ ...fake.context }, send);
  expect(fake.starts).toHaveLength(2);
  fake.complete(second.workId);
  await workbenchCommand(fake.context, { ...send, "request-key": "three", "work-id": second.workId, text: "one more round" });
  const restored = await workbenchDetail({ ...fake.context });
  expect(restored.workId).toBe("web-three");
  expect((await workbenchCatalog(fake.context)).selectedSession).toBe(first.sessionId);
  const journal = await loadSessions(fake.context);
  expect(journal.sessions[0]!.workIds).toEqual(["web-one", "web-two", "web-three"]);
  expect(journal.sessions[0]!.turns!.map(turn => turn.text)).toEqual(["fix the fixture", "also check this", "now add a test", "one more round"]);
  expect(journal.sessions[0]!.turns![0]!.createdAt).toBe(timestamp);
}));

test("lost start receipt recovers through exact create idempotency without another Agent start", () => fixture(async fake => {
  fake.loseReceipt();
  await expect(workbenchCommand(fake.context, create)).rejects.toMatchObject({ code: "unavailable" });
  const journal = await loadSessions(fake.context);
  expect(journal.sessions[0]!.selectedWorkId).toBe("web-one");
  expect(journal.sessions[0]!.turns![0]!.accepted).toBe(false);
  const before = JSON.stringify(journal.sessions[0]!.turns![0]);
  expect((await workbenchDetail({ ...fake.context })).canRetry).toBe(true);
  expect(fake.starts).toHaveLength(1); // Reading never dispatches work.
  await expect(workbenchCommand(fake.context, { ...create, text: "changed" })).rejects.toMatchObject({ code: "conflict" });
  await workbenchCommand({ ...fake.context }, { action: "retry", "request-key": "retry", "session-id": journal.sessions[0]!.id });
  expect(fake.starts).toHaveLength(1);
  expect(fake.requests).toContain("agent.lookup");
  const after = (await loadSessions(fake.context)).sessions[0]!.turns![0]!;
  expect({ ...after, accepted: false }).toEqual(JSON.parse(before));
  expect(after.accepted).toBe(true);
}));

test("binding persisted before dispatch can recover even when work file was never created", () => fixture(async fake => {
  await workbenchCommand(fake.context, create);
  const journal = await loadSessions(fake.context), first = journal.sessions[0]!, original = first.turns![0]!;
  const pending = { ...original, key: "never", workId: "web-never", accepted: false, start: { ...original.start!, workId: "web-never", commandKey: "web-never" } };
  first.turns!.push(pending); first.workIds.push(pending.workId); first.selectedWorkId = pending.workId;
  await saveSessions(fake.context, journal);
  const detail = await workbenchDetail(fake.context);
  expect(detail.canRetry).toBe(true); expect(detail.canSend).toBe(false); expect(fake.starts).toHaveLength(1);
  await workbenchCommand(fake.context, { action: "retry", "request-key": "recover", "session-id": first.id });
  expect(fake.starts).toHaveLength(2); expect(fake.starts[1]?.["execution-id"]).toBe("web-never");
}));

test("stop pending and unknown states block a new round; native confirm and selection map to typed answers", () => fixture(async fake => {
  const first = await workbenchCommand(fake.context, create);
  const snapshot = fake.snapshots.get(first.workId)!;
  snapshot.questions = [{ requestId: "confirm", title: "允许修改？", method: "confirm", options: [], status: "pending", expiresAt: until }];
  await workbenchCommand(fake.context, { action: "answer", "request-key": "yes", "work-id": first.workId, question: "confirm", text: "是" });
  snapshot.questions = [{ requestId: "select", title: "选择方案", method: "select", options: ["方案一", "方案二"], status: "pending", expiresAt: until }];
  await workbenchCommand(fake.context, { action: "answer", "request-key": "option", "work-id": first.workId, question: "select", text: "方案二" });
  expect(fake.answers).toEqual([{ decision: "submit", value: true }, { decision: "submit", value: 1 }]);
  const stopping = await workbenchCommand(fake.context, { action: "stop", "request-key": "stop", "work-id": first.workId });
  expect(stopping.stop).toContain("尚未确认"); expect(stopping.canSend).toBe(false);
  await expect(workbenchCommand(fake.context, { action: "send", "request-key": "blocked", "work-id": first.workId, text: "next" })).rejects.toMatchObject({ code: "conflict" });
  Object.assign(fake.views.get(first.workId)!, { status: "unknown", cancelRequested: false, stopConfirmed: false });
  const unknown = await workbenchDetail(fake.context);
  expect(unknown.canSend).toBe(false); expect(unknown.stop).toContain("尚未确认");
  expect(fake.starts).toHaveLength(1);
}));

test("project registration routes only a path; new/select persists independently and legacy sessions still work", () => fixture(async fake => {
  const first = await workbenchCommand(fake.context, create);
  await workbenchCommand(fake.context, { action: "register-project", "request-key": "directory", path: "/host/new project" });
  expect((await workbenchCatalog(fake.context)).projectOptions).toContainEqual({ value: "added", label: "added · /host/new project" });
  await workbenchCommand(fake.context, { action: "new", "request-key": "new" });
  expect((await workbenchDetail(fake.context)).sessionId).toBe("");
  await workbenchCommand(fake.context, { action: "select", "request-key": "select", "session-id": first.sessionId });
  expect((await workbenchDetail({ ...fake.context })).sessionId).toBe(first.sessionId);
  const legacy = await codingSessions(fake.context, { op: "list" });
  expect(legacy.sessions[0]).toEqual({ id: first.sessionId, title: "fix the fixture", workIds: ["web-one"], selectedWorkId: "web-one" });
  await expect(workbenchDetail(fake.context, "../sessions/index")).rejects.toMatchObject({ code: "invalid" });
  await expect(workbenchCommand(fake.context, { ...create, cwd: "/host" })).rejects.toMatchObject({ code: "invalid" });
}));

test("durable final replies remain readable when Agent is offline", () => fixture(async fake => {
  const first = await workbenchCommand(fake.context, create);
  fake.complete(first.workId, "完整回复：文件已更新。\n\n检查已通过。");
  const done = await workbenchDetail(fake.context);
  const timestamp = done.messages.find(message => message.author === "编码助手")!.timestamp;
  fake.offline();
  const restored = await workbenchDetail({ ...fake.context });
  expect(restored.output).toBe("完整回复：文件已更新。\n\n检查已通过。");
  expect(restored.messages.find(message => message.author === "编码助手")!.timestamp).toBe(timestamp);
}));

test("paged reply deltas remain exact when a truncated snapshot arrives between pages", () => fixture(async fake => {
  const first = await workbenchCommand(fake.context, create), view = fake.views.get(first.workId)!;
  fake.complete(first.workId);
  Object.assign(fake.snapshots.get(first.workId)!, { highWatermark: 2, finalMessage: { messageId: "reply", text: "完", truncated: true } });
  const event = (seq: number, delta: string) => ({ workId: view.workId, sessionId: view.sessionId, runId: view.runId, attemptId: view.attemptId, seq, at: "2026-01-01T00:00:00Z", payload: { type: "text_delta" as const, messageId: "reply", delta } });
  fake.pages.set(first.workId, [
    { events: [event(1, "完整")], cursor: "page-1", highWatermark: 2, gap: false, snapshotRequired: false },
    { events: [event(1, "完整"), event(2, "回复")], cursor: "page-2", highWatermark: 2, gap: false, snapshotRequired: false },
  ]);
  expect((await workbenchDetail(fake.context)).messages.find(message => message.author === "编码助手")?.content).toBe("完整");
  const finished = await workbenchDetail({ ...fake.context });
  expect(finished.messages.find(message => message.author === "编码助手")?.content).toBe("完整回复");
  expect(finished.limited).toBe(true);
  fake.offline();
  expect((await workbenchDetail(fake.context)).messages.find(message => message.author === "编码助手")?.content).toBe("完整回复");
}));

test("concurrent terminal sends serialize into one continuation and reject a stale round", () => fixture(async fake => {
  const first = await workbenchCommand(fake.context, create); fake.complete(first.workId);
  const next = { action: "send", "request-key": "next", "session-id": first.sessionId, "work-id": first.workId, text: "continue" };
  const outcomes = await Promise.all([workbenchCommand(fake.context, next), workbenchCommand({ ...fake.context }, next)]);
  expect(outcomes.map(result => result.workId)).toEqual(["web-next", "web-next"]);
  expect(fake.starts).toHaveLength(2);
  await expect(workbenchCommand(fake.context, { ...next, "request-key": "stale" })).rejects.toMatchObject({ code: "conflict" });
  expect((await loadSessions(fake.context)).sessions[0]!.turns!.map(turn => turn.key)).toEqual(["one", "next"]);
}));

test("whole-message history pagination retains every user message and final reply", () => fixture(async fake => {
  const first = await workbenchCommand(fake.context, create);
  for (let index = 0; index < 6; index++) await workbenchCommand(fake.context, { action: "send", "request-key": `long-${index}`, "work-id": first.workId, text: `${index}:` + "x".repeat(19_000) });
  fake.complete(first.workId, "最终回复完整保留");
  const latest = await workbenchDetail(fake.context);
  expect(latest.hasEarlier).toBe(true);
  expect(latest.messages.some(message => message.content === "最终回复完整保留")).toBe(true);
  const earlier = await workbenchDetail(fake.context, "", first.sessionId, latest.historyBefore);
  const all = [...earlier.messages, ...latest.messages];
  expect(new Set(all.map(message => message.id)).size).toBe(all.length);
  expect(all.filter(message => message.author === "你").map(message => message.content)).toEqual(["fix the fixture", ...Array.from({ length: 6 }, (_, index) => `${index}:` + "x".repeat(19_000))]);
  expect(earlier.hasEarlier).toBe(false);
}));

test("very large streamed replies paginate without dropping text or splitting Unicode characters", () => fixture(async fake => {
  const first = await workbenchCommand(fake.context, create), view = fake.views.get(first.workId)!;
  fake.complete(first.workId);
  const deltas = Array.from({ length: 8 }, (_, index) => `${index}:` + '汉😀"\n'.repeat(1500));
  Object.assign(fake.snapshots.get(first.workId)!, { highWatermark: 8, finalMessage: { messageId: "reply", text: "0:", truncated: true } });
  fake.pages.set(first.workId, [{ events: deltas.map((delta, index) => ({ workId: view.workId, sessionId: view.sessionId, runId: view.runId, attemptId: view.attemptId, seq: index + 1, at: "2026-01-01T00:00:00Z", payload: { type: "text_delta", messageId: "reply", delta } })), cursor: "large", highWatermark: 8, gap: false, snapshotRequired: false }]);
  let page = await workbenchDetail(fake.context);
  expect(page.hasEarlier).toBe(true);
  const pages = [page];
  while (page.hasEarlier) { page = await workbenchDetail(fake.context, "", first.sessionId, page.historyBefore); pages.unshift(page); }
  expect(pages.flatMap(result => result.messages).filter(message => message.author === "编码助手").map(message => message.content).join("")).toBe(deltas.join(""));
  for (const result of pages) expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(240_000);
}));

test("invalid start envelope never leaves a permanently pending conversation", () => fixture(async fake => {
  await expect(workbenchCommand(fake.context, { ...create, text: "x".repeat(20_000) })).rejects.toMatchObject({ code: "too_large" });
  expect((await loadSessions(fake.context)).sessions).toEqual([]);
  expect(fake.starts).toHaveLength(0);
}));

test("definitively rejected racing sends stay visible and allow a fresh terminal round", () => fixture(async fake => {
  const first = await workbenchCommand(fake.context, create), originalCall = fake.context.call;
  const rejectedRequests: Record<string, unknown>[] = [];
  fake.context.call = async <T>(target: string, args: Record<string, unknown>): Promise<T> => {
    if (target === "agent.write") { rejectedRequests.push(args); fake.complete(first.workId); throw Object.assign(new Error("Execution is no longer live"), { code: "conflict" }); }
    return originalCall<T>(target, args);
  };
  const command = { action: "send", "request-key": "racing", "work-id": first.workId, text: "arrived after completion" };
  await expect(workbenchCommand(fake.context, command)).rejects.toMatchObject({ code: "conflict" });
  expect(rejectedRequests).toHaveLength(2); expect(rejectedRequests[0]).toEqual(rejectedRequests[1]);
  const turn = (await loadSessions(fake.context)).sessions[0]!.turns!.at(-1)!;
  expect(turn.accepted).toBe(false); expect(turn.rejected).toEqual({ code: "conflict" });
  const restored = await workbenchDetail({ ...fake.context });
  expect(restored.canSend).toBe(true); expect(restored.canRetry).toBe(false);
  expect(restored.messages.find(message => message.content === command.text)?.status).toBe("发送未被接受");
  await expect(workbenchCommand(fake.context, command)).rejects.toMatchObject({ code: "conflict" });
  expect(rejectedRequests).toHaveLength(2);
  const next = await workbenchCommand(fake.context, { action: "send", "request-key": "after-race", "session-id": first.sessionId, text: "try in a new round" });
  expect(next.workId).toBe("web-after-race"); expect(fake.starts).toHaveLength(2);
  expect((await loadSessions(fake.context)).sessions[0]!.turns![1]!.createdAt).toBe(turn.createdAt);
}));

test("expired question rejection is durable and does not poison later native answers", () => fixture(async fake => {
  const first = await workbenchCommand(fake.context, create), originalCall = fake.context.call;
  const snapshot = fake.snapshots.get(first.workId)!;
  snapshot.questions = [{ requestId: "expires", title: "Editor", method: "editor", options: [], status: "pending", expiresAt: until }];
  fake.context.call = async <T>(target: string, args: Record<string, unknown>): Promise<T> => {
    if (target === "agent.respond" && args["question-id"] === "expires") { snapshot.questions[0]!.status = "expired"; throw Object.assign(new Error("Question expired"), { code: "conflict" }); }
    return originalCall<T>(target, args);
  };
  await expect(workbenchCommand(fake.context, { action: "answer", "request-key": "expired", "work-id": first.workId, question: "expires", text: "draft" })).rejects.toMatchObject({ code: "conflict" });
  const restored = await workbenchDetail({ ...fake.context });
  expect(restored.canSend).toBe(true); expect(restored.canRetry).toBe(false);
  expect((await loadSessions(fake.context)).sessions[0]!.turns!.at(-1)!.rejected).toEqual({ code: "conflict" });
  snapshot.questions = [{ requestId: "later", title: "Continue", method: "confirm", options: [], status: "pending", expiresAt: until }];
  await workbenchCommand(fake.context, { action: "answer", "request-key": "later", "work-id": first.workId, question: "later", text: "是" });
  expect(fake.answers).toEqual([{ decision: "submit", value: true }]);
}));

test("uncertain control delivery keeps exact retries while a consumed conflict reconciles its receipt", () => fixture(async fake => {
  const first = await workbenchCommand(fake.context, create), originalCall = fake.context.call;
  const receipts = new Map<string, { args: Record<string, unknown>; result: unknown }>();
  fake.context.call = async <T>(target: string, args: Record<string, unknown>): Promise<T> => {
    if (target !== "agent.write") return originalCall<T>(target, args);
    const key = String(args["request-key"]), previous = receipts.get(key);
    if (previous) { expect(args).toEqual(previous.args); return previous.result as T; }
    const result = await originalCall<T>(target, args); receipts.set(key, { args, result });
    throw Object.assign(new Error("Receipt delivered but reply lost"), { code: key === "ambiguous" ? "unavailable" : "conflict" });
  };
  const command = { action: "send", "request-key": "ambiguous", "work-id": first.workId, text: "  exact supplement  " };
  await expect(workbenchCommand(fake.context, command)).rejects.toMatchObject({ code: "unavailable" });
  const pending = (await loadSessions(fake.context)).sessions[0]!.turns!.at(-1)!;
  expect(pending.rejected).toBeUndefined(); expect(pending.accepted).toBe(false);
  expect((await workbenchDetail(fake.context)).canRetry).toBe(true);
  await workbenchCommand({ ...fake.context }, { action: "retry", "request-key": "recover-control", "session-id": first.sessionId });
  expect(fake.writes).toHaveLength(1);
  await workbenchCommand(fake.context, { ...command, "request-key": "consumed-conflict", text: "accepted before conflict" });
  const turns = (await loadSessions(fake.context)).sessions[0]!.turns!;
  expect(turns.slice(1).map(turn => turn.accepted)).toEqual([true, true]);
  expect(turns.every(turn => !turn.rejected)).toBe(true); expect(fake.writes).toHaveLength(2);
}));

test("definitively unadmitted starts restore a sendable conversation without silently launching work", () => fixture(async fake => {
  const originalCall = fake.context.call;
  fake.context.call = async <T>(target: string, args: Record<string, unknown>): Promise<T> => {
    if (target === "agent.run" && args["execution-id"] === "web-one") throw Object.assign(new Error("Project unavailable"), { code: "invalid" });
    return originalCall<T>(target, args);
  };
  await expect(workbenchCommand(fake.context, create)).rejects.toMatchObject({ code: "invalid" });
  const journal = await loadSessions(fake.context), session = journal.sessions[0]!;
  expect(session.selectedWorkId).toBeNull(); expect(session.turns![0]!.rejected).toEqual({ code: "invalid" });
  const restored = await workbenchDetail({ ...fake.context });
  expect(restored.canSend).toBe(true); expect(restored.canRetry).toBe(false); expect(restored.limited).toBe(false); expect(fake.starts).toHaveLength(0);
  const pageArgs = PAGE.spec.elements.sendInitial.on.press.params.args;
  expect(pageArgs).not.toHaveProperty("work-id");
  const state: Record<string, string> = { "/detail/sessionId": session.id, "/detail/requestKey": "retry-fresh", "/form/message": "fresh input" };
  const submitted = Object.fromEntries(Object.entries(pageArgs).map(([name, value]) => [name, typeof value === "object" ? state[value.$state] : value]));
  const admitted = await workbenchCommand(fake.context, submitted);
  expect(admitted.workId).toBe("web-retry-fresh"); expect(fake.starts).toHaveLength(1);
}));

test("stop replay requires its immutable original work and never cancels a later round", () => fixture(async fake => {
  const first = await workbenchCommand(fake.context, create);
  const sessionOnly = { action: "stop", "request-key": "fixed-stop", "session-id": first.sessionId };
  await expect(workbenchCommand(fake.context, sessionOnly)).rejects.toMatchObject({ code: "invalid" });
  expect(fake.requests.filter(target => target === "agent.interrupt")).toHaveLength(0);
  const stop = { ...sessionOnly, "work-id": first.workId };
  await workbenchCommand(fake.context, stop); fake.complete(first.workId);
  const next = await workbenchCommand(fake.context, { action: "send", "request-key": "after-stop", "session-id": first.sessionId, text: "continue" });
  await expect(workbenchCommand(fake.context, stop)).rejects.toMatchObject({ code: "conflict" });
  expect(fake.requests.filter(target => target === "agent.interrupt")).toHaveLength(1);
  expect(fake.views.get(next.workId)!.cancelRequested).toBe(false);
}));

test("native editor/input answers preserve whitespace and empty text, enforce 8000, and match exact select options", () => fixture(async fake => {
  const first = await workbenchCommand(fake.context, create), snapshot = fake.snapshots.get(first.workId)!;
  const cases = [
    { method: "editor" as const, text: "  indented\n", options: [], value: "  indented\n" },
    { method: "editor" as const, text: "", options: [], value: "" },
    { method: "input" as const, text: " \t\n", options: [], value: " \t\n" },
    { method: "input" as const, text: "", options: [], value: "" },
    { method: "input" as const, text: "x".repeat(8000), options: [], value: "x".repeat(8000) },
    { method: "editor" as const, text: "x".repeat(8000), options: [], value: "x".repeat(8000) },
    { method: "select" as const, text: "  spaced option  ", options: ["  spaced option  ", "other"], value: 0 },
    { method: "select" as const, text: "", options: ["empty", ""], value: 1 },
  ];
  for (const [index, value] of cases.entries()) {
    const question = `native-${index}`;
    snapshot.questions = [{ requestId: question, title: "Native", method: value.method, options: value.options, status: "pending", expiresAt: until }];
    await workbenchCommand(fake.context, { action: "answer", "request-key": question, "work-id": first.workId, question, text: value.text });
    expect(fake.answers.at(-1)).toEqual({ decision: "submit", value: value.value });
    expect((await loadSessions(fake.context)).sessions[0]!.turns!.at(-1)!.text).toBe(value.text);
  }
  const count = (await loadSessions(fake.context)).sessions[0]!.turns!.length;
  for (const method of ["input", "editor"] as const) {
    snapshot.questions = [{ requestId: "too-long", title: "Native", method, options: [], status: "pending", expiresAt: until }];
    await expect(workbenchCommand(fake.context, { action: "answer", "request-key": `long-${method}`, "work-id": first.workId, question: "too-long", text: "x".repeat(8001) })).rejects.toMatchObject({ code: "invalid" });
  }
  snapshot.questions = [{ requestId: "spaced", title: "Select", method: "select", options: [" spaced "], status: "pending", expiresAt: until }];
  await expect(workbenchCommand(fake.context, { action: "answer", "request-key": "trimmed-select", "work-id": first.workId, question: "spaced", text: "spaced" })).rejects.toMatchObject({ code: "invalid" });
  expect((await loadSessions(fake.context)).sessions[0]!.turns).toHaveLength(count);
  expect(fake.answers).toHaveLength(cases.length);
}));

test("snapshot refresh hints alone keep complete history unlimited while real loss remains visible", () => fixture(async fake => {
  const first = await workbenchCommand(fake.context, create);
  fake.pages.set(first.workId, [{ events: [], cursor: "initial-refresh", highWatermark: 0, gap: false, snapshotRequired: true }]);
  expect((await workbenchDetail(fake.context)).limited).toBe(false);
  expect((await workbenchDetail({ ...fake.context })).limited).toBe(false);
  fake.pages.set(first.workId, [{ events: [], cursor: "gap", highWatermark: 0, gap: true, snapshotRequired: true }]);
  expect((await workbenchDetail(fake.context)).limited).toBe(true);
  fake.pages.set(first.workId, [{ events: [], cursor: "refresh-after-gap", highWatermark: 0, gap: false, snapshotRequired: true }]);
  expect((await workbenchDetail({ ...fake.context })).limited).toBe(true);
}));

test("a lost reconciliation response remains pending until exact retry proves rejection", () => fixture(async fake => {
  const first = await workbenchCommand(fake.context, create), originalCall = fake.context.call;
  const attempts: Record<string, unknown>[] = [];
  fake.context.call = async <T>(target: string, args: Record<string, unknown>): Promise<T> => {
    if (target !== "agent.write") return originalCall<T>(target, args);
    attempts.push(args); fake.complete(first.workId);
    throw Object.assign(new Error("Reconciliation response"), { code: attempts.length === 2 ? "unavailable" : "conflict" });
  };
  await expect(workbenchCommand(fake.context, { action: "send", "request-key": "uncertain-rejection", "work-id": first.workId, text: "not yet proven" })).rejects.toMatchObject({ code: "unavailable" });
  const pending = (await loadSessions(fake.context)).sessions[0]!.turns!.at(-1)!;
  expect(pending.accepted).toBe(false); expect(pending.rejected).toBeUndefined();
  const uncertain = await workbenchDetail({ ...fake.context });
  expect(uncertain.canRetry).toBe(true); expect(uncertain.canSend).toBe(false);
  await expect(workbenchCommand(fake.context, { action: "retry", "request-key": "prove-rejection", "session-id": first.sessionId })).rejects.toMatchObject({ code: "conflict" });
  expect(attempts).toHaveLength(4); expect(attempts.every(args => JSON.stringify(args) === JSON.stringify(attempts[0]))).toBe(true);
  const proven = await workbenchDetail({ ...fake.context });
  expect(proven.canRetry).toBe(false); expect(proven.canSend).toBe(true);
  expect((await loadSessions(fake.context)).sessions[0]!.turns!.at(-1)!.rejected).toEqual({ code: "conflict" });
  expect(fake.starts).toHaveLength(1); expect(fake.writes).toHaveLength(0);
}));
