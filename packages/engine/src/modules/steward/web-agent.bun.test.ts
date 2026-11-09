import { expect, test } from "bun:test";
import { cp, readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { agentFixture } from "../../../../../scripts/agent-integration/agent-application.fixtures";
import { callSync, kernelOrigin } from "./module-calls";
import { createAgentConversations } from "./external/web/agent-conversations";
import { createRuns } from "./runs";

test("attachment ownership uses the complete private journal, not the recent message window", async () => {
  const dataDir = await mkdtemp("/tmp/chrona-journal-attachment-");
  try {
    const file = { name: "old.png", ref: "web/attachments/old.png" };
    const first = { id: "old-message", direction: "in", text: "old", attachments: [file] };
    const messages = [first, ...Array.from({ length: 101 }, (_, index) => ({ id: `later-${index}`, direction: "in", text: "later", attachments: [] }))];
    await mkdir(join(dataDir, "conversations"));
    await writeFile(join(dataDir, "conversations/state.json"), JSON.stringify({ version: 1, sessions: [{ id: "web-agent:journal", messages, turns: [] }] }));
    const app = createAgentConversations({ dataDir, call: async () => { throw new Error("No Agent call during file ownership lookup"); }, reply: () => {} });
    expect(await app.messages("web-agent:journal")).toHaveLength(100);
    expect(await app.attachment(first.id, file.ref)).toEqual(file);
    expect(await app.attachment("foreign", file.ref)).toBeUndefined();
    expect(await app.attachment(first.id, "qq/private")).toBeUndefined();
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test("Web owns persisted conversations while actual Agent SDK admits scoped and replay-safe runs", async () => {
  const f = await agentFixture();
  try {
    await f.ports.db.run.delete({ where: { id: "agent-run" } });
    for (const name of ["web", "notify"]) {
      const source = join(import.meta.dir, "external", name), hash = `web-agent-${name}`;
      const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(source, "module.json"), "utf8")));
      await cp(source, join(f.ports.dataDir, "platform/store", hash), { recursive: true });
      const module = await f.ports.db.module.update({ where: { workspaceId_name: { workspaceId: f.workspaceId, name } }, data: { activeHash: hash } });
      await f.ports.db.moduleVersion.create({ data: { moduleId: module.id, hash, source: "builtin", status: "approved", manifest, intent: {}, report: {} } });
    }
    f.ports.onQueued = () => new Promise(() => {});
    const web = await f.ports.db.module.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId: f.workspaceId, name: "web" } } });
    const caller = { kind: "module" as const, module: "web", moduleId: web.id, hash: web.activeHash! };
    let loseRunResponse = false;
    const call = async (target: string, args: Record<string, unknown> = {}) => {
      const output = (await callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller }, target, args)).output;
      if (target === "agent.run" && loseRunResponse) { loseRunResponse = false; throw new Error("admission response lost"); }
      return output;
    };
    const replies: Record<string, unknown>[] = [], options = { dataDir: join(f.root, "web-data"), call, reply: (event: Record<string, unknown>) => { replies.push(event); } };
    let conversations = createAgentConversations(options);
    const sent = await conversations.send({ text: "请检查应用状态", requestKey: "first" });
    expect(sent.sessionId).toMatch(/^web-agent:/);
    expect(sent.queued).toBe(true);
    conversations = createAgentConversations(options);
    expect(await conversations.send({ text: "请检查应用状态", requestKey: "first" })).toEqual(sent);
    await expect(conversations.send({ text: "changed", requestKey: "first" })).rejects.toMatchObject({ code: "conflict" });
    expect(await f.ports.db.run.count()).toBe(1);
    expect((await conversations.list()).map(session => session.id)).toContain(sent.sessionId);
    await expect(conversations.send({ session: sent.sessionId, text: "排队时不重复启动", requestKey: "second" })).rejects.toMatchObject({ code: "conflict" });
    await conversations.interrupt(sent.runId!);
    await conversations.poll();
    expect(replies).toHaveLength(1);
    expect((await conversations.messages(sent.sessionId)).at(-1)?.text).toContain("停止");
    conversations = createAgentConversations(options);
    await conversations.poll();
    expect(replies).toHaveLength(1);
    const next = await conversations.send({ session: sent.sessionId, text: "继续", requestKey: "second" });
    const run = await f.ports.db.run.findUniqueOrThrow({ where: { id: next.runId! } });
    const claimed = await createRuns(f.ports, f.workspaceId).claimNext("foreground");
    expect(claimed?.id).toBe(run.id);
    const transcriptDir = join(f.ports.dataDir, "sessions", run.sessionId!, ".chrona/sessions");
    await mkdir(transcriptDir, { recursive: true });
    await writeFile(join(transcriptDir, "reply.jsonl"), JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "已经核对状态。" }] } }) + "\n");
    await createRuns(f.ports, f.workspaceId).finish(run.id, { outcome: "failed", sessionId: null, error: "fixture provider terminated after early text" }, { stopEvidence: "provider_exited" });
    conversations = createAgentConversations(options);
    const failed = (await conversations.messages(sent.sessionId)).at(-1)!;
    expect(failed.execution).toMatchObject({ runId: run.id, status: "failed", active: false, canContinue: true });
    expect(failed.text).toContain("本次执行失败");
    expect(failed.text).toContain("已产生的过程文字（不代表完成）");
    expect(failed.progress).toBe("已经核对状态。");
    expect((await f.ports.db.run.findUniqueOrThrow({ where: { id: run.id } })).error).toBe("fixture provider terminated after early text");
    // Agent's existing public view omits the private error; the entry reports that limit honestly.
    expect(failed.execution?.reason).toContain("执行接口未提供详细原因");
    expect(replies).toHaveLength(2);
    expect(await f.ports.db.run.count()).toBe(2);
    const request = { runId: run.id, requestKey: `web-continue:${run.id}` };
    loseRunResponse = true;
    await expect(conversations.continue(sent.sessionId, request)).rejects.toThrow("admission response lost");
    expect(await f.ports.db.run.count()).toBe(3);
    conversations = createAgentConversations(options);
    expect(await conversations.execution(sent.sessionId)).toMatchObject({ status: "pending", active: true, canContinue: false, pendingContinuation: request });
    await conversations.poll();
    expect(await f.ports.db.run.count()).toBe(3);
    const continued = await conversations.continue(sent.sessionId, request);
    expect(await createAgentConversations(options).continue(sent.sessionId, request)).toEqual(continued);
    expect(await f.ports.db.run.count()).toBe(3);
    const continuedRun = await f.ports.db.run.findUniqueOrThrow({ where: { id: continued.runId! } });
    expect(continuedRun.sessionId).toBe(run.sessionId);
    expect((await conversations.messages(sent.sessionId)).some(message => message.text === "请检查应用状态")).toBe(true);
    expect((await createRuns(f.ports, f.workspaceId).claimNext("foreground"))?.id).toBe(continuedRun.id);
    await writeFile(join(transcriptDir, "reply.jsonl"), ["已经核对状态。", "已核对上次结果并完成剩余工作。"].map(text => JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text }] } })).join("\n") + "\n");
    await createRuns(f.ports, f.workspaceId).finish(continuedRun.id, { outcome: "finished", sessionId: null, error: null }, { stopEvidence: "provider_exited" });
    await conversations.poll();
    const completed = (await createAgentConversations(options).messages(sent.sessionId)).at(-1)!;
    expect(completed.execution).toMatchObject({ status: "finished", active: false, canContinue: false });
    expect(completed.text).toBe("已核对上次结果并完成剩余工作。");
    expect((await conversations.messages(sent.sessionId)).find(message => message.id === failed.id)?.execution?.status).toBe("failed");
    const context = await f.ports.db.session.findUniqueOrThrow({ where: { id: run.sessionId! } });
    expect(context.moduleId).toBe(web.id);
    expect(await f.ports.db.moduleInvocation.count({ where: { target: "chat", tool: "send" } })).toBe(0);
  } finally { await f.close(); }
}, 30000);
