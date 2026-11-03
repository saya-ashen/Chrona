import { z } from "zod";
import * as outputs from "../system-outputs";
import { attachmentSchema, providerAnswerSchema, DELIVERY_CHANNELS, SESSION_SOURCES, SESSION_STATUSES } from "@chrona/contracts/steward";
import { createChat, readChatFile } from "../chat";
import { createSessions } from "../sessions";
import { workspaceToday } from "../today";
import { createProviderControl } from "../provider-channel";
import { sessionSettings } from "../settings";
import { CallError, type Json, type SystemModule } from "../module-calls";
import { buildQueue, buildQueueText } from "../build-queue";
import { sessionTranscript } from "../transcript";
import { parseInput } from "../errors";
import { storedAttachments } from "../store";
import { tool, text, entry, json, parsed, usesAll } from "./shared";

/** `chat`: the conversation service for entry modules (qq). Replies come back as `<entry>.reply` calls (chat-replies). */
export const chat: SystemModule = {
  name: "chat",
  description: "对话：网页、QQ、MCP 把你的消息交给 Chrona，回复推回原入口。",
  settings: {
    declarations: {
      idleMinutes: { type: "number", label: "闲置多久后换新对话（分钟）", description: "QQ 与网页对话闲置超过此时长且内容较多时，下一条消息开始新对话（先写入记忆）。模型缓存约 1 小时过期，过期后继续长对话需全价重读。", default: 60, min: 5, max: 1440 },
      minContextTokens: { type: "number", label: "闲置换新的最小上下文（token）", description: "上下文低于此值时闲置也不换新，保留连续性。", default: 30000, min: 0, max: 1000000 },
      maxContextTokens: { type: "number", label: "上下文上限（token）", description: "超过此值时无论是否闲置，下一条消息都开始新对话。", default: 100000, min: 10000, max: 1000000 },
    },
    read: settings => sessionSettings(settings),
    write: values => ({ sessions: values }),
  },
  tools: [
    tool("send", "Record the user's message in a conversation and run it; returns at once, replies are pushed to the calling module's reply tool.",
      { key: text("Conversation key, e.g. qq:dm"), text: text(), channel: { type: "string", enum: [...DELIVERY_CHANNELS] }, "external-id": text("Transport message id (deduplicates redelivery)"),
        "quoted-external-id": text("Transport id of the quoted message"), attachments: text("JSON array of attachments from chat.attach") }, ["key", "text", "channel"], { output: z.lazy(() => outputs.chatSendOutput) }),
    tool("attach", "Store one received file (base64, at most 20 MiB) and return an attachment for chat.send.", { name: text(), mime: text(), base64: text() }, ["name", "mime", "base64"], { output: z.lazy(() => outputs.chatAttachOutput) }),
    tool("new-session", "End the active conversation for a key; the next message starts a new one.", { key: text() }, ["key"], { idempotent: true, output: z.lazy(() => outputs.chatSessionOutput) }),
    tool("file", "Bytes (base64) of a file attached to a message in one of the caller's conversations.", { message: text("Message id"), ref: text("Attachment ref chat/<file>") }, ["message", "ref"], { idempotent: true, output: z.lazy(() => outputs.chatFileOutput) }),
    tool("delivered", "Record the transport id of a reply the caller delivered (for quotes).", { message: text(), "external-id": text() }, ["message", "external-id"], { idempotent: true, output: z.lazy(() => outputs.okOutput) }),
    tool("record", "Record a message the caller delivered outside a reply (e.g. a notification) into its conversation.", { key: text(), channel: { type: "string", enum: [...DELIVERY_CHANNELS] }, text: text(), "external-id": text() }, ["key", "channel", "text", "external-id"], { idempotent: true, output: z.lazy(() => outputs.okOutput) }),
    // Request/response entries (MCP): the conversation gets no entry module, so nothing is pushed and background results are notified.
    tool("ask", "Send the user's message by session or key (without either, a new conversation) and wait for this run's replies.", { text: text(), session: text("Session id"), key: text("Conversation key") }, ["text"], { output: z.lazy(() => outputs.chatAskOutput) }),
    tool("sessions", "The user's conversations, most recent first.", { source: { type: "string", enum: [...SESSION_SOURCES] }, status: { type: "string", enum: [...SESSION_STATUSES] } }, [], { idempotent: true, output: z.lazy(() => outputs.chatSessionsOutput) }),
    tool("session", "One conversation.", { session: text() }, ["session"], { idempotent: true, output: z.lazy(() => outputs.chatSessionOutput) }),
    tool("session-update", "Rename or end a conversation.", { session: text(), title: text(), status: { type: "string", enum: ["ended"] } }, ["session"], { idempotent: true, output: z.lazy(() => outputs.chatSessionOutput) }),
    tool("today", "The user's overview: approvals waiting, the next 7 days of schedules, recent notifications, apps, recent conversations and health.", {}, [], { idempotent: true, output: z.lazy(() => outputs.chatTodayOutput) }),
    tool("messages", "A conversation's recent messages, oldest first.", { session: text(), limit: { type: "number", description: "1-200, default 50" } }, ["session"], { idempotent: true, output: z.lazy(() => outputs.chatMessagesOutput) }),
    tool("runs", "Recent Provider runs (progress, usage, questions waiting for the user), optionally of one conversation.", { session: text() }, [], { idempotent: true, output: z.lazy(() => outputs.chatRunsOutput) }),
    // v2-13: what the Provider did, for the user's own pages; only the entry modules that show it (not modules with uses "*").
    tool("transcript", "What the Provider did in a conversation: its text, tool calls and clipped results, credentials redacted.", { session: text() }, ["session"], { idempotent: true, output: z.lazy(() => outputs.chatTranscriptOutput) }),
    tool("answer", "Answer a question a running Provider asked the user.", { interaction: text(), answer: text('JSON {"decision":"submit","value":…} or {"decision":"cancel"}') }, ["interaction", "answer"], { output: z.lazy(() => outputs.okOutput) }),
    tool("cancel", "Stop a running Provider run.", { run: text() }, ["run"], { idempotent: true, output: z.lazy(() => outputs.okOutput) }),
  ],
  async handle({ ports, workspaceId, caller }, name, args) {
    const module = entry(caller), { db } = ports;
    const service = createChat(ports, async () => { await ports.onQueued?.(); });
    // Only conversations this module brings: another entry's conversation is not its to read or mark.
    const own = async (sessionId: string) => (await db.session.findFirst({ where: { id: sessionId, workspaceId } }))?.entryModuleId === module.moduleId;
    const handlers: Record<string, () => Promise<Json>> = {
      send: async () => {
        // Another entry's conversation is not this module's to speak in (or to take its replies).
        const session = await db.session.findFirst({ where: { workspaceId, key: String(args.key), status: "active" } });
        if (session?.entryModuleId && session.entryModuleId !== module.moduleId) throw new CallError("forbidden", "Conversation belongs to another entry");
        let raw: unknown = [];
        try { if (args.attachments !== undefined) raw = JSON.parse(String(args.attachments)); } catch { throw new CallError("invalid", "attachments must be a JSON array"); }
        const attachments = parseInput(z.array(attachmentSchema.extend({ base64: z.string().optional() })).max(10), raw);
        return json(await service.accept({ workspaceId, key: String(args.key), text: String(args.text), channel: args.channel as (typeof DELIVERY_CHANNELS)[number], attachments,
          ...(args["external-id"] ? { externalId: String(args["external-id"]) } : {}), ...(args["quoted-external-id"] ? { quotedExternalId: String(args["quoted-external-id"]) } : {}) }, module.moduleId));
      },
      attach: async () => {
        const base64 = String(args.base64);
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64) || base64.length > 28_000_000) throw new CallError("invalid", "Attachment must be base64, at most 20 MiB");
        const result = await service.intakeAttachments({ workspaceId, channel: "in_app" }, [{ name: String(args.name), mime: String(args.mime), bytes: Buffer.from(base64, "base64") }]);
        return json(result.attachments[0]);
      },
      "new-session": async () => json(await createSessions(ports, workspaceId).new({ key: String(args.key) })),
      ask: async () => json(await service.handleMessage({ workspaceId, channel: "in_app", text: String(args.text), ...(args.session ? { sessionId: String(args.session) } : {}), ...(args.key ? { key: String(args.key) } : {}) })),
      today: async () => json(await workspaceToday(ports, workspaceId).get()),
      sessions: async () => json(await createSessions(ports, workspaceId).list({ ...(args.source ? { source: args.source } : {}), ...(args.status ? { status: args.status } : {}) })),
      session: async () => json(await createSessions(ports, workspaceId).get(String(args.session))),
      "session-update": async () => json(await createSessions(ports, workspaceId).update(String(args.session), { ...(args.title !== undefined ? { title: args.title } : {}), ...(args.status !== undefined ? { status: args.status } : {}) })),
      messages: async () => json(await createSessions(ports, workspaceId).messages(String(args.session), args.limit ?? 50)),
      transcript: async () => {
        const session = await db.session.findFirst({ where: { id: String(args.session), workspaceId } });
        if (!session) throw new CallError("not_found", "Conversation not found");
        const items = await sessionTranscript(ports, session.id, session.source === "build" ? 299 : 300);
        if (session.source !== "build") return json(items);
        const latest = await db.run.findFirst({ where: { workspaceId, sessionId: session.id, lane: "build" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
        if (!latest) return json(items);
        const state = (await buildQueue(db, workspaceId)).get(session.id);
        const ended: Record<string, string> = { finished: "本轮运行已结束，提交版本仍按原审批流程处理", cancelled: "构建已停止，文件和历史保留", failed: "本轮运行失败，等待人工继续", timed_out: "本轮运行超时，等待人工继续", provider_unavailable: "模型服务不可用，等待人工继续" };
        const status = state ? buildQueueText(state) : ended[latest.status] ?? latest.status;
        const waiting = state?.status === "build_queued" ? "等待期间不调用模型、不计入单轮时限；修改需求会重新排到队尾。" : "";
        return json([{ at: ports.now().toISOString(), kind: "text", text: `Chrona 构建状态：${status}。${waiting}刷新页面可更新状态。` }, ...items]);
      },
      runs: async () => json(await createProviderControl(ports, workspaceId).list(args.session ? String(args.session) : undefined)),
      answer: async () => json(await createProviderControl(ports, workspaceId).answer(String(args.interaction), parseInput(providerAnswerSchema, parsed(args.answer, "answer")))),
      cancel: async () => json(await createProviderControl(ports, workspaceId).cancel(String(args.run))),
      file: async () => {
        const message = await db.message.findFirst({ where: { id: String(args.message), workspaceId } });
        const ref = parseInput(z.string().max(542), args.ref), files = storedAttachments(message?.attachments ?? []);
        // A page offering everything to the user (`uses: ["*"]`, the web) reads files of every conversation.
        if (!message || !(await own(message.sessionId) || await usesAll(db, module)) || !files.some(file => file.ref === ref)) throw new CallError("not_found", "No such file on a message of yours");
        const file = await readChatFile(ports, ref);
        if (!file) throw new CallError("not_found", "File not found");
        if (file.bytes.byteLength > 20 * 1024 * 1024) throw new CallError("invalid", "File larger than 20 MiB");
        return { base64: file.bytes.toString("base64"), mime: file.mime };
      },
      delivered: async () => {
        const message = await db.message.findFirst({ where: { id: String(args.message), workspaceId, direction: "out" } });
        if (!message || !await own(message.sessionId)) throw new CallError("not_found", "Reply not found");
        return json(await service.setExternalId(workspaceId, message.id, String(args["external-id"])));
      },
      record: async () => {
        const session = await db.session.findFirst({ where: { workspaceId, key: String(args.key), status: "active" } });
        if (session && !await own(session.id)) throw new CallError("forbidden", "Conversation belongs to another entry");
        return json(await service.recordMessage(workspaceId, { key: String(args.key), channel: args.channel as (typeof DELIVERY_CHANNELS)[number], text: String(args.text).slice(0, 8000), externalId: String(args["external-id"]) }));
      },
    };
    const handler = Object.hasOwn(handlers, name) ? handlers[name] : undefined;
    if (!handler) throw new CallError("not_found", `chat.${name} not found`);
    return handler();
  },
};
