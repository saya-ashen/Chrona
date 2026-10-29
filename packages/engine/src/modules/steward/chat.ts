import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import { attachmentSchema, messageSchema, providerUsageSchema, SESSION_SOURCES, type ChatReply } from "@chrona/contracts/steward";
import type { Message as MessageRow } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { createRuns, liveRuns } from "./runs";
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";
import { storedAttachments, toMessage } from "./store";
import { pushReply } from "./chat-replies";
import { drainCalls } from "./module-calls";
import { autoRetain } from "./memory";
import { sessionSettings } from "./settings";

const image = z.string().max(4 * Math.ceil(5 * 1024 * 1024 / 3));
const inputSchema = z.object({
  workspaceId: z.string().min(1), channel: messageSchema.shape.channel, text: messageSchema.shape.text,
  attachments: z.array(attachmentSchema.extend({ base64: image.optional() })).max(10).default([]),
  externalId: z.string().min(1).max(1000).optional(), quotedMessageId: z.string().min(1).optional(), quotedExternalId: z.string().min(1).max(1000).optional(),
  sessionId: z.string().min(1).max(128).optional(), key: z.string().min(1).max(200).optional(),
});
export type ChatInput = z.input<typeof inputSchema>;
const unavailable = "模型暂时不可用，消息已记下，恢复后会继续处理。";
/** The conversations' files (uploads and reply attachments), kept by the system module chat like a module keeps its data (v2-8). */
export const chatFilesDir = (ports: Pick<StewardPorts, "dataDir">) => join(ports.dataDir, "platform", "data", "chat");
/** Stores bytes under a unique name; the reference is `chat/<file>` (Provider runs see content/chat/<file>). */
export async function storeChatFile(ports: Pick<StewardPorts, "dataDir">, name: string, bytes: Uint8Array) {
  const safe = name.normalize("NFKC").replaceAll("\\", "/").split("/").pop()!.replace(/[^\p{L}\p{N}._-]/gu, "_").replace(/^\.+/, "").slice(0, 180) || "attachment";
  const file = `${randomUUID()}-${safe}`;
  await mkdir(chatFilesDir(ports), { recursive: true });
  await writeFile(join(chatFilesDir(ports), file), bytes, { flag: "wx" });
  return { name: safe, ref: `chat/${file}`, size: bytes.byteLength };
}
/** A stored conversation file by its `chat/<file>` reference, or null. */
/**
 * A file a run hands over, kept by chat: an attachment it received (content/chat/<file>) or a file in its working
 * directory, copied in. Never a host path outside the run's directory.
 */
export async function runFile(ports: Pick<StewardPorts, "dataDir">, cwd: string, path: string) {
  if (path.startsWith("content/chat/")) {
    const ref = `chat/${path.slice("content/chat/".length)}`, file = await readChatFile(ports, ref);
    if (!file) throw new StewardError("not_found", `No received attachment ${path}`);
    return { name: path.split("/").pop()!.replace(/^[0-9a-f-]{36}-/, ""), ref, size: file.bytes.byteLength };
  }
  const root = await realpath(cwd);
  const full = await realpath(join(root, path)).catch(() => { throw new StewardError("not_found", `No file ${path} in the working directory`); });
  const rel = relative(root, full);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new StewardError("forbidden", "Files must be in the working directory");
  const info = await stat(full);
  if (!info.isFile()) throw new StewardError("invalid", `${path} is not a file`);
  if (info.size > 20 * 1024 * 1024) throw new StewardError("invalid", `${path} is larger than 20 MiB`);
  return storeChatFile(ports, path.split("/").pop()!, await readFile(full));
}
export async function readChatFile(ports: Pick<StewardPorts, "dataDir">, ref: string) {
  const file = ref.startsWith("chat/") ? ref.slice(5) : "";
  if (!file || file.includes("/") || file.startsWith(".")) return null;
  const path = join(chatFilesDir(ports), file);
  if (!(await stat(path).catch(() => null))?.isFile()) return null;
  return { bytes: await readFile(path), mime: Bun.file(path).type || "application/octet-stream" };
}
const CHAT_FILES_MIGRATED = "chat_files_migrated";
/**
 * Once per workspace (v2-8): attachments that pointed into app content areas are copied into chat's store, and web
 * conversations get the web module as their entry, so replies reach the page and chat.file serves their files.
 */
