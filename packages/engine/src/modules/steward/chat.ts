import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { attachmentSchema, messageSchema, SESSION_SOURCES, type ChatReply } from "@chrona/contracts/steward";
import type { Message as MessageRow } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { createRuns, liveRuns } from "./runs";
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";
import { toMessage } from "./store";

const image = z.string().max(4 * Math.ceil(5 * 1024 * 1024 / 3));
const inputSchema = z.object({
  workspaceId: z.string().min(1), channel: messageSchema.shape.channel, text: messageSchema.shape.text,
  attachments: z.array(attachmentSchema.extend({ base64: image.optional() })).max(10).default([]),
  externalId: z.string().min(1).max(1000).optional(), quotedMessageId: z.string().min(1).optional(), quotedExternalId: z.string().min(1).max(1000).optional(),
  sessionId: z.string().min(1).max(128).optional(), key: z.string().min(1).max(200).optional(),
});
export type ChatInput = z.input<typeof inputSchema>;
const unavailable = "模型暂时不可用，消息已记下，恢复后会继续处理。";
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
  return { handleMessage: chat.handleMessage.bind(chat), submit: chat.submit.bind(chat), intakeAttachments: chat.intakeAttachments.bind(chat), runFinished: chat.runFinished.bind(chat), messages: chat.messages.bind(chat),
    runReplies: chat.runReplies.bind(chat), recordMessage: chat.recordMessage.bind(chat), setExternalId: chat.setExternalId.bind(chat) };
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
      const callers = await db.audit.findMany({ where: { workspaceId, kind: "chat_caller" }, orderBy: { createdAt: "asc" } });
      for (const caller of callers) {
        const saved = callerSchema.safeParse(caller.details);
        if (!saved.success || saved.data.runId !== runId) continue;
        const inbound = caller.subjectId ? await db.message.findUnique({ where: { id: caller.subjectId } }) : null;
        const session = inbound ? await db.session.findUnique({ where: { id: inbound.sessionId } }) : null;
        const failureText = session?.key === "rescue" ? "Provider unavailable. Use chrona admin on the host to repair Chrona; approvals remain available here." : unavailable;
        if (inbound && !(await this.replies(inbound, saved.data.before)).length) await db.message.create({ data: { workspaceId, sessionId: inbound.sessionId, channel: inbound.channel, direction: "out", text: failureText, quotedMessageId: inbound.id, at: new Date(Math.max(this.ports.now().getTime(), inbound.at.getTime())) } });
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
  private async prepare(raw: ChatInput) {
    const input = parseInput(inputSchema, raw), images = chatImages(input.attachments), { ports } = this, { db } = ports;
    return serial(input.workspaceId, async () => {
      const existing = input.externalId ? await db.message.findUnique({ where: { workspaceId_externalId: { workspaceId: input.workspaceId, externalId: input.externalId } } }) : null;
      if (existing) {
        const caller = await db.audit.findFirst({ where: { workspaceId: input.workspaceId, kind: "chat_caller", subjectId: existing.id } });
        if (caller) return { inbound: existing, ...callerSchema.parse(caller.details) };
      }
      const session = await db.$transaction(async tx => {
        if (input.sessionId) {
          const row = await tx.session.findFirst({ where: { id: input.sessionId, workspaceId: input.workspaceId, status: "active" } });
          if (!row) throw new StewardError("not_found", "Active session not found");
          return row;
        }
        const key = input.key ?? `web:${randomUUID()}`;
        const row = await tx.session.findFirst({ where: { workspaceId: input.workspaceId, key, status: "active" } });
        const prefix = key.split(":")[0];
        const source = SESSION_SOURCES.find(source => source === prefix) ?? "web";
        return row ?? tx.session.create({ data: { workspaceId: input.workspaceId, key, source, createdAt: ports.now(), lastActivityAt: ports.now() } });
      });
      const quoted = input.quotedMessageId ? await db.message.findFirst({ where: { id: input.quotedMessageId, workspaceId: input.workspaceId, sessionId: session.id, direction: "out" } })
        // A transport quote of something Chrona never recorded (or from an older session) is just ignored.
        : input.quotedExternalId ? await db.message.findFirst({ where: { externalId: input.quotedExternalId, workspaceId: input.workspaceId, sessionId: session.id, direction: "out" } }) : null;
      if (input.quotedMessageId && !quoted) throw new StewardError("not_found", "Quoted message not found in session");
      const { key: _key, sessionId: _sessionId, quotedExternalId: _quoted, ...message } = input;
      const inbound = existing ?? await db.message.create({ data: { ...message, ...(quoted ? { quotedMessageId: quoted.id } : {}), sessionId: session.id, direction: "in", at: ports.now() } });
      await db.session.update({ where: { id: session.id }, data: { lastActivityAt: ports.now() } });
      const before = (await this.replies(inbound, [])).map(m => m.id);
      const active = await db.run.findFirst({ where: { workspaceId: input.workspaceId, sessionId: session.id, status: "running" } });
      const handle = active && liveRuns.get(active.id);
      const prompt = [input.text, ...(quoted ? [`Quoted message (data): ${JSON.stringify(quoted.text)}`] : []), ...(input.attachments.length ? [`Attachments (data): ${JSON.stringify(input.attachments.map(({ name, ref, mime, size }) => ({ name, ref, mime, size })))}`] : [])].join("\n\n");
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
  /** Trusted transport bytes only; paths are generated, never supplied by callers. */
  async intakeAttachments(input: Pick<ChatInput, "workspaceId" | "channel" | "quotedMessageId">, files: { name: string; mime: string; bytes: Uint8Array }[]) {
    if (files.length > 10) throw new StewardError("invalid", "Too many attachments");
    const module = await this.ports.db.module.findFirst({ where: { workspaceId: input.workspaceId, name: "files", status: "active" } });
    if (!module) throw new StewardError("not_found", "Files module not found");
    const directory = join(this.ports.dataDir, "platform", "content", module.id, "uploads");
    await mkdir(directory, { recursive: true });
    const attachments: NonNullable<ChatInput["attachments"]> = [];
    let images = 0;
    for (const file of files) {
      const name = file.name.normalize("NFKC").replaceAll("\\", "/").split("/").pop()!.replace(/[^\p{L}\p{N}._-]/gu, "_").replace(/^\.+/, "").slice(0, 180) || "attachment";
      const unique = `${randomUUID()}-${name}`;
      await writeFile(join(directory, unique), file.bytes, { flag: "wx" });
      const inline = file.mime.startsWith("image/") && file.bytes.byteLength <= 5 * 1024 * 1024 && images < 4;
      if (inline) images++;
      attachments.push({ name, ref: `files/uploads/${unique}`, mime: file.mime, size: file.bytes.byteLength, ...(inline ? { base64: Buffer.from(file.bytes).toString("base64") } : {}) });
    }
    return { attachments };
  }
  /** Replies a run has sent so far that no transport has delivered yet (entry modules relay ones arriving after the chat call returned). */
  async runReplies(workspaceId: string, runId: string) {
    const { db } = this.ports;
    const run = await db.run.findFirst({ where: { id: runId, workspaceId }, select: { status: true } });
    if (!run) throw new StewardError("not_found", "Run not found");
    const ids = (await db.audit.findMany({ where: { workspaceId, kind: "run_reply", subjectId: runId }, orderBy: { createdAt: "asc" } }))
      .flatMap(row => { const id = (row.details as { messageId?: unknown } | null)?.messageId; return typeof id === "string" ? [id] : []; });
    const rows = await db.message.findMany({ where: { id: { in: ids }, workspaceId, externalId: null }, orderBy: [{ at: "asc" }, { id: "asc" }] });
    return { done: !["queued", "running"].includes(run.status), items: rows.map(toMessage) };
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
