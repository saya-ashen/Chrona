import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentConversations } from "./conversations";

type Args = Record<string, unknown>;
type Run = { runId: string; status: string; active: boolean };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(source: "web" | "mcp" | "qq" = "web", discovered?: string[], memory = false) {
  const dataDir = await mkdtemp(join(tmpdir(), "chrona-conversation-boundary-")); directories.push(dataDir);
  const path = join(dataDir, "conversations/state.json");
  const journal = async () => JSON.parse(await readFile(path, "utf8"));
  const calls: { target: string; args: Args }[] = [], runs = new Map<string, Run>(), replies: Args[] = [];
  let failRun = false, failWrite = false;
  const current = { status: "finished", active: false };
  const stream = { transcript: [{ at: "2026-11-09T00:00:01.000Z", kind: "text", text: "已核对" }], interactions: [{ id: "question-1", status: "waiting" }] };
  const call = async (target: string, args: Args = {}): Promise<unknown> => {
    calls.push({ target, args });
    if (target === `${source}.settings`) return { provider: memory ? "memory-local" : null, autoRecall: true, autoRetain: true };
    if (target === "modules.tools") return args.query ? ["conversation-context", "conversation-retain"].map(name => ({
      target: `memory-local.${name}`, moduleId: "memory-id", hash: "approved-hash", inputSchema: { type: "object", properties: { snapshot: { type: "string" } }, required: ["snapshot"] },
    })) : (discovered ?? []).map(target => ({ target }));
    if (target === "memory-local.conversation-context") return { text: "用户偏好中文", recalled: true };
    if (target === "memory-local.conversation-retain") return { retained: true, through: JSON.parse(String(args.snapshot)).messages.at(-1)?.at, chars: 4 };
    if (target === "agent.context") {
      expect((await journal()).sessions.at(-1).turns).toHaveLength(1);
      return { contextId: `owned:${args["request-key"]}` };
    }
    if (target === "agent.run") {
      expect((await journal()).sessions.at(-1).contextId).toBe(args["context-id"]);
      const key = String(args["request-key"]);
      if (!runs.has(key)) runs.set(key, { runId: `run-${runs.size + 1}`, status: "running", active: true });
      if (failRun) { failRun = false; throw new Error("response lost"); }
      return runs.get(key);
    }
    if (target === "agent.get") return current;
    if (target === "agent.stream") return stream;
    if (target === "agent.write") { if (failWrite) throw new Error("write response lost"); return { ok: true }; }
    if (target === "agent.respond" || target === "agent.interrupt") return { ok: true };
    throw new Error(`Unexpected call: ${target}`);
  };
  const restart = () => createAgentConversations({ source, dataDir, call, ...(discovered === undefined ? { tools: [] } : {}), reply: event => { replies.push(event); }, now: () => new Date("2026-11-09T00:00:02.000Z") });
  return { path, journal, calls, runs, replies, restart, current, stream, loseRunResponse: () => { failRun = true; }, loseWriteResponse: () => { failWrite = true; } };
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
  [["projects.scan", "projects.scan", "agent.run", "web.send", "qq.deliver", "mcp.call", "chat.send"], ["projects.scan"]],
  [["modules.build", "modules.check", "custom.inspect"], ["modules.build", "modules.check", "custom.inspect"]],
  [[], []],
] as const) test(`tool selection uses only available routed targets: ${expected.join(", ") || "empty"}`, async () => {
  const f = await fixture("web", [...discovered]);
  await f.restart().send({ text: "查看工具", requestKey: "tools" });
  expect(f.calls.find(item => item.target === "modules.tools")?.args).toEqual({ audience: "user" });
  expect(f.calls.find(item => item.target === "agent.run")?.args.tools).toEqual([...expected]);
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
