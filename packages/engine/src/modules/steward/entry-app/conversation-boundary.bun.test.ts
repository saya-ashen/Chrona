import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentConversations } from "./conversations";
import { receiptFixture, receiptItem, receiptEvent, healthFixture } from "./delivery-fixture";

type Args = Record<string, unknown>;
type Run = { runId: string; status: string; active: boolean };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(source: "web" | "mcp" | "qq" = "web", discovered?: string[], memory = false) {
  const dataDir = await mkdtemp(join(tmpdir(), "chrona-conversation-boundary-")); directories.push(dataDir);
  const path = join(dataDir, "conversations/state.json");
  const journal = async () => JSON.parse(await readFile(path, "utf8"));
  const calls: { target: string; args: Args }[] = [], runs = new Map<string, Run>(), replies: Args[] = [];
  const admitted = new Map<string, string>();
  let failRun = false, failWrite = false, failStream = false;
  const current = { status: "finished", active: false };
  const stream = { transcript: [{ at: "2026-11-09T00:00:01.000Z", kind: "text", text: "已核对" }] as { at: string; kind: string; text?: string; tool?: string; error?: boolean }[], interactions: [{ id: "question-1", status: "waiting" }], items: [] as { sequence: number; payload: unknown }[], after: 0 };
  let clock = "2026-11-09T00:00:02.000Z";
  const delivery = { receipt: null as unknown, health: [] as unknown[], pages: [] as { module: string; moduleId: string; hash: string; id: string; title: string }[], unavailable: false };
  const call = async (target: string, args: Args = {}): Promise<unknown> => {
    calls.push({ target, args });
    if (target === `${source}.settings`) return { provider: memory ? "memory-local" : null, autoRecall: true, autoRetain: true };
    if (target === "modules.list") return { items: ["agent", "web", "qq", "mcp"].map(name => ({ id: `${name}-id`, name })), nextCursor: null };
    if (target === "modules.describe") return { items: args.query ? ["conversation-context", "conversation-retain"].map(name => ({
          target: `memory-local.${name}`, moduleId: "memory-id", hash: "approved-hash", inputSchema: { type: "object", properties: { snapshot: { type: "string" } }, required: ["snapshot"] },
        })) : (discovered ?? []).map(target => ({ target, ...(!/^(modules|approvals|settings|secrets|activity|timers)\./.test(target) ? { moduleId: `${target.split(".")[0]}-id` } : {}) })), nextCursor: null };
    if (target === "memory-local.conversation-context") return { text: "用户偏好中文", recalled: true };
    if (target === "memory-local.conversation-retain") return { retained: true, through: JSON.parse(String(args.snapshot)).messages.at(-1)?.at, chars: 4 };
    if (target === "agent.context") {
      expect((await journal()).sessions.at(-1).turns).toHaveLength(1);
      return { contextId: `owned:${args["request-key"]}` };
    }
    if (target === "agent.run") {
      expect((await journal()).sessions.at(-1).contextId).toBe(args["context-id"]);
      const key = String(args["request-key"]);
      if (admitted.has(key)) expect(JSON.stringify(args)).toBe(admitted.get(key)!);
      else admitted.set(key, JSON.stringify(args));
      if (!runs.has(key)) runs.set(key, { runId: `run-${runs.size + 1}`, status: "running", active: true });
      if (failRun) { failRun = false; throw new Error("response lost"); }
      return runs.get(key);
    }
    if (target === "modules.receipt") { if (delivery.unavailable) throw new Error("denied"); return delivery.receipt; }
    if (target === "modules.health") { if (delivery.unavailable) throw new Error("offline"); return { items: delivery.health, nextCursor: null }; }
    if (target === "agent.get") return current;
    if (target === "agent.stream") { if (failStream) { failStream = false; throw new Error("stream unavailable"); } return stream; }
    if (target === "agent.write") { if (failWrite) throw new Error("write response lost"); return { ok: true }; }
    if (target === "agent.respond" || target === "agent.interrupt") return { ok: true };
    throw new Error(`Unexpected call: ${target}`);
  };
  const restart = () => createAgentConversations({ source, dataDir, call, ...(discovered === undefined ? { tools: [] } : {}), reply: event => { replies.push(event); }, now: () => new Date(clock), deliveryPages: async () => { if (delivery.unavailable) throw new Error("offline"); return delivery.pages; } });
  return { path, journal, calls, runs, replies, restart, current, stream, delivery, advance: () => { clock = new Date(Date.parse(clock) + 2000).toISOString(); }, loseRunResponse: () => { failRun = true; }, loseWriteResponse: () => { failWrite = true; }, loseStreamResponse: () => { failStream = true; } };
}

