import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { createWorkspaceFs } from "./workspace-fs";
import { z } from "zod";
import { attachmentSchema, messageSchema, type ChatReply, type Message } from "@chrona/contracts/steward";
import type { Message as MessageRow } from "@chrona/db";
import type { StewardPorts } from "./service";
import { createRuns, liveRuns } from "./runs";
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";

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
function toMessage(row: MessageRow): Message {
  const attachments = z.array(attachmentSchema.strip()).parse(row.attachments);
  return messageSchema.parse({ id: row.id, direction: row.direction, channel: row.channel, text: row.text, attachments, affairId: row.affairId, quotedMessageId: row.quotedMessageId, at: row.at.toISOString() });
}
const callerSchema = z.object({ runId: z.string(), before: z.array(z.string()) });

export function createChat(ports: StewardPorts, wake: () => Promise<unknown>) {
  const { db } = ports, events = new EventEmitter();
  events.setMaxListeners(0);
  const locks = new Map<string, Promise<unknown>>();
  async function serial<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    locks.set(key, next);
    try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
  }
  async function replies(inbound: MessageRow, before: string[]) {
    return (await db.message.findMany({ where: { workspaceId: inbound.workspaceId, conversationKey: inbound.conversationKey, direction: "out", at: { gte: inbound.at } }, orderBy: [{ at: "asc" }, { id: "asc" }] })).filter(m => !before.includes(m.id));
  }
  // Called after run finalization, including when no HTTP caller remains attached.
  async function runFinished(workspaceId: string, runId: string) {
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
  async function handleMessage(raw: ChatInput): Promise<ChatReply> {
    const input = parseInput(inputSchema, raw), images = chatImages(input.attachments);
    const conversationKey = `chat:${input.channel}`;
    const prepared = await serial(`${input.workspaceId}:${conversationKey}`, async () => {
      const existing = input.externalId ? await db.message.findUnique({ where: { workspaceId_externalId: { workspaceId: input.workspaceId, externalId: input.externalId } } }) : null;
      if (existing) {
        const saved = await db.audit.findFirst({ where: { workspaceId: input.workspaceId, kind: "chat_result", subjectId: existing.id } });
        if (saved) {
          const result = z.object({ runId: z.string(), messageIds: z.array(z.string()) }).parse(saved.details);
          const rows = await db.message.findMany({ where: { workspaceId: input.workspaceId, id: { in: result.messageIds } } });
          return { result: { runId: result.runId, messages: result.messageIds.flatMap(id => rows.filter(r => r.id === id).map(toMessage)) } };
        }
        const caller = await db.audit.findFirst({ where: { workspaceId: input.workspaceId, kind: "chat_caller", subjectId: existing.id } });
        if (caller) return { inbound: existing, ...callerSchema.parse(caller.details) };
      }
      const quoted = input.quotedMessageId ? await db.message.findFirst({ where: { id: input.quotedMessageId, workspaceId: input.workspaceId, direction: "out" } }) : null;
      if (input.quotedMessageId && !quoted) throw new StewardError("not_found", "Quoted message not found");
      const focus = await db.audit.findFirst({ where: { workspaceId: input.workspaceId, kind: "conversation_focus", subjectId: conversationKey }, orderBy: { createdAt: "desc" } });
      const focusedId = input.affairId ?? (quoted ? quoted.affairId : z.object({ affairId: z.string() }).safeParse(focus?.details).data?.affairId);
      const affair = focusedId ? await db.affair.findFirst({ where: { id: focusedId, workspaceId: input.workspaceId, status: "active" } }) : null;
      if (input.affairId && !affair) throw new StewardError("not_found", "Active affair not found");
      const inbound = existing ?? await db.message.create({ data: { ...input, attachments: input.attachments, conversationKey, affairId: affair?.id, direction: "in", at: ports.now() } });
      // Timestamp ties are common with fake clocks and SQLite; explicitly exclude existing replies.
      const before = (await db.message.findMany({ where: { workspaceId: input.workspaceId, conversationKey, direction: "out", at: { gte: inbound.at } }, select: { id: true } })).map(m => m.id);
      const active = await db.run.findFirst({ where: { workspaceId: input.workspaceId, conversationKey, lane: "foreground", status: "running" } });
      // A quote changing affairs must queue in the correct cwd, not steer a different affair.
      const handle = active && (!quoted || active.affairId === (affair?.id ?? null)) && liveRuns.get(active.id);
      const prompt = [input.text, ...(quoted ? [`Quoted Chrona message (data): ${JSON.stringify({ text: quoted.text, affairId: quoted.affairId })}`] : []), ...(input.attachments.some(a => a.path) ? [`Attachments (data): ${JSON.stringify(input.attachments.map(({ name, path, mime, size }) => ({ name, path, mime, size })))}`] : []), ...input.attachments.filter(a => a.mime.startsWith("audio/")).map(a => `Voice note (not transcribed by Chrona): ${JSON.stringify({ name: a.name, path: a.path })}`)].join("\n\n");
      const run = handle ? active! : await createRuns(ports, input.workspaceId).enqueue({ lane: "foreground", trigger: "message", conversationKey, prompt, ...(affair ? { affairId: affair.id } : {}) });
      await audit(db, { workspaceId: input.workspaceId, actor: "user", kind: "chat_caller", subjectId: inbound.id, details: { runId: run.id, before } });
      if (!handle) await audit(db, { workspaceId: input.workspaceId, actor: "user", kind: "chat_run_input", subjectId: run.id, details: { messageId: inbound.id } });
      // Subscribe before injection/launch: scripted providers can finish immediately.
      const waiting = wait(inbound, run.id, before);
      if (handle) {
        try { await handle.inject(prompt, images); }
        catch { await handle.abort(); await createRuns(ports, input.workspaceId).finish(run.id, { outcome: "unavailable", sessionId: null, error: "Message injection failed" }); }
      } else {
        // A stuck launcher must not prevent the caller's timeout from resolving.
        await Promise.race([wake().catch(() => {}), waiting]);
      }
      return { waiting };
    });
    if ("result" in prepared) return prepared.result!;
    if ("waiting" in prepared) return prepared.waiting!;
    return wait(prepared.inbound, prepared.runId, prepared.before);
  }
  function wait(inbound: MessageRow, runId: string, before: string[]): Promise<ChatReply> {
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
  async function intakeAttachments(input: Pick<ChatInput, "workspaceId" | "channel" | "quotedMessageId">, files: { name: string; mime: string; bytes: Uint8Array }[]) {
    if (files.length > 10) throw new StewardError("invalid", "Too many attachments");
    const quoted = input.quotedMessageId ? await db.message.findFirst({ where: { id: input.quotedMessageId, workspaceId: input.workspaceId, direction: "out" } }) : null;
    const focus = await db.audit.findFirst({ where: { workspaceId: input.workspaceId, kind: "conversation_focus", subjectId: `chat:${input.channel}` }, orderBy: { createdAt: "desc" } });
    const focusedId = quoted ? quoted.affairId : z.object({ affairId: z.string() }).safeParse(focus?.details).data?.affairId;
    const affair = focusedId ? await db.affair.findFirst({ where: { id: focusedId, workspaceId: input.workspaceId, status: "active" } }) : null;
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
  return { handleMessage, intakeAttachments, runFinished, messages: async (workspaceId: string, limit = 50) => (await db.message.findMany({ where: { workspaceId }, orderBy: [{ at: "desc" }, { id: "desc" }], take: Math.max(1, Math.min(200, Math.trunc(limit) || 50)) })).reverse().map(toMessage) };
}
