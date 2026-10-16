import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { createWorkspaceFs } from "./workspace-fs";
import { z } from "zod";
import { attachmentSchema, messageSchema, type ChatReply } from "@chrona/contracts/steward";
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
  externalId: z.string().min(1).max(1000).optional(), quotedMessageId: z.string().min(1).optional(),
  affairId: z.string().min(1).max(128).optional(),
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

export function createChat(ports: StewardPorts, wake: () => Promise<unknown>) {
  const chat = new ChatService(ports, wake);
  return { handleMessage: chat.handleMessage.bind(chat), intakeAttachments: chat.intakeAttachments.bind(chat), runFinished: chat.runFinished.bind(chat), messages: chat.messages.bind(chat) };
}

class ChatService {
  private readonly events = new EventEmitter();
  private readonly locks = new Map<string, Promise<unknown>>();
  constructor(private readonly ports: StewardPorts, private readonly wake: () => Promise<unknown>) {
    this.events.setMaxListeners(0);
  }
  private async serial<T>(key: string, action: () => Promise<T>): Promise<T> {
    const { locks } = this;
    const previous = locks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    locks.set(key, next);
    try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
  }
  private async replies(inbound: MessageRow, before: string[]) {
    const { db } = this.ports;
    return (await db.message.findMany({ where: { workspaceId: inbound.workspaceId, conversationKey: inbound.conversationKey, direction: "out", at: { gte: inbound.at } }, orderBy: [{ at: "asc" }, { id: "asc" }] })).filter(m => !before.includes(m.id));
  }
  // Called after run finalization, including when no HTTP caller remains attached.
  async runFinished(workspaceId: string, runId: string) {
    const { ports, events } = this, { db } = ports;
    const replies = this.replies.bind(this);
    const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
    if (["failed", "provider_unavailable"].includes(run.status)) {
      const callers = await db.audit.findMany({ where: { workspaceId, kind: "chat_caller" }, orderBy: { createdAt: "asc" } });
      const caller = callers.find(a => callerSchema.safeParse(a.details).data?.runId === runId);
      const inbound = caller?.subjectId ? await db.message.findUnique({ where: { id: caller.subjectId } }) : null;
      if (inbound && !(await replies(inbound, callerSchema.parse(caller!.details).before)).length) {
        await db.message.create({ data: { workspaceId, conversationKey: inbound.conversationKey, channel: inbound.channel, direction: "out", text: unavailable, quotedMessageId: inbound.id, affairId: run.affairId, at: new Date(Math.max(ports.now().getTime(), inbound.at.getTime())) } });
      }
    }
    await audit(db, { workspaceId, actor: "chrona", kind: "chat_run_finished", subjectId: runId, details: {} });
    events.emit(runId);
  }
  async handleMessage(raw: ChatInput): Promise<ChatReply> {
    const input = parseInput(inputSchema, raw), images = chatImages(input.attachments);
    const conversationKey = `chat:${input.channel}`;
    const prepared = await this.serial(`${input.workspaceId}:${conversationKey}`, () => this.prepareMessage(input, images, conversationKey));
    if ("result" in prepared) return prepared.result!;
    if ("waiting" in prepared) return prepared.waiting!;
    return this.wait(prepared.inbound, prepared.runId, prepared.before);
  }
  private async previousResult(input: z.output<typeof inputSchema>, existing: MessageRow) {
    const { db } = this.ports;
    const saved = await db.audit.findFirst({ where: { workspaceId: input.workspaceId, kind: "chat_result", subjectId: existing.id } });
    if (saved) {
      const result = z.object({ runId: z.string(), messageIds: z.array(z.string()) }).parse(saved.details);
      const rows = await db.message.findMany({ where: { workspaceId: input.workspaceId, id: { in: result.messageIds } } });
      return { result: { runId: result.runId, messages: result.messageIds.flatMap(id => rows.filter(r => r.id === id).map(toMessage)) } };
    }
    const caller = await db.audit.findFirst({ where: { workspaceId: input.workspaceId, kind: "chat_caller", subjectId: existing.id } });
    if (caller) return { inbound: existing, ...callerSchema.parse(caller.details) };
    return null;
  }
  private async messageContext(input: z.output<typeof inputSchema>, conversationKey: string) {
    const { db } = this.ports;
    const quoted = input.quotedMessageId ? await db.message.findFirst({ where: { id: input.quotedMessageId, workspaceId: input.workspaceId, direction: "out" } }) : null;
    if (input.quotedMessageId && !quoted) throw new StewardError("not_found", "Quoted message not found");
    const focus = await db.audit.findFirst({ where: { workspaceId: input.workspaceId, kind: "conversation_focus", subjectId: conversationKey }, orderBy: { createdAt: "desc" } });
    const focusedId = input.affairId ?? (quoted ? quoted.affairId : z.object({ affairId: z.string() }).safeParse(focus?.details).data?.affairId);
    const affair = focusedId ? await db.affair.findFirst({ where: { id: focusedId, workspaceId: input.workspaceId, status: "active" } }) : null;
    if (input.affairId && !affair) throw new StewardError("not_found", "Active affair not found");
    return { quoted, affair };
  }
  private async prepareMessage(input: z.output<typeof inputSchema>, images: ReturnType<typeof chatImages>, conversationKey: string) {
    const { ports, wake } = this, { db } = ports;
    const existing = input.externalId ? await db.message.findUnique({ where: { workspaceId_externalId: { workspaceId: input.workspaceId, externalId: input.externalId } } }) : null;
    if (existing) {
      const previous = await this.previousResult(input, existing);
      if (previous) return previous;
    }
    const { quoted, affair } = await this.messageContext(input, conversationKey);
    const inbound = existing ?? await db.message.create({ data: { ...input, attachments: input.attachments, conversationKey, affairId: affair?.id, direction: "in", at: ports.now() } });
    // Timestamp ties are common with fake clocks and SQLite; explicitly exclude existing replies.
    const before = (await db.message.findMany({ where: { workspaceId: input.workspaceId, conversationKey, direction: "out", at: { gte: inbound.at } }, select: { id: true } })).map(m => m.id);
    const active = await db.run.findFirst({ where: { workspaceId: input.workspaceId, conversationKey, lane: "foreground", status: "running" } });
    // A quote changing affairs must queue in the correct cwd, not steer a different affair.
    const handle = this.injectionHandle(active, quoted, affair);
    const prompt = this.messagePrompt(input, quoted);
    await this.forwardToBackground({ workspaceId: input.workspaceId, affair, active, messageId: inbound.id, prompt, images });
    const run = handle ? active! : await createRuns(ports, input.workspaceId).enqueue({ lane: "foreground", trigger: "message", conversationKey, prompt, ...(affair ? { affairId: affair.id } : {}) });
    await audit(db, { workspaceId: input.workspaceId, actor: "user", kind: "chat_caller", subjectId: inbound.id, details: { runId: run.id, before } });
    if (!handle) await audit(db, { workspaceId: input.workspaceId, actor: "user", kind: "chat_run_input", subjectId: run.id, details: { messageId: inbound.id } });
    // Subscribe before injection/launch: scripted providers can finish immediately.
    const waiting = this.wait(inbound, run.id, before);
    if (handle) {
      try { await handle.inject(prompt, images); }
      catch { await handle.abort(); await createRuns(ports, input.workspaceId).finish(run.id, { outcome: "unavailable", sessionId: null, error: "Message injection failed" }); }
    } else {
      // A stuck launcher must not prevent the caller's timeout from resolving.
      await Promise.race([wake().catch(() => {}), waiting]);
    }
    return { waiting };
  }
  /** Work already running on this affair learns what the user just said; chat never fails because of it. */
  private async forwardToBackground({ workspaceId, affair, active, messageId, prompt, images }: { workspaceId: string; affair: { id: string } | null; active: { id: string } | null; messageId: string; prompt: string; images: ReturnType<typeof chatImages> }) {
    if (!affair) return;
    const { db } = this.ports;
    const background = await db.run.findFirst({ where: { workspaceId, affairId: affair.id, lane: "background", status: "running" } });
    const handle = background && background.id !== active?.id && liveRuns.get(background.id);
    if (!handle) return;
    let kind = "message_forwarded";
    try { await handle.inject("The user just wrote in chat (data; a separate conversation run replies to them; take it into account in your work): " + prompt, images); }
    catch { kind = "message_forward_failed"; }
    await audit(db, { workspaceId, actor: "user", kind, subjectId: background.id, details: { messageId } });
  }
  private injectionHandle(active: { id: string; affairId: string | null } | null, quoted: MessageRow | null, affair: { id: string } | null) {
    return active && (!quoted || active.affairId === (affair?.id ?? null)) && liveRuns.get(active.id);
  }
  private messagePrompt(input: z.output<typeof inputSchema>, quoted: MessageRow | null) {
    return [input.text, ...(quoted ? [`Quoted Chrona message (data): ${JSON.stringify({ text: quoted.text, affairId: quoted.affairId })}`] : []), ...(input.attachments.some(a => a.path) ? [`Attachments (data): ${JSON.stringify(input.attachments.map(({ name, path, mime, size }) => ({ name, path, mime, size })))}`] : []), ...input.attachments.filter(a => a.mime.startsWith("audio/")).map(a => `Voice note (not transcribed by Chrona): ${JSON.stringify({ name: a.name, path: a.path })}`)].join("\n\n");
  }
  private wait(inbound: MessageRow, runId: string, before: string[]): Promise<ChatReply> {
    const { ports, events } = this, { db } = ports;
    const serial = this.serial.bind(this), replies = this.replies.bind(this);
    return new Promise((resolve, reject) => {
      let settled = false, checking = false;
      let grace: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (settled) return;
        settled = true; clearTimeout(timer); clearTimeout(grace); clearInterval(poll); events.off(runId, finish);
        void serial(`result:${inbound.id}`, async () => {
          const rows = await replies(inbound, before);
          const saved = await db.audit.findFirst({ where: { workspaceId: inbound.workspaceId, kind: "chat_result", subjectId: inbound.id } });
          if (!saved) await audit(db, { workspaceId: inbound.workspaceId, actor: "chrona", kind: "chat_result", subjectId: inbound.id, details: { runId, messageIds: rows.map(m => m.id) } });
          return { runId, messages: rows.map(toMessage) };
        }).then(resolve, reject);
      };
      const timer = setTimeout(finish, ports.chatTimeoutMs ?? 120000);
      // Replies are durable before delivery; polling also works across service instances.
      const poll = setInterval(() => {
        if (settled || checking || grace) return;
        checking = true;
        void replies(inbound, before).then(rows => {
          if (!settled && rows.length) grace = setTimeout(finish, 3000);
        }, () => {}).finally(() => { checking = false; });
      }, 100);
      events.on(runId, finish);
      // Subscribe then check the durable completion marker, avoiding missed events
      // and resolving duplicates after restart without racing failure finalization.
      void db.audit.findFirst({ where: { workspaceId: inbound.workspaceId, kind: "chat_run_finished", subjectId: runId } }).then(done => { if (done) finish(); }, error => {
        settled = true; clearTimeout(timer); clearTimeout(grace); clearInterval(poll); events.off(runId, finish); reject(error);
      });
    });
  }
  /** Trusted transport bytes only; all paths are generated and filesystem-confined here. */
  private async attachmentAffair(input: Pick<ChatInput, "workspaceId" | "channel" | "quotedMessageId">) {
    const { db } = this.ports;
    const quoted = input.quotedMessageId ? await db.message.findFirst({ where: { id: input.quotedMessageId, workspaceId: input.workspaceId, direction: "out" } }) : null;
    const focus = await db.audit.findFirst({ where: { workspaceId: input.workspaceId, kind: "conversation_focus", subjectId: `chat:${input.channel}` }, orderBy: { createdAt: "desc" } });
    const focusedId = quoted ? quoted.affairId : z.object({ affairId: z.string() }).safeParse(focus?.details).data?.affairId;
    const affair = focusedId ? await db.affair.findFirst({ where: { id: focusedId, workspaceId: input.workspaceId, status: "active" } }) : null;
    return affair;
  }
  async intakeAttachments(input: Pick<ChatInput, "workspaceId" | "channel" | "quotedMessageId">, files: { name: string; mime: string; bytes: Uint8Array }[]) {
    if (files.length > 10) throw new StewardError("invalid", "Too many attachments");
    const { ports } = this;
    const affair = await this.attachmentAffair(input);
    const fs = createWorkspaceFs(ports.dataDir), day = ports.now().toISOString().slice(0, 10);
    const attachments: NonNullable<ChatInput["attachments"]> = [];
    let images = 0;
    for (const file of files) {
      const name = file.name.normalize("NFKC").replaceAll("\\", "/").split("/").pop()!.replace(/[^\p{L}\p{N}._-]/gu, "_").replace(/^\.+/, "").slice(0, 180) || "attachment";
      const unique = `${randomUUID()}-${name}`;
      const path = affair ? (await fs.forAffair(affair.dirName).upload(`attachments/${day}`, unique, file.bytes)).path : await fs.uploadChatInbox(`inbox/chat/${day}/${unique}`, file.bytes);
      const inline = file.mime.startsWith("image/") && file.bytes.byteLength <= 5 * 1024 * 1024 && images < 4;
      if (inline) images++;
      attachments.push({ name, path, mime: file.mime, size: file.bytes.byteLength, ...(inline ? { base64: Buffer.from(file.bytes).toString("base64") } : {}) });
    }
    return { attachments, ...(affair ? { affairId: affair.id } : {}) };
  }
  async messages(workspaceId: string, limit = 50) {
    return (await this.ports.db.message.findMany({ where: { workspaceId }, orderBy: [{ at: "desc" }, { id: "desc" }], take: Math.max(1, Math.min(200, Math.trunc(limit) || 50)) })).reverse().map(toMessage);
  }
}
