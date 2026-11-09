import { expect, test } from "bun:test";
import type { ExecutionEventPage, ExecutionSnapshot, ExecutionView } from "@chrona/contracts/steward";
import { codingPeerFixture, target, type Command, type Conversation, type PeerFixture, type Project, type Receipt } from "./__tests__/coding-peer-clients.fixture";

// Acceptance uses the production Hono app, generic listener proxy, SDK processes,
// real Coding/coding-web/Agent applications, host project registry and event store.
// Only execution start/control is deterministic. This does not exercise Pi, model
// output, kernel execution scheduling, browser rendering or an external client binary.
async function register(f: PeerFixture, key: string, path: string) {
  const result = await f.http<Receipt<Project>>({ op: "projects.register", requestKey: key, path });
  expect(result.receipt.status, JSON.stringify(result)).toBe("accepted");
  return result.receipt.value;
}
async function create(f: PeerFixture, key: string, projectRef: string) {
  const result = await f.tool<Receipt<Conversation>>({ op: "conversations.create", requestKey: key, projectRef, title: key });
  expect(result.receipt.status, JSON.stringify(result)).toBe("accepted");
  return result.receipt.value;
}
async function rejectedHttp(f: PeerFixture, command: Command, status: number, code: string) {
  const response = await f.request(command);
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

test("Coding's actual SDK listener is behind production global API authentication", async () => {
  const f = await codingPeerFixture();
  try {
    const initialRuns = await f.db.run.count();
    for (const key of [null, "wrong-key"]) {
      expect((await f.request({ op: "conversations.list" }, { key })).status).toBe(401);
      expect((await f.request({ op: "round.send", requestKey: "unauthorized", sessionId: "unknown", workId: null, text: "must not run" }, { key })).status).toBe(401);
    }
    expect(await f.db.moduleRun.count()).toBe(0);
    // The first authenticated HTTP request must work without a tool call warming the listener.
    expect(await f.http<{ sessions: Conversation[]; after: null }>({ op: "conversations.list" })).toEqual({ sessions: [], after: null });
    expect(await f.tool<{ sessions: Conversation[]; after: null }>({ op: "conversations.list" })).toEqual({ sessions: [], after: null });
    for (const extra of [{ principal: f.principal }, { selectedSessionId: "private-selection" }, { cwd: f.root }, { clientId: "forged-peer" }]) {
      await rejectedHttp(f, { op: "conversations.list", ...extra }, 400, "invalid");
    }
    expect(f.starts).toHaveLength(0);
    expect(f.stops).toHaveLength(0);
    expect(await f.db.run.count()).toBe(initialRuns);
    expect(await f.db.moduleCall.count({ where: { method: "model" } })).toBe(0);
  } finally { await f.close(); }
}, 30_000);

test("real Agent projects keep the Coding principal; peer selections stay out of shared facts", async () => {
  const f = await codingPeerFixture();
  try {
    await f.tool({ op: "conversations.list" });
    const path = await f.directory("first-project"), alias = await f.alias(path);
    const first = await register(f, "register-first", alias);
    expect(first.path).toBe(path);
    const same = await f.tool<Receipt<Project>>({ op: "projects.register", requestKey: "register-canonical", path });
    expect(same.receipt).toMatchObject({ status: "accepted", value: first });
    const second = await register(f, "register-second", await f.directory("second-project"));
    const webCreated = await f.ui<{ status: string; sessionId: string }>("ui-command", { action: "create", "request-key": "web-create", project: first.projectRef, title: "Shared conversation" });
    expect(webCreated.status).toBe("accepted");
    const sessionA = webCreated.sessionId, sessionB = (await create(f, "tool-create", second.projectRef)).id;
    await f.http({ op: "projects.default", requestKey: "set-default", projectRef: first.projectRef });
    const before = await f.journal();
    for (const [project, id] of [[first.projectRef, sessionA], [second.projectRef, sessionB], [first.projectRef, sessionA]]) {
      const catalog = await f.ui<{ sessions: { id: string }[] }>("ui-catalog", { project });
      expect(catalog.sessions.map(item => item.id)).toEqual([id!]);
      const detail = await f.ui<{ sessionId: string; project: string; workId: null }>("ui-work", { "session-id": id });
      expect(detail).toMatchObject({ sessionId: id, project, workId: null });
      expect((await f.http<{ sessions: Conversation[] }>({ op: "conversations.list" })).sessions.map(item => item.id)).toEqual([sessionA, sessionB]);
    }
    expect(await f.journal()).toEqual(before);
    expect(Object.keys(before).sort()).toEqual(["commands", "defaultProjectRef", "sessions", "version"]);
    expect(before.defaultProjectRef).toBe(first.projectRef);
    expect(f.seenProjects.length).toBeGreaterThan(0);
    for (const principal of f.seenProjects) expect(principal).toEqual(f.principal);
    expect(await f.ports.resolveExecutionProject!(f.principal, first.projectRef)).toMatchObject({ canonicalPath: path });
    // Host grants are bound to Coding, even when the caller entered through Web or HTTP.
    await expect(f.ports.resolveExecutionProject!({ ...f.principal, caller: { kind: "owner" } }, first.projectRef)).rejects.toMatchObject({ code: "forbidden" });
    expect(f.starts).toHaveLength(0);
    expect(f.stops).toHaveLength(0);
    expect(await f.db.moduleCall.count({ where: { method: "model" } })).toBe(0);
  } finally { await f.close(); }
}, 30_000);

test("HTTP, owner tool and coding-web share durable rounds, replay, scoped evidence and confirmed-stop gates", async () => {
  const f = await codingPeerFixture();
  try {
    await f.tool({ op: "conversations.list" });
    const project = await register(f, "register-work", await f.directory("work-project"));
    const session = await create(f, "conversation", project.projectRef), other = await create(f, "other-conversation", project.projectRef);
    const command = { op: "round.send", requestKey: "first-turn", sessionId: session.id, workId: null, text: "Implement the first change" };
    // Abort after the request reached real execution admission, not before dispatch.
    const gate = f.holdNextStart(), disconnected = new AbortController();
    const delivery = f.request(command, { signal: disconnected.signal }).catch(error => error);
    await Promise.race([gate.entered, delivery.then(response => { throw new Error(`Command returned before execution admission: ${response instanceof Response ? response.status : String(response)}`); })]);
    disconnected.abort(); gate.release();
    await delivery;
    const accepted = await f.tool<Receipt<{ sessionId: string; workId: string; execution: ExecutionView }>>({ op: "receipt", requestKey: command.requestKey });
    expect(accepted.receipt.status, JSON.stringify(accepted)).toBe("accepted");
    expect(accepted.receipt.value.sessionId).toBe(session.id);
    const first = accepted.receipt.value.execution, firstTarget = target(session.id, first);
    expect(f.starts).toHaveLength(1);
    expect(f.stops).toHaveLength(0);
    expect(first.sessionId).not.toBe(session.id);
    expect(f.starts[0]!.principal).toEqual(f.principal);
    expect(await f.http<typeof accepted>(command)).toEqual(accepted);
    expect(await f.tool<typeof accepted>(command)).toEqual(accepted);
    await rejectedHttp(f, { ...command, text: "Different payload with the same key" }, 409, "conflict");
    expect(f.starts).toHaveLength(1);

    await f.message(first.workId, "First durable assistant reply");
    const events = await f.http<ExecutionEventPage>({ op: "events", ...firstTarget, limit: 100 });
    expect(events.events).toHaveLength(1);
    expect(events.events[0]).toMatchObject({ workId: first.workId, sessionId: first.sessionId, runId: first.runId, attemptId: first.attemptId, payload: { type: "message", text: "First durable assistant reply" } });
    expect(await f.tool<ExecutionEventPage>({ op: "events", ...firstTarget, limit: 100 })).toEqual(events);
    const snapshot = await f.tool<ExecutionSnapshot>({ op: "snapshot", ...firstTarget });
    expect(snapshot).toMatchObject({ workId: first.workId, sessionId: first.sessionId, runId: first.runId, attemptId: first.attemptId, stopConfirmed: false, finalMessage: { text: "First durable assistant reply" } });
    expect(await f.http<ExecutionSnapshot>({ op: "snapshot", ...firstTarget })).toEqual(snapshot);
    for (const op of ["events", "snapshot"]) {
      await rejectedHttp(f, { op, ...firstTarget, sessionId: other.id }, 404, "not_found");
      await rejectedHttp(f, { op, ...firstTarget, runId: "another-run" }, 409, "conflict");
      await expect(f.tool({ op, ...firstTarget, attemptId: "another-attempt" })).rejects.toMatchObject({ code: "conflict" });
    }
    await rejectedHttp(f, { op: "results", sessionId: other.id, workId: first.workId }, 404, "not_found");
    const webWork = await f.ui<{ sessionId: string; workId: string; messages: { content: string }[] }>("ui-work", { "session-id": session.id });
    expect(webWork).toMatchObject({ sessionId: session.id, workId: first.workId });
    expect(webWork.messages.map(item => item.content)).toEqual(expect.arrayContaining([command.text, "First durable assistant reply"]));
    const live = { op: "round.send", requestKey: "owner-follow-up", sessionId: session.id, workId: first.workId, text: "Also update the docs" };
    const sent = await f.tool<Receipt>(live);
    expect(sent.receipt.status).toBe("accepted");
    expect(await f.http<typeof sent>(live)).toEqual(sent);
    expect(f.sends).toHaveLength(1);
    expect(f.starts).toHaveLength(1);

    // Neither half of terminal AND stopConfirmed is sufficient on its own.
    await f.state(first.workId, "completed", false);
    await rejectedHttp(f, { ...live, requestKey: "terminal-without-stop" }, 409, "conflict");
    await f.state(first.workId, "running", true);
    await expect(f.tool({ ...live, requestKey: "stopped-without-terminal" })).rejects.toMatchObject({ code: "conflict" });
    expect(f.starts).toHaveLength(1);
    await f.state(first.workId, "completed", true);
    const results = await f.http<{ results: { resultId: string; accepted: boolean }[] }>({ op: "results", sessionId: session.id, workId: first.workId });
    expect(results.results).toHaveLength(1);
    const result = results.results[0]!;
    const accept = { op: "accept", requestKey: "accept-result", sessionId: session.id, workId: first.workId, resultId: result.resultId };
    expect((await f.tool<Receipt>(accept)).receipt.status).toBe("accepted");
    expect((await f.http<typeof results>({ op: "results", sessionId: session.id, workId: first.workId })).results[0]).toMatchObject({ resultId: result.resultId, accepted: true });
    const nextCommand = { ...live, requestKey: "second-round", text: "Continue with another change" };
    const next = await f.http<Receipt<{ execution: ExecutionView }>>(nextCommand);
    expect(next.receipt.status, JSON.stringify(next)).toBe("accepted");
    const second = next.receipt.value.execution;
    expect(f.starts).toHaveLength(2);
    expect(f.starts[1]!.input.resumeFrom).toEqual({ workId: first.workId, runId: first.runId, attemptId: first.attemptId });
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.projectRef).toBe(first.projectRef);
    expect(second.workId).not.toBe(first.workId);
    expect(second.runId).not.toBe(first.runId);
    expect(second.attemptId).not.toBe(first.attemptId);
    await expect(f.tool({ op: "round.stop", requestKey: "stale-stop", ...firstTarget })).rejects.toMatchObject({ code: "conflict" });
    expect(f.stops).toHaveLength(0);

    const stop = { op: "round.stop", requestKey: "stop-second", ...target(session.id, second) };
    const stopping = await f.http<Receipt>(stop);
    expect(stopping.receipt.status).toBe("accepted");
    expect(await f.tool<typeof stopping>(stop)).toEqual(stopping);
    expect(f.stops).toHaveLength(1);
    await rejectedHttp(f, { op: "round.send", requestKey: "before-stop-confirmed", sessionId: session.id, workId: second.workId, text: "Too early" }, 409, "conflict");
    expect(f.starts).toHaveLength(2);
    await f.state(second.workId, "cancelled", true, true);
    const resumed = await f.ui<{ status: string }>("ui-command", { action: "send", "request-key": "web-third-round", project: project.projectRef, "session-id": session.id, "work-id": second.workId, text: "Continue after confirmed stop" });
    expect(resumed.status).toBe("accepted");
    expect(f.starts).toHaveLength(3);
    expect(f.starts[2]!.view.sessionId).toBe(first.sessionId);

    // Retire the real SDK process and reconstruct the same conversation from disk.
    const beforeRestart = await f.tool({ op: "conversations.get", sessionId: session.id });
    await f.restartCoding();
    expect(await f.http<typeof accepted>(command)).toEqual(accepted);
    expect(await f.http<typeof beforeRestart>({ op: "conversations.get", sessionId: session.id })).toEqual(beforeRestart);
    const journal = await f.journal();
    expect(journal.sessions.find((item: Conversation) => item.id === session.id).workIds).toHaveLength(3);
    expect(journal.commands.filter((item: { command: Command }) => item.command.requestKey === command.requestKey)).toHaveLength(1);
    expect(f.starts).toHaveLength(3);
    // Removing the optional UI client cannot interrupt shared Coding execution.
    await f.detachWeb();
    expect(await f.http<typeof beforeRestart>({ op: "conversations.get", sessionId: session.id })).toEqual(beforeRestart);
    expect(f.stops).toHaveLength(1);
    for (const principal of f.seenProjects) expect(principal).toEqual(f.principal);
    expect(await f.db.moduleCall.count({ where: { method: "model" } })).toBe(0);
  } finally { await f.close(); }
}, 30_000);
