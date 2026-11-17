import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { cp, readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema, type RoutedTarget } from "@chrona/contracts/steward";
import bridge from "../../pi/resources/chrona-tools";
import { agentFixture } from "../../../scripts/agent-integration/agent-application.fixtures";
import { callSync, kernelOrigin } from "./modules/module-calls";
import { createAgentConversations } from "../../../.generated/applications/web/agent-conversations";
import { createRuns } from "./execution/runs";
import { createTools } from "./tools";
import { moduleToolCatalog } from "./modules/module-tools";

test("attachment ownership uses the complete private journal, not the recent message window", async () => {
  const dataDir = await mkdtemp("/tmp/chrona-journal-attachment-");
  try {
    const file = { name: "old.png", ref: "web/attachments/old.png" };
    const first = { id: "old-message", direction: "in", text: "old", attachments: [file] };
    const messages = [first, ...Array.from({ length: 101 }, (_, index) => ({ id: `later-${index}`, direction: "in", text: "later", attachments: [] }))];
    await mkdir(join(dataDir, "conversations"));
    const journal = new Database(join(dataDir, "conversations/sessions.sqlite"));
    try {
      journal.exec("CREATE TABLE conversations(id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)))");
      journal.query("INSERT INTO conversations(id, data) VALUES (?, ?)").run("web-agent:journal", JSON.stringify({ id: "web-agent:journal", messages, turns: [] }));
    } finally { journal.close(); }
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
      const source = join(import.meta.dir, "../../../.generated/applications", name), hash = `web-agent-${name}`;
      const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(source, "module.json"), "utf8")));
      await cp(source, join(f.ports.dataDir, "platform/store", hash), { recursive: true });
      const module = await f.ports.db.module.update({ where: { workspaceId_name: { workspaceId: f.workspaceId, name } }, data: { activeHash: hash } });
      await f.ports.db.moduleVersion.create({ data: { moduleId: module.id, hash, source: "builtin", status: "approved", manifest, intent: {}, report: {} } });
    }
    f.ports.onQueued = () => new Promise(() => {});
    const web = await f.ports.db.module.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId: f.workspaceId, name: "web" } } });
    const caller = { kind: "module" as const, module: "web", moduleId: web.id, hash: web.activeHash! };
    let loseRunResponse = false;
    const call = async (target: string, args: Record<string, unknown> = {}, options: { key?: string } = {}) => {
      const output = (await callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller }, target, args, options)).output;
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
    await expect(conversations.interrupt(sent.runId!)).resolves.toMatchObject({ runId: sent.runId, status: "cancelled", active: false, stopConfirmed: true });
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

