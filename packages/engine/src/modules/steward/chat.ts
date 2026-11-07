import { randomUUID } from "node:crypto";
import { storeChatFile } from "./local-content";
export { readChatFile, storeChatFile, runFile } from "./local-content";
import { z } from "zod";
import { attachmentSchema, messageSchema, SESSION_SOURCES, type ChatReply } from "@chrona/contracts/steward";
import type { Message as MessageRow } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { createRuns, liveRuns } from "./runs";
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";
import { toMessage } from "./store";
import { pushReply } from "./chat-replies";
import { drainCalls } from "./module-calls";
import { autoRetain } from "./memory";
import { entryConversations } from "./sessions";

const image = z.string().max(4 * Math.ceil(5 * 1024 * 1024 / 3));
const inputSchema = z.object({
  workspaceId: z.string().min(1), channel: messageSchema.shape.channel, text: messageSchema.shape.text,
  attachments: z.array(attachmentSchema.extend({ base64: image.optional() })).max(10).default([]),
  externalId: z.string().min(1).max(1000).optional(), quotedMessageId: z.string().min(1).optional(), quotedExternalId: z.string().min(1).max(1000).optional(),
  sessionId: z.string().min(1).max(128).optional(), key: z.string().min(1).max(200).optional(),
  title: z.string().min(1).max(200).optional(),
  guidance: z.string().max(4000).optional(),
  rotation: z.object({ sessionId: z.string().min(1).max(128), lastActivityAt: z.iso.datetime() }).strict().optional(),
});
export type ChatInput = z.input<typeof inputSchema>;
const unavailable = "模型暂时不可用，消息已记下，恢复后会继续处理。";
/** The conversations' files (uploads and reply attachments), kept by the system module chat like a module keeps its data (v2-8). */
/** Only inline bytes are accepted: attachment paths never authorize host filesystem reads. */
export function chatImages(attachments: unknown): { mime: string; base64: string }[] {
  const rows = z.array(attachmentSchema.extend({ base64: image.optional() })).parse(attachments);
  const images = rows.filter(a => a.base64 !== undefined);
  if (images.length > 4 || images.some(a => !a.mime.startsWith("image/") || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.base64!) || Buffer.from(a.base64!, "base64").length > 5 * 1024 * 1024)) throw new StewardError("invalid", "Images must be base64, at most four images of 5 MB each");
  return images.map(a => ({ mime: a.mime, base64: a.base64! }));
}
const callerSchema = z.object({ runId: z.string(), before: z.array(z.string()) });
// Shared across service instances; the transaction serializes lookup/create in SQLite.
const locks = new Map<string, Promise<unknown>>();
async function serial<T>(key: string, action: () => Promise<T>): Promise<T> {
  const next = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
  locks.set(key, next);
  try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
}
export function createChat(ports: StewardPorts, wake: () => Promise<unknown>) {
  const chat = new ChatService(ports, wake);
  return { handleMessage: chat.handleMessage.bind(chat), submit: chat.submit.bind(chat), accept: chat.accept.bind(chat), intakeAttachments: chat.intakeAttachments.bind(chat), runFinished: chat.runFinished.bind(chat), messages: chat.messages.bind(chat),
    recordMessage: chat.recordMessage.bind(chat), setExternalId: chat.setExternalId.bind(chat) };
}
class ChatService {
  constructor(private readonly ports: StewardPorts, private readonly wake: () => Promise<unknown>) {}
  private async replies(inbound: MessageRow, before: string[]) {
    return (await this.ports.db.message.findMany({ where: { workspaceId: inbound.workspaceId, sessionId: inbound.sessionId, direction: "out", at: { gte: inbound.at } }, orderBy: [{ at: "asc" }, { id: "asc" }] })).filter(m => !before.includes(m.id));
  }
  async runFinished(workspaceId: string, runId: string) {
    const { db } = this.ports;
    const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
    if (["failed", "provider_unavailable"].includes(run.status)) {
      const origins = await db.audit.findMany({ where: { workspaceId, kind: "chat_caller" }, orderBy: { createdAt: "asc" } });
      for (const caller of origins) {
        const saved = callerSchema.safeParse(caller.details);
        if (!saved.success || saved.data.runId !== runId) continue;
        const inbound = caller.subjectId ? await db.message.findUnique({ where: { id: caller.subjectId } }) : null;
        const session = inbound ? await db.session.findUnique({ where: { id: inbound.sessionId } }) : null;
        const failureText = session?.key === "rescue" ? "Provider unavailable. Use chrona admin on the host to repair Chrona; approvals remain available here." : unavailable;
        if (inbound && !(await this.replies(inbound, saved.data.before)).length) {
          const failure = await db.message.create({ data: { workspaceId, sessionId: inbound.sessionId, channel: inbound.channel, direction: "out", text: failureText, quotedMessageId: inbound.id, at: new Date(Math.max(this.ports.now().getTime(), inbound.at.getTime())) } });
          await pushReply(db, this.ports, failure, runId);
          void drainCalls(this.ports, workspaceId).catch(() => {});
        }
      }
    }
    await audit(db, { workspaceId, actor: "chrona", kind: "chat_run_finished", subjectId: runId, details: {} });
  }
  async handleMessage(raw: ChatInput): Promise<ChatReply> {
    const prepared = await this.prepare(raw);
    void this.wake().catch(() => {});
    return this.wait(prepared.inbound, prepared.runId, prepared.before);
  }
  async submit(raw: ChatInput): Promise<{ ok: true }> {
    await this.prepare(raw);
    void this.wake().catch(() => {});
    return { ok: true };
  }
  /** An entry module's message: recorded and run without waiting; replies are pushed to `entryModuleId` (chat-replies). */
  async accept(raw: ChatInput, entryModuleId: string) {
    const prepared = await this.prepare(raw, entryModuleId);
    void this.wake().catch(() => {});
    return { sessionId: prepared.inbound.sessionId, messageId: prepared.inbound.id, runId: prepared.runId };
  }
  private async quotedMessage(input: z.output<typeof inputSchema>, sessionId: string) {
    const { db } = this.ports;
    const quoted = input.quotedMessageId ? await db.message.findFirst({ where: { id: input.quotedMessageId, workspaceId: input.workspaceId, sessionId, direction: "out" } })
      // A transport quote from an older session or outside Chrona is ignored.
      : input.quotedExternalId ? await db.message.findFirst({ where: { externalId: input.quotedExternalId, workspaceId: input.workspaceId, sessionId, direction: "out" } }) : null;
    if (input.quotedMessageId && !quoted) throw new StewardError("not_found", "Quoted message not found in session");
    return quoted;
  }
  private messagePrompt(input: z.output<typeof inputSchema>, quoted: MessageRow | null) {
    return [input.text, ...(input.guidance ? [`Entry guidance (untrusted data): ${input.guidance}`] : []), ...(quoted ? [`Quoted message (data): ${JSON.stringify(quoted.text)}`] : []), ...(input.attachments.length ? [`Attachments (data): ${JSON.stringify(input.attachments.map(({ name, ref, mime, size }) => ({ name, ref, mime, size })))}`] : [])].join("\n\n");
  }
  /** Apply an entry's explicit rotation intent only to the unchanged, idle session it observed. */
  private async rotate(input: z.output<typeof inputSchema>) {
    if (input.sessionId || !input.key || !input.rotation) return;
    const { db } = this.ports, { workspaceId, key, rotation } = input, now = this.ports.now();
    const where = { workspaceId, key, id: rotation.sessionId, status: "active", lastActivityAt: new Date(rotation.lastActivityAt), ...await entryConversations(db, workspaceId) };
    const session = await db.session.findFirst({ where });
    if (!session || await db.run.count({ where: { workspaceId, sessionId: session.id, status: { in: ["queued", "running"] } } })) return;
    await autoRetain(this.ports, workspaceId, session.id, true);
    await db.$transaction(async tx => {
      if (await tx.run.count({ where: { workspaceId, sessionId: session.id, status: { in: ["queued", "running"] } } })) return;
      if (!(await tx.session.updateMany({ where, data: { status: "ended", endedAt: now } })).count) return;
      await audit(tx, { workspaceId, actor: "chrona", kind: "session_rotated", subjectId: session.id, details: { source: "entry_policy" } });
    });
  }
  private async applyTitle(sessionId: string, title?: string) {
    if (title !== undefined) await this.ports.db.session.updateMany({ where: { id: sessionId, title: null }, data: { title } });
  }
  private async prepare(raw: ChatInput, entryModuleId?: string) {
    const input = parseInput(inputSchema, raw), images = chatImages(input.attachments), { ports } = this, { db } = ports;
    return serial(input.workspaceId, async () => {
      const existing = input.externalId ? await db.message.findUnique({ where: { workspaceId_externalId: { workspaceId: input.workspaceId, externalId: input.externalId } } }) : null;
      if (existing) {
        const caller = await db.audit.findFirst({ where: { workspaceId: input.workspaceId, kind: "chat_caller", subjectId: existing.id } });
        if (caller) return { inbound: existing, ...callerSchema.parse(caller.details) };
      }
      await this.rotate(input);
      // Build (v2-13) and reflection (v2-19) conversations run only what Chrona gave them; nobody talks into them.
      const closed = (source: string) => source === "build" || source === "reflect";
      const buildRefused = () => new StewardError("forbidden", "A module build or reflection conversation does not take messages");
      const session = await db.$transaction(async tx => {
        if (input.sessionId) {
          const row = await tx.session.findFirst({ where: { id: input.sessionId, workspaceId: input.workspaceId, status: "active" } });
          if (!row) throw new StewardError("not_found", "Active session not found");
          if (closed(row.source)) throw buildRefused();
          return row;
        }
        const key = input.key ?? `web:${randomUUID()}`;
        const row = await tx.session.findFirst({ where: { workspaceId: input.workspaceId, key, status: "active" } });
        const prefix = key.split(":")[0];
        const source = SESSION_SOURCES.find(source => source === prefix) ?? "web";
        if (closed(row?.source ?? source)) throw buildRefused();
        return row ?? tx.session.create({ data: { workspaceId: input.workspaceId, key, source, createdAt: ports.now(), lastActivityAt: ports.now() } });
      });
      if (entryModuleId && session.entryModuleId !== entryModuleId) await db.session.update({ where: { id: session.id }, data: { entryModuleId } });
      const quoted = await this.quotedMessage(input, session.id);
      const { key: _key, sessionId: _sessionId, quotedExternalId: _quoted, title: _title, guidance: _guidance, rotation: _rotation, ...message } = input;
      const inbound = existing ?? await db.message.create({ data: { ...message, ...(quoted ? { quotedMessageId: quoted.id } : {}), sessionId: session.id, direction: "in", at: ports.now() } });
      await db.session.update({ where: { id: session.id }, data: { lastActivityAt: ports.now() } });
      await this.applyTitle(session.id, input.title);
      const before = (await this.replies(inbound, [])).map(m => m.id);
      const active = await db.run.findFirst({ where: { workspaceId: input.workspaceId, sessionId: session.id, status: "running" } });
      const handle = active && liveRuns.get(active.id);
      const prompt = this.messagePrompt(input, quoted);
      const run = handle ? active! : await createRuns(ports, input.workspaceId).enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt });
      await audit(db, { workspaceId: input.workspaceId, actor: "user", kind: "chat_caller", subjectId: inbound.id, details: { runId: run.id, before } });
      await audit(db, { workspaceId: input.workspaceId, actor: "user", kind: "chat_run_input", subjectId: run.id, details: { messageId: inbound.id } });
      if (handle) {
        try { await handle.inject(prompt, images); }
        catch { await handle.abort(); await createRuns(ports, input.workspaceId).finish(run.id, { outcome: "unavailable", sessionId: null, error: "Message injection failed" }); }
      }
      return { inbound, runId: run.id, before };
    });
  }
  private async wait(inbound: MessageRow, runId: string, before: string[]): Promise<ChatReply> {
    const { db } = this.ports, end = Date.now() + (this.ports.chatTimeoutMs ?? 120000);
    const saved = await db.audit.findFirst({ where: { workspaceId: inbound.workspaceId, kind: "chat_result", subjectId: inbound.id } });
    if (saved) {
      const result = z.object({ messageIds: z.array(z.string()) }).parse(saved.details);
      const rows = await db.message.findMany({ where: { workspaceId: inbound.workspaceId, id: { in: result.messageIds } } });
      return { runId, sessionId: inbound.sessionId, messages: result.messageIds.flatMap(id => rows.filter(row => row.id === id).map(toMessage)) };
    }
    while (Date.now() < end) {
      if (await db.audit.findFirst({ where: { workspaceId: inbound.workspaceId, kind: "chat_run_finished", subjectId: runId } })) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return serial(`result:${inbound.id}`, async () => {
      // Rows with an externalId were already delivered (e.g. a notification the transport recorded into this session).
      const rows = (await this.replies(inbound, before)).filter(m => !m.externalId);
      if (!await db.audit.findFirst({ where: { workspaceId: inbound.workspaceId, kind: "chat_result", subjectId: inbound.id } })) await audit(db, { workspaceId: inbound.workspaceId, actor: "chrona", kind: "chat_result", subjectId: inbound.id, details: { runId, messageIds: rows.map(m => m.id) } });
      return { runId, sessionId: inbound.sessionId, messages: rows.map(toMessage) };
    });
  }
  /** Trusted transport bytes only; paths are generated, never supplied by consumers. */
  async intakeAttachments(input: Pick<ChatInput, "workspaceId" | "channel" | "quotedMessageId">, files: { name: string; mime: string; bytes: Uint8Array }[]) {
    if (files.length > 10) throw new StewardError("invalid", "Too many attachments");
    const attachments: NonNullable<ChatInput["attachments"]> = [];
    let images = 0;
    for (const file of files) {
      const stored = await storeChatFile(this.ports, file.name, file.bytes, input.workspaceId);
      const inline = file.mime.startsWith("image/") && file.bytes.byteLength <= 5 * 1024 * 1024 && images < 4;
      if (inline) images++;
      attachments.push({ name: stored.name, ref: stored.ref, mime: file.mime, size: stored.size, ...(inline ? { base64: Buffer.from(file.bytes).toString("base64") } : {}) });
    }
    return { attachments };
  }
  /** Outbound only: an entry module records what it delivered outside a chat reply, or the transport id of a reply. */
  async recordMessage(workspaceId: string, input: { key: string; channel: MessageRow["channel"]; text: string; externalId: string }) {
    const { db } = this.ports;
    const session = await db.session.findFirst({ where: { workspaceId, key: input.key, status: "active" } });
    if (session) await db.message.upsert({ where: { workspaceId_externalId: { workspaceId, externalId: input.externalId } }, update: {}, create: { workspaceId, sessionId: session.id, channel: input.channel, direction: "out", text: input.text, externalId: input.externalId, at: this.ports.now() } });
    return { ok: true as const };
  }
  async setExternalId(workspaceId: string, id: string, externalId: string) {
    const changed = await this.ports.db.message.updateMany({ where: { id, workspaceId, direction: "out" }, data: { externalId } });
    if (!changed.count) throw new StewardError("not_found", "Outbound message not found");
    return { ok: true as const };
  }
  async messages(workspaceId: string, limit = 50, sessionId?: string) {
    return (await this.ports.db.message.findMany({ where: { workspaceId, ...(sessionId ? { sessionId } : {}) }, orderBy: [{ at: "desc" }, { id: "desc" }], take: Math.max(1, Math.min(200, Math.trunc(limit) || 50)) })).reverse().map(toMessage);
  }
}