for (const source of ["web", "qq", "mcp"] as const) test(`${source}: foreground sends preserve private context, replay identity and persisted replies`, async () => {
  const f = await fixture(source), app = f.restart();
  const first = await app.send({ text: "核对状态", requestKey: "first" });
  expect(first.sessionId.startsWith(`${source}-agent:`)).toBe(true);
  expect(await f.restart().send({ text: "核对状态", requestKey: "first" })).toEqual(first);
  await expect(app.send({ text: "changed", requestKey: "first" })).rejects.toMatchObject({ code: "conflict" });
  expect(f.calls.filter(item => item.target === "agent.context")).toHaveLength(1);
  expect(f.calls.filter(item => item.target === "agent.run")).toHaveLength(1);
  expect(f.calls.find(item => item.target === "agent.run")?.args).toMatchObject({ lane: "foreground", "context-id": (await f.journal()).sessions[0].contextId });
  await app.poll();
  expect((await f.restart().messages(first.sessionId)).map(message => [message.direction, message.text])).toEqual([["in", "核对状态"], ["out", "已核对"]]);
  expect(f.replies).toHaveLength(1);
  await f.restart().poll();
  expect(f.replies).toHaveLength(1);
  await f.restart().send({ session: first.sessionId, text: "继续", requestKey: "second" });
  expect(f.calls.filter(item => item.target === "agent.context")).toHaveLength(1);
  expect(f.runs.size).toBe(2);
  f.stream.transcript.push({ at: "2026-11-09T00:00:03.000Z", kind: "text", text: "新回复" });
  await f.restart().poll();
  expect((await app.messages(first.sessionId)).at(-1)?.text).toBe("新回复");
});

test("a lost run response requires the original send and reuses its persisted identity after restart", async () => {
  const f = await fixture(); f.loseRunResponse();
  await expect(f.restart().send({ text: "核对状态", requestKey: "first" })).rejects.toThrow("response lost");
  const before = (await f.journal()).sessions[0];
  expect(before.turns[0].runId).toBeUndefined();
  await f.restart().poll();
  expect(f.calls.filter(item => item.target === "agent.run")).toHaveLength(1);
  await expect(f.restart().send({ session: before.id, text: "different request", requestKey: "second" })).rejects.toMatchObject({ code: "conflict" });
  const sent = await f.restart().send({ text: "核对状态", requestKey: "first" });
  const requests = f.calls.filter(item => item.target === "agent.run");
  expect(requests).toHaveLength(2);
  expect(requests[1]!.args).toEqual(requests[0]!.args);
  expect(sent.runId).toBe("run-1");
  expect(f.runs.size).toBe(1);
});

for (const [discovered, expected] of [
  [["projects.scan", "projects.scan", "agent.run", "web.send", "qq.deliver", "mcp.call"], ["projects.scan"]],
  [["modules.build", "modules.check", "custom.inspect"], ["modules.build", "modules.check", "custom.inspect"]],
  [[], []],
] as const) test(`tool selection uses only available routed targets: ${expected.join(", ") || "empty"}`, async () => {
  const f = await fixture("web", [...discovered]);
  await f.restart().send({ text: "查看工具", requestKey: "tools" });
  expect(f.calls.find(item => item.target === "modules.describe")?.args).toEqual({ audience: "user", limit: 100 });
  expect(f.calls.find(item => item.target === "agent.run")?.args.tools).toEqual(expected.map(target => /^(modules|approvals|settings|secrets|activity|timers)\./.test(target) ? target : { moduleId: `${target.split(".")[0]}-id`, tool: target.split(".")[1] }));
});