test("structural Author targets survive Web selection, frozen admission, Run catalog and Pi registration", async () => {
  const f = await agentFixture();
  try {
    await f.ports.db.run.delete({ where: { id: "agent-run" } });
    f.ports.onQueued = () => new Promise(() => {});
    for (const name of ["web", "author"]) {
      const hash = `tool-exposure-${name}`;
      const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(import.meta.dir, "../../../.generated/applications", name, "module.json"), "utf8")));
      const module = await f.ports.db.module.upsert({ where: { workspaceId_name: { workspaceId: f.workspaceId, name } },
        create: { workspaceId: f.workspaceId, name, status: "active", activeHash: hash }, update: { activeHash: hash } });
      await f.ports.db.moduleVersion.create({ data: { moduleId: module.id, hash, source: "user", status: "approved", manifest, intent: {}, report: {} } });
    }
    const web = await f.ports.db.module.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId: f.workspaceId, name: "web" } } });
    const author = await f.ports.db.module.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId: f.workspaceId, name: "author" } } });
    const version = await f.ports.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: author.id, hash: author.activeHash! } } });
    const manifest = moduleManifestSchema.parse(version.manifest);
    const authorTargets = manifest.tools.map(tool => ({ moduleId: author.id, tool: tool.name }));
    const caller = { kind: "module" as const, module: web.name, moduleId: web.id, hash: web.activeHash! };
    const requests: RoutedTarget[][] = [];
    const call = async (target: string, args: Record<string, unknown> = {}, options: { key?: string } = {}) => {
      if (target === "agent.run") requests.push(args.tools as RoutedTarget[]);
      return (await callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller }, target, args, options)).output;
    };
    const options = { dataDir: join(f.root, "exposure-web"), call, reply: () => {} };
    const conversations = createAgentConversations(options);
    const sent = await conversations.send({ text: "Inspect tool exposure offline", requestKey: "exposure" });
    expect(requests[0]).toEqual(expect.arrayContaining(authorTargets));
    expect(requests[0]!.filter(target => typeof target === "string" && target.startsWith("author."))).toEqual([]);
    const admission = await f.ports.db.agentRunAdmission.findUniqueOrThrow({ where: { runId: sent.runId! } });
    expect(admission).toMatchObject({ moduleId: web.id, hash: web.activeHash,
      targets: expect.arrayContaining(manifest.tools.map(tool => ({ target: `author.${tool.name}`, moduleId: author.id }))) });
    const runs = createRuns(f.ports, f.workspaceId), run = (await runs.claimNext("foreground"))!;
    expect(run.id).toBe(sent.runId!);
    const endpoint = createTools(f.ports), catalog = await endpoint.catalog(run.token);
    const authorNames = manifest.tools.map(tool => `m_author_${tool.name}`).sort();
    expect(catalog.filter(tool => tool.name.startsWith("m_author_")).map(tool => tool.name).sort()).toEqual(authorNames);
    expect(catalog.every(tool => "exposure" in tool && tool.exposure === "direct")).toBe(true);
    expect(catalog.some(tool => tool.name.startsWith("m_web_") || tool.name.startsWith("m_agent_"))).toBe(false);
    // An explicit Run selection changes its own exposure, not the workspace's deferred catalog.
    expect((await moduleToolCatalog(f.ports, { workspaceId: f.workspaceId, audience: "owner" }))
      .filter(tool => tool.name.startsWith("m_author_")).every(tool => tool.exposure === "deferred")).toBe(true);

    type Registered = Parameters<Parameters<typeof bridge>[0]["registerTool"]>[0];
    const registered: Registered[] = [];
    const originalFetch = globalThis.fetch, originalUrl = process.env.CHRONA_AGENT_URL, originalToken = process.env.CHRONA_AGENT_TOKEN;
    process.env.CHRONA_AGENT_URL = "http://127.0.0.1:1234/api/steward-agent"; process.env.CHRONA_AGENT_TOKEN = run.token;
    globalThis.fetch = (async () => Response.json({ tools: catalog.map(({ inputSchema, ...tool }) => ({ ...tool, parameters: inputSchema })) })) as unknown as typeof fetch;
    try { await bridge({ registerTool: tool => { registered.push(tool); } }); }
    finally {
      globalThis.fetch = originalFetch;
      if (originalUrl === undefined) delete process.env.CHRONA_AGENT_URL; else process.env.CHRONA_AGENT_URL = originalUrl;
      if (originalToken === undefined) delete process.env.CHRONA_AGENT_TOKEN; else process.env.CHRONA_AGENT_TOKEN = originalToken;
    }
    expect(registered.map(tool => tool.name)).toEqual(catalog.map(tool => tool.name));
    for (const name of ["m_author_import", "m_author_submit", "m_author_receipt"]) {
      expect(registered.find(tool => tool.name === name)).toMatchObject({ exposure: "direct", namespace: { name: "module_author" },
        parameters: manifest.tools.find(tool => `m_author_${tool.name}` === name)!.parameters });
    }
    await runs.finish(run.id, { outcome: "finished", sessionId: null, error: null }, { stopEvidence: "provider_exited" });

    const subset = createAgentConversations({ ...options, dataDir: join(f.root, "exposure-subset"), tools: [{ moduleId: author.id, tool: "receipt" }] });
    const selected = await subset.send({ text: "Only the explicitly selected receipt", requestKey: "subset" });
    const subsetRun = (await runs.claimNext("foreground"))!;
    expect(subsetRun.id).toBe(selected.runId!);
    expect((await endpoint.catalog(subsetRun.token)).map(tool => ({ name: tool.name, exposure: "exposure" in tool ? tool.exposure : undefined })))
      .toEqual([{ name: "m_author_receipt", exposure: "direct" }]);
    await expect(endpoint.call(subsetRun.token, "m_author_submit", { input: "{}" })).rejects.toMatchObject({ code: "forbidden" });
    await f.ports.db.moduleVersion.update({ where: { id: version.id }, data: { manifest: { ...manifest,
      tools: manifest.tools.map(tool => tool.name === "receipt" ? { ...tool, parameters: { type: "object", properties: {} } } : tool) } } });
    expect((await endpoint.catalog(subsetRun.token)).map(tool => ({ name: tool.name, exposure: "exposure" in tool ? tool.exposure : undefined })))
      .toEqual([{ name: "m_author_receipt", exposure: "direct" }]);
    await f.ports.db.moduleVersion.update({ where: { id: version.id }, data: { manifest } });
    await f.ports.db.module.update({ where: { id: web.id }, data: { activeHash: "caller-replaced" } });
    await expect(endpoint.catalog(subsetRun.token)).rejects.toMatchObject({ code: "forbidden" });
    expect(await f.ports.db.moduleInvocation.count({ where: { target: "author" } })).toBe(0);
  } finally { await f.close(); }
}, 30000);
