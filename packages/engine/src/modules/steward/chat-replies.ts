import type { Prisma } from "@chrona/db";
import { storedAttachments } from "./store";
import type { StewardPorts } from "./ports";
import { enqueueCall, systemOrigin } from "./module-calls";

type Db = StewardPorts["db"] | Prisma.TransactionClient;
/** The user message a run answers (continuations inherit it), as its transport id. */
async function inboundExternalId(db: Db, workspaceId: string, runId: string | null) {
  if (!runId) return null;
  const input = await db.audit.findFirst({ where: { workspaceId, kind: "chat_run_input", subjectId: runId }, orderBy: { createdAt: "desc" } });
  const messageId = (input?.details as { messageId?: unknown } | null)?.messageId;
  if (typeof messageId !== "string") return null;
  return (await db.message.findFirst({ where: { id: messageId, workspaceId } }))?.externalId ?? null;
}
/**
 * A reply written into a conversation reaches it through the conversation's entry module: `chat` queues
 * `<entry>.reply` in the writer's transaction (key `reply:<messageId>`), so a reply is pushed once, whichever run wrote
 * it (continuations included). Conversations without an entry (e.g. MCP) are read from Chrona directly.
 */
export async function pushReply(db: Db, ports: StewardPorts, message: { id: string; workspaceId: string; sessionId: string; text: string; attachments: Prisma.JsonValue }, runId: string | null) {
  const session = await db.session.findFirst({ where: { id: message.sessionId, workspaceId: message.workspaceId } });
  if (!session?.entryModuleId) return null;
  const entry = await db.module.findFirst({ where: { id: session.entryModuleId, workspaceId: message.workspaceId } });
  if (!entry) return null;
  const files = storedAttachments(message.attachments);
  const inReplyTo = await inboundExternalId(db, message.workspaceId, runId);
  return enqueueCall({ tx: db, ports, origin: systemOrigin(message.workspaceId, "chat"), target: `${entry.name}.reply`, raw: {
    session: session.id, message: message.id, text: message.text.slice(0, 8000), workspace: message.workspaceId,
    attachments: JSON.stringify(files),
    ...(inReplyTo ? { "in-reply-to": inReplyTo } : {}),
  } }, { key: `reply:${message.id}` });
}
/** Whether replies of this conversation are pushed to an entry module (then they need no separate notice). */
export async function hasEntry(db: Db, sessionId: string) {
  return Boolean((await db.session.findUnique({ where: { id: sessionId }, select: { entryModuleId: true } }))?.entryModuleId);
}
