import { z } from "zod";
import { SESSION_SOURCES, SESSION_STATUSES } from "@chrona/contracts/steward";
import { createSessions } from "../sessions";
import { buildQueue, buildQueueText } from "../build-queue";
import { sessionTranscript } from "../transcript";
import { readChatFile } from "../chat";
import { storedAttachments } from "../store";
import { CallError, type SystemModule } from "../module-calls";
import * as outputs from "../system-outputs";
import { tool, text, json } from "./shared";
import type { StewardPorts } from "../ports";

type HistoryArgs = Parameters<SystemModule["handle"]>[2];
async function listLegacySessions(ports: StewardPorts, workspaceId: string, args: HistoryArgs) {
  const records = await createSessions(ports, workspaceId).list({ ...(args.source ? { source: args.source } : {}), ...(args.status ? { status: args.status } : {}), ...(args.entries !== undefined ? { entries: args.entries } : {}), limit: args.limit ?? 100 });
  const contexts = await ports.db.audit.findMany({ where: { workspaceId, id: { in: records.map(record => `agent-context:${record.id}`) } }, select: { subjectId: true } });
  return json(records.filter(record => !contexts.some(context => context.subjectId === record.id)));
}
async function ownedLegacySession(ports: StewardPorts, workspaceId: string, sessionId: string) {
  const session = await ports.db.session.findFirst({ where: { id: sessionId, workspaceId } });
  if (!session || await ports.db.audit.findUnique({ where: { id: `agent-context:${session.id}` } })) throw new CallError("not_found", "Legacy session not found");
  return session;
}
async function legacyTranscript(ports: StewardPorts, workspaceId: string, session: Awaited<ReturnType<typeof ownedLegacySession>>) {
  const items = await sessionTranscript(ports, session.id, session.source === "build" ? 299 : 300);
  if (session.source !== "build") return json(items);
  const latest = await ports.db.run.findFirst({ where: { workspaceId, sessionId: session.id, lane: "build" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  if (!latest) return json(items);
  const state = (await buildQueue(ports.db, workspaceId)).get(session.id);
  const ended: Record<string, string> = { finished: "本轮运行已结束，提交版本仍按原审批流程处理", cancelled: "构建已停止，文件和历史保留", failed: "本轮运行失败，等待人工继续", timed_out: "本轮运行超时，等待人工继续", provider_unavailable: "模型服务不可用，等待人工继续" };
  const status = state ? buildQueueText(state) : ended[latest.status] ?? latest.status;
  const waiting = state?.status === "build_queued" ? "等待期间不调用模型、不计入单轮时限；修改需求会重新排到队尾。" : "";
  return json([{ at: ports.now().toISOString(), kind: "text", text: `Chrona 构建状态：${status}。${waiting}刷新页面可更新状态。` }, ...items]);
}
async function legacyFile(ports: StewardPorts, workspaceId: string, args: HistoryArgs) {
  const message = await ports.db.message.findFirst({ where: { id: String(args.message), workspaceId } });
  if (!message || (message.sessionId && await ports.db.audit.findUnique({ where: { id: `agent-context:${message.sessionId}` } })) || !storedAttachments(message.attachments).some(file => file.ref === args.ref)) throw new CallError("not_found", "File is not attached to this message");
  const file = await readChatFile(ports, String(args.ref), workspaceId);
  if (!file) throw new CallError("not_found", "File not found");
  if (file.bytes.byteLength > 20 * 1024 * 1024) throw new CallError("invalid", "File larger than 20 MiB");
  return { base64: file.bytes.toString("base64"), mime: file.mime };
}

/** Read-only records from the former kernel conversation store; new conversations belong to apps. */
export const history: SystemModule = {
  name: "history", description: "历史记录：只读查看旧会话、构建记录和附件；新会话由入口应用管理。",
  unrecorded: ["file", "transcript", "messages"],
  tools: [
    tool("sessions", "Read legacy conversation and build records. Does not select, continue or create a conversation.", { source: { type: "string", enum: [...SESSION_SOURCES] }, status: { type: "string", enum: [...SESSION_STATUSES] }, entries: { type: "boolean" }, limit: { type: "number", description: "1–200" } }, [], { visibility: ["owner"], idempotent: true, output: z.lazy(() => outputs.chatSessionsOutput) }),
    tool("session", "One legacy record, read only.", { session: text() }, ["session"], { visibility: ["owner"], idempotent: true, output: z.lazy(() => outputs.chatSessionOutput) }),
    tool("messages", "Stored legacy messages, read only.", { session: text(), limit: { type: "number", description: "1–200" } }, ["session"], { visibility: ["owner"], idempotent: true, output: z.lazy(() => outputs.chatMessagesOutput) }),
    tool("transcript", "Normalized redacted transcript of one legacy session.", { session: text() }, ["session"], { visibility: ["owner"], idempotent: true, output: z.lazy(() => outputs.chatTranscriptOutput) }),
    tool("file", "Read a file only when it belongs to the exact legacy message.", { message: text(), ref: text() }, ["message", "ref"], { visibility: ["owner"], idempotent: true, output: z.lazy(() => outputs.chatFileOutput) }),
  ],
  async handle({ ports, workspaceId }, name, args) {
    const sessions = createSessions(ports, workspaceId);
    if (name === "sessions") return listLegacySessions(ports, workspaceId, args);
    if (["session", "messages", "transcript"].includes(name)) {
      const session = await ownedLegacySession(ports, workspaceId, String(args.session));
      if (name === "session") return json(await sessions.get(session.id));
      if (name === "messages") return json(await sessions.messages(session.id, args.limit ?? 50));
      return legacyTranscript(ports, workspaceId, session);
    }
    if (name === "file") return legacyFile(ports, workspaceId, args);
    throw new CallError("not_found", `history.${name} not found`);
  },
};