test("running conversations accept supplemental input once and preserve unresolved delivery", async () => {
  const f = await fixture(); f.current.status = "running"; f.current.active = true;
  const first = await f.restart().send({ text: "开始", requestKey: "first" });
  const supplemental = { session: first.sessionId, text: "补充", requestKey: "second" };
  const sent = await f.restart().send(supplemental);
  expect(sent.runId).toBe(first.runId);
  expect(await f.restart().send(supplemental)).toEqual(sent);
  expect(f.calls.filter(item => item.target === "agent.write")).toHaveLength(1);
  expect(f.runs.size).toBe(1);
  f.loseWriteResponse();
  const unresolved = { session: first.sessionId, text: "再补充", requestKey: "third" };
  await expect(f.restart().send(unresolved)).rejects.toThrow("write response lost");
  await expect(f.restart().send(unresolved)).rejects.toMatchObject({ code: "unknown" });
  expect(f.calls.filter(item => item.target === "agent.write")).toHaveLength(2);
  await expect(f.restart().update(first.sessionId, { status: "ended" })).rejects.toMatchObject({ code: "conflict" });
});

for (const status of ["queued", "unknown"]) test(`${status} active runs block supplemental input and ending`, async () => {
  const f = await fixture(); f.current.status = status; f.current.active = true;
  const app = f.restart(), sent = await app.send({ text: "开始", requestKey: "first" });
  await expect(app.send({ session: sent.sessionId, text: "补充", requestKey: "second" })).rejects.toMatchObject({ code: "conflict" });
  await expect(app.update(sent.sessionId, { status: "ended" })).rejects.toMatchObject({ code: "conflict" });
  expect(await app.messages(sent.sessionId)).toHaveLength(1);
  expect(f.calls.filter(item => item.target === "agent.run")).toHaveLength(1);
  expect(f.calls.some(item => item.target === "agent.write")).toBe(false);
});

test("ownership checks guard contexts, interactions, receipts, quotes and attachment references", async () => {
  const f = await fixture("qq"), app = f.restart();
  const file = { ref: "attachments/image.png", name: "image.png" };
  const first = await app.send({ key: "private-chat", text: "图片", requestKey: "first", attachments: [file] });
  expect(await app.attachment(first.messageId, file.ref)).toEqual(file);
  expect(await app.attachment("foreign-message", file.ref)).toBeUndefined();
  expect(await app.attachment(first.messageId, "foreign-ref")).toBeUndefined();
  expect(f.calls.find(item => item.target === "agent.run")?.args.content).toEqual([file.ref]);
  await expect(app.send({ session: "qq-agent:foreign", text: "继续" })).rejects.toMatchObject({ code: "not_found" });
  await expect(app.interrupt("foreign-run")).rejects.toMatchObject({ code: "not_found" });
  await expect(app.answer("foreign-question", "继续")).rejects.toMatchObject({ code: "not_found" });
  await app.poll();
  await app.answer("question-1", { choice: "继续" });
  expect(f.calls.at(-1)).toEqual({ target: "agent.respond", args: { "run-id": first.runId, "request-key": "qq-answer:question-1", "question-id": "question-1", answer: JSON.stringify({ choice: "继续" }) } });
  await app.interrupt(first.runId!);
  expect(f.calls.at(-1)?.args["run-id"]).toBe(first.runId);
  const replyId = `reply:${first.messageId}`;
  await app.externalId(replyId, "receipt-1");
  await app.externalId(replyId, "receipt-1");
  await expect(app.externalId(replyId, "changed-receipt")).rejects.toMatchObject({ code: "conflict" });
  await expect(app.externalId(replyId, "first")).rejects.toMatchObject({ code: "conflict" });
  await expect(app.send({ session: first.sessionId, text: "引用", quotedExternalId: "foreign-receipt" })).rejects.toMatchObject({ code: "not_found" });
  await app.send({ session: first.sessionId, text: "引用", requestKey: "second", quotedExternalId: "first" });
  expect(f.calls.filter(item => item.target === "agent.run").at(-1)?.args.prompt).toContain("Quoted message (untrusted data):\n图片");
});