export async function migrateConversationFiles(ports: StewardPorts, workspaceId: string) {
  const { db } = ports;
  if (await db.audit.findFirst({ where: { workspaceId, kind: CHAT_FILES_MIGRATED } })) return 0;
  const modules = new Map((await db.module.findMany({ where: { workspaceId } })).map(module => [module.name, module.id]));
  let moved = 0;
  for (const message of await db.message.findMany({ where: { workspaceId }, select: { id: true, attachments: true } })) {
    const files = storedAttachments(message.attachments);
    if (!files.some(file => file.ref && !file.ref.startsWith("chat/"))) continue;
    const next = [];
    for (const file of files) {
      if (!file.ref || file.ref.startsWith("chat/")) { next.push(file); continue; }
      const [app, ...path] = file.ref.split("/"), id = modules.get(app!);
      const bytes = id ? await readFile(join(ports.dataDir, "platform", "content", id, ...path)).catch(() => null) : null;
      next.push({ ...file, ref: bytes ? (await storeChatFile(ports, file.name, bytes)).ref : null });
      moved++;
    }
    await db.message.update({ where: { id: message.id }, data: { attachments: next } });
  }
  const web = modules.get("web");
  if (web) await db.session.updateMany({ where: { workspaceId, source: "web", entryModuleId: null }, data: { entryModuleId: web } });
  await audit(db, { workspaceId, actor: "chrona", kind: CHAT_FILES_MIGRATED, subjectId: workspaceId, details: { moved } });
  return moved;
}
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
      const callers = await db.audit.findMany({ where: { workspaceId, kind: "chat_caller" }, orderBy: { createdAt: "asc" } });
      for (const caller of callers) {
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
    return [input.text, ...(quoted ? [`Quoted message (data): ${JSON.stringify(quoted.text)}`] : []), ...(input.attachments.length ? [`Attachments (data): ${JSON.stringify(input.attachments.map(({ name, ref, mime, size }) => ({ name, ref, mime, size })))}`] : [])].join("\n\n");
  }
  /** The context the session's last finished run ended with (Provider usage), 0 when unknown. */
  private async contextTokens(workspaceId: string, sessionId: string) {
    const { db } = this.ports, run = await db.run.findFirst({ where: { workspaceId, sessionId, status: "finished" }, orderBy: [{ endedAt: "desc" }, { id: "desc" }], select: { id: true } });
    if (!run) return 0;
    const events = await db.audit.findMany({ where: { workspaceId, kind: "provider_event", subjectId: run.id }, orderBy: { id: "desc" }, take: 400, select: { details: true } });
    const usage = events.map(row => row.details as { type?: unknown; value?: unknown } | null).find(details => details?.type === "usage");
    return providerUsageSchema.safeParse(usage?.value).data?.contextTokens ?? 0;
  }
  /**
   * A long QQ/web conversation ends before the next message (as Hermes resets its sessions): once idle past the prompt cache's
   * life it would be re-read at full price, and past the cap it costs more than starting over. What it said goes to memory
   * first; the new conversation recalls it at its first run.
   */
  private async rotate({ workspaceId, key, sessionId }: { workspaceId: string; key?: string | undefined; sessionId?: string | undefined }) {
    if (sessionId || !key) return;
    const { db } = this.ports, now = this.ports.now();
    const session = await db.session.findFirst({ where: { workspaceId, key, status: "active", source: { in: ["qq", "web"] } } });
    if (!session || await db.run.count({ where: { workspaceId, sessionId: session.id, status: { in: ["queued", "running"] } } })) return;
    const limits = sessionSettings((await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings), tokens = await this.contextTokens(workspaceId, session.id);
    const idle = now.getTime() - session.lastActivityAt.getTime() >= limits.idleMinutes * 60_000;
    if (tokens < limits.maxContextTokens && !(idle && tokens >= limits.minContextTokens)) return;
    await autoRetain(this.ports, workspaceId, session.id, true);
    if (!(await db.session.updateMany({ where: { id: session.id, status: "active" }, data: { status: "ended", endedAt: now } })).count) return;
    await audit(db, { workspaceId, actor: "chrona", kind: "session_rotated", subjectId: session.id, details: { tokens, idle } });
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
      const { key: _key, sessionId: _sessionId, quotedExternalId: _quoted, ...message } = input;
      const inbound = existing ?? await db.message.create({ data: { ...message, ...(quoted ? { quotedMessageId: quoted.id } : {}), sessionId: session.id, direction: "in", at: ports.now() } });
      await db.session.update({ where: { id: session.id }, data: { lastActivityAt: ports.now() } });
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
  /** Trusted transport bytes only; paths are generated, never supplied by callers. */
  async intakeAttachments(input: Pick<ChatInput, "workspaceId" | "channel" | "quotedMessageId">, files: { name: string; mime: string; bytes: Uint8Array }[]) {
    if (files.length > 10) throw new StewardError("invalid", "Too many attachments");
    const attachments: NonNullable<ChatInput["attachments"]> = [];
    let images = 0;
    for (const file of files) {
      const stored = await storeChatFile(this.ports, file.name, file.bytes);
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