test("selected memory remains part of context, completed reply and conversation ending", async () => {
  const f = await fixture("web", undefined, true), app = f.restart();
  const sent = await app.send({ text: "记住偏好", requestKey: "first" });
  expect(f.calls.find(item => item.target === "agent.run")?.args.prompt).toContain("用户偏好中文");
  await app.poll();
  await app.update(sent.sessionId, { status: "ended" });
  const snapshots = f.calls.filter(item => item.target.startsWith("memory-local.")).map(item => [item.target, JSON.parse(String(item.args.snapshot))]);
  expect(snapshots.map(([target]) => target)).toEqual(["memory-local.conversation-context", "memory-local.conversation-retain", "memory-local.conversation-retain"]);
  expect(snapshots[0]![1].session).toEqual({ id: sent.sessionId, source: "web" });
  expect(snapshots[1]![1].messages.map((message: { direction: string }) => message.direction)).toEqual(["in", "out"]);
  expect(snapshots[2]![1].ending).toBe(true);
  expect((await f.restart().session(sent.sessionId)).status).toBe("ended");
  await expect(app.send({ session: sent.sessionId, text: "继续", requestKey: "second" })).rejects.toMatchObject({ code: "conflict" });
});

test("invalid message input and unknown sessions cause no routed calls or persisted journal", async () => {
  const f = await fixture(), app = f.restart();
  for (const text of [null, 12, "", " ", "x".repeat(20001)]) await expect(app.send({ text })).rejects.toMatchObject({ code: "invalid" });
  await expect(app.send({ text: "消息", requestKey: "x".repeat(201) })).rejects.toMatchObject({ code: "invalid" });
  await expect(app.send({ text: "消息", session: "web-agent:foreign" })).rejects.toMatchObject({ code: "not_found" });
  expect(f.calls).toHaveLength(0);
  await expect(readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
});

for (const source of ["web", "mcp", "qq"] as const) for (const status of ["failed", "timed_out", "provider_unavailable", "cancelled"]) test(`${source}: ${status} keeps early text separate from a durable incomplete outcome`, async () => {
  const f = await fixture(source), app = f.restart();
  const sent = await app.send({ text: "完成核对", requestKey: "original" });
  f.current.status = status;
  await app.poll();
  const reply = (await f.restart().messages(sent.sessionId)).at(-1)!;
  expect(reply.execution).toMatchObject({ runId: sent.runId, status, active: false, canContinue: true });
  expect(reply.text).toContain(status === "cancelled" ? "停止" : "未完成");
  expect(reply.text).toContain("过程文字（不代表完成）");
  expect(reply.progress).toBe("已核对");
  expect((await f.journal()).sessions[0].turns[0]).toMatchObject({ status, active: false, reason: reply.execution!.reason });
  expect(await f.restart().execution(sent.sessionId)).toEqual(reply.execution!);
  expect(f.runs.size).toBe(1);
  expect(f.replies).toHaveLength(1);
});

for (const status of ["queued", "running", "unknown"]) test(`${status}: explicit continuation cannot replay active or stop-unknown work`, async () => {
  const f = await fixture(), app = f.restart(), sent = await app.send({ text: "开始", requestKey: "original" });
  f.current.status = status; f.current.active = status !== "unknown";
  await expect(app.continue(sent.sessionId, { runId: sent.runId!, requestKey: "continue-click" })).rejects.toMatchObject({ code: "conflict" });
  expect((await app.execution(sent.sessionId))?.canContinue).toBe(false);
  expect(await app.messages(sent.sessionId)).toHaveLength(1);
  expect(f.runs.size).toBe(1);
});

test("normalized recovering progress is persisted and cannot offer continuation", async () => {
  const f = await fixture(), app = f.restart(), sent = await app.send({ text: "开始", requestKey: "original" });
  f.current.status = "running"; f.current.active = true;
  f.stream.items.push({ sequence: 1, payload: { type: "progress", value: { phase: "recovering" } } }); f.stream.after = 1;
  expect(await app.execution(sent.sessionId)).toMatchObject({ status: "running", active: true, phase: "recovering", canContinue: false });
  expect((await f.journal()).sessions[0].turns[0].phase).toBe("recovering");
  await expect(f.restart().continue(sent.sessionId, { runId: sent.runId!, requestKey: "explicit" })).rejects.toMatchObject({ code: "conflict" });
  expect(f.runs.size).toBe(1);
});

test("explicit continue retains context/history and exact click identity through duplicate calls, lost response and reload", async () => {
  const f = await fixture(), app = f.restart(), sent = await app.send({ text: "检查后处理", requestKey: "original" });
  f.current.status = "failed"; await app.poll();
  const request = { runId: sent.runId!, requestKey: "continue-click" };
  f.loseRunResponse();
  await expect(app.continue(sent.sessionId, request)).rejects.toThrow("response lost");
  expect(await f.restart().execution(sent.sessionId)).toMatchObject({ status: "pending", active: true, canContinue: false, pendingContinuation: request });
  const pending = (await f.journal()).sessions[0];
  expect(pending.turns).toHaveLength(2);
  expect(pending.turns[1]).toMatchObject({ continuationOf: sent.runId, key: request.requestKey });
  // Polling never repeats the pending admission automatically.
  const callsBefore = f.calls.filter(call => call.target === "agent.run").length;
  await f.restart().poll();
  expect(f.calls.filter(call => call.target === "agent.run")).toHaveLength(callsBefore);
  const continued = await f.restart().continue(sent.sessionId, request);
  expect(await app.continue(sent.sessionId, request)).toEqual(continued);
  expect(f.runs.size).toBe(2);
  expect((await f.journal()).sessions[0].messages.map((message: { direction: string }) => message.direction)).toEqual(["in", "out", "in"]);
  const runs = f.calls.filter(call => call.target === "agent.run");
  expect(runs[1]!.args).toEqual(runs[2]!.args);
  expect(runs[1]!.args["request-key"]).not.toBe(runs[0]!.args["request-key"]);
  expect(runs[1]!.args["context-id"]).toBe(runs[0]!.args["context-id"]);
  expect(runs[1]!.args.prompt).toContain("Inspect the current state and prior tool outcomes");
  expect(runs[1]!.args.prompt).toContain("Never repeat actions with unknown effects");
  expect(f.calls.filter(call => call.target === "agent.context")).toHaveLength(1);
  await expect(app.continue(sent.sessionId, { ...request, runId: continued.runId! })).rejects.toMatchObject({ code: "conflict" });
  await expect(app.send({ session: sent.sessionId, text: pending.turns[1].text, requestKey: request.requestKey })).rejects.toMatchObject({ code: "conflict" });
});

test("refresh corrects old failed plain replies without duplicating delivery or hiding early text", async () => {
  const f = await fixture(), app = f.restart(), sent = await app.send({ text: "开始", requestKey: "original" });
  await app.poll();
  const state = await f.journal(); state.sessions[0].turns[0].status = "failed";
  delete state.sessions[0].messages[1].execution;
  await writeFile(f.path, JSON.stringify(state)); f.current.status = "failed";
  const messages = await f.restart().messages(sent.sessionId);
  expect(messages).toHaveLength(2);
  expect(messages[1]!.text).toContain("本次执行失败");
  expect(messages[1]!.progress).toBe("已核对");
  expect(messages[1]!.id).toBe(`reply:${sent.messageId}`);
});

test("lost continuation admission freezes the tool catalog and prompt across reload", async () => {
  const tools = ["files.list"], f = await fixture("web", tools), app = f.restart();
  const sent = await app.send({ text: "核对文件", requestKey: "original" }); f.current.status = "failed"; await app.poll();
  const request = { runId: sent.runId!, requestKey: "continue-click" }; f.loseRunResponse();
  await expect(app.continue(sent.sessionId, request)).rejects.toThrow("response lost");
  tools.push("files.read");
  await f.restart().continue(sent.sessionId, request);
  const requests = f.calls.filter(call => call.target === "agent.run");
  expect(requests[1]!.args).toEqual(requests[2]!.args);
  expect(requests[2]!.args.tools).toEqual([{ moduleId: "files-id", tool: "list" }]);
});

test("a transcript read failure cannot hide terminal failure and a later refresh reconciles early text", async () => {
  const f = await fixture(), app = f.restart(), sent = await app.send({ text: "检查", requestKey: "original" });
  f.current.status = "failed"; f.loseStreamResponse();
  const failed = (await app.messages(sent.sessionId)).at(-1)!;
  expect(failed.execution).toMatchObject({ status: "failed", active: false, canContinue: true });
  expect(failed.text).toContain("本次执行失败");
  expect((await f.journal()).sessions[0].turns[0]).toMatchObject({ status: "failed", streamPending: true });
  const refreshed = (await f.restart().messages(sent.sessionId)).at(-1)!;
  expect(refreshed.id).toBe(failed.id);
  expect(refreshed.progress).toBe("已核对");
  expect((await f.journal()).sessions[0].turns[0].streamPending).toBe(false);
  expect(f.runs.size).toBe(1);
});

test("finished status cannot publish cached process text before the final reply can be read", async () => {
  const f = await fixture("web", undefined, true), app = f.restart();
  const sent = await app.send({ text: "检查", requestKey: "original" });
  f.current.status = "running"; f.current.active = true; await app.poll();
  f.current.status = "finished"; f.current.active = false; f.loseStreamResponse();
  expect(await app.execution(sent.sessionId)).toMatchObject({ status: "finished", active: false, replyPending: true, canContinue: false });
  expect((await f.journal()).sessions[0].messages).toHaveLength(1);
  expect(f.replies).toHaveLength(0);
  expect(f.calls.filter(item => item.target === "memory-local.conversation-retain")).toHaveLength(0);
  f.loseStreamResponse();
  expect(await f.restart().messages(sent.sessionId)).toHaveLength(1);
  f.stream.transcript.push({ at: "2026-11-09T00:00:03.000Z", kind: "text", text: "最终核对结果" });
  const reply = (await f.restart().messages(sent.sessionId)).at(-1)!;
  expect(reply.text).toContain("最终核对结果");
  expect(reply.execution).toMatchObject({ status: "finished", replyPending: false });
  expect(f.calls.filter(item => item.target === "memory-local.conversation-retain")).toHaveLength(1);
  expect(f.runs.size).toBe(1);
});

test("ordinary lost admission exposes only explicit reconciliation of the frozen original request", async () => {
  const f = await fixture("web", ["source.original"]); f.loseRunResponse();
  await expect(f.restart().send({ text: "检查原请求", requestKey: "original" })).rejects.toThrow("response lost");
  const session = (await f.journal()).sessions[0];
  expect(await f.restart().execution(session.id)).toMatchObject({ status: "pending", active: true, canContinue: false, pendingAdmission: { requestKey: "original" } });
  await f.restart().poll();
  expect(f.calls.filter(item => item.target === "agent.run")).toHaveLength(1);
  await expect(f.restart().reconcile(session.id, { requestKey: "foreign" })).rejects.toMatchObject({ code: "not_found" });
  const app = createAgentConversations({ source: "web", dataDir: f.path.replace("/conversations/state.json", ""), tools: ["source.changed"], call: async (target, args) => {
    if (target !== "agent.run") throw new Error(`Unexpected reconcile call ${target}`);
    expect(args).toEqual(f.calls.find(item => item.target === "agent.run")!.args);
    return { runId: "run-1", status: "running", active: true };
  }, reply: () => {} });
  expect(await app.reconcile(session.id, { requestKey: "original" })).toMatchObject({ runId: "run-1", sessionId: session.id });
  expect(await f.restart().reconcile(session.id, { requestKey: "original" })).toMatchObject({ runId: "run-1" });
  expect(f.runs.size).toBe(1);
});

test("timeout receipt survives restart and later activation reconciles without another Run", async () => {
  const f = await fixture("web", ["author.submit"]);
  const first = await f.restart().send({ text: "创建音乐应用", requestKey: "music" });
  f.current.status = "timed_out";
  f.stream.items = [receiptEvent(first.runId!)];
  f.stream.transcript = [receiptItem(), { at: "2026-11-09T00:00:04.000Z", kind: "text", text: "提交成功，正在等待激活" }];
  f.delivery.receipt = receiptFixture();
  await f.restart().poll();
  const pending = (await f.restart().messages(first.sessionId)).at(-1)!;
  expect(pending.execution).toMatchObject({ status: "timed_out", canContinue: true, applicationDelivery: [{ receipt: receiptFixture(), targets: [{ activation: "unknown" }], browser: "unknown" }] });
  expect((await f.journal()).sessions[0].turns[0].applicationDelivery[0].receipt).toEqual(receiptFixture());
  const before = f.calls.length;
  f.advance();
  f.delivery.health = [healthFixture()];
  f.delivery.pages = [{ module: "music", moduleId: "music-id", hash: "b".repeat(40), id: "home", title: "音乐" }];
  const observed = await f.restart().execution(first.sessionId);
  expect(observed).toMatchObject({ status: "timed_out", active: false, canContinue: true, applicationDelivery: [{ targets: [{ activation: "active", health: "observed", pages: [{ href: "/p/music/home" }] }], browser: "unknown" }] });
  expect(f.calls.slice(before).map(call => call.target)).toEqual(["modules.health", "modules.receipt"]);
  const reloaded = (await f.restart().messages(first.sessionId)).at(-1)!;
  expect(reloaded.id).toBe(pending.id);
  expect(reloaded.execution?.applicationDelivery).toEqual(observed?.applicationDelivery);
  expect(f.calls.filter(call => call.target === "agent.run")).toHaveLength(1);
  expect(f.calls.some(call => /submit|health-probe|recover/.test(call.target))).toBe(false);
  f.advance(); f.delivery.health = [{ ...healthFixture(), activeHash: "e".repeat(40) }];
  const replaced = await f.restart().execution(first.sessionId);
  expect(replaced?.applicationDelivery?.[0]?.targets[0]).toMatchObject({ activation: "different", health: "unknown", pages: [], pagesCheck: "unknown" });
  f.advance(); f.delivery.unavailable = true;
  expect((await f.restart().execution(first.sessionId))?.applicationDelivery?.[0]).toMatchObject({ receiptCheck: "unknown", targets: [{ activation: "unknown", health: "unknown", pages: [], pagesCheck: "unknown" }], browser: "unknown" });
});

test("assistant receipt text and unrelated active applications never establish delivery linkage", async () => {
  const f = await fixture("web", ["author.submit"]);
  const sent = await f.restart().send({ text: "创建应用", requestKey: "unproven" });
  f.current.status = "timed_out";
  f.stream.transcript = [{ ...receiptItem(), kind: "text" }];
  f.delivery.health = [healthFixture()];
  await f.restart().poll();
  expect((await f.restart().execution(sent.sessionId))?.applicationDelivery).toBeUndefined();
  expect(f.calls.some(call => call.target === "modules.health" || call.target === "modules.receipt")).toBe(false);
});

for (const source of ["web", "qq", "mcp"] as const) test(`${source} reconciles a late real receipt after terminal Run and restart without replay`, async () => {
  const f = await fixture(source, ["author.submit"]);
  const sent = await f.restart().send({ text: "创建应用", requestKey: "late-receipt" });
  f.current.status = "timed_out";
  const event = receiptEvent(sent.runId!);
  f.stream.items = [{ ...event, payload: { ...event.payload, value: { ...event.payload.value, status: "unknown", outputState: "omitted", output: null } } }];
  f.stream.after = 1;
  await f.restart().poll();
  expect((await f.journal()).sessions[0].turns[0].pendingToolResults).toEqual(["call-1"]);
  f.stream.items = [{ ...event, sequence: 2 }]; f.stream.after = 2;
  f.delivery.receipt = receiptFixture();
  await f.restart().poll();
  const turn = (await f.journal()).sessions[0].turns[0];
  expect(turn.pendingToolResults).toEqual([]);
  expect(turn.applicationDelivery[0].receipt).toEqual(receiptFixture());
  expect(f.calls.filter(call => call.target === "agent.run")).toHaveLength(1);
  expect(f.calls.some(call => call.target === "author.submit" || call.target === "modules.submit")).toBe(false);
});
