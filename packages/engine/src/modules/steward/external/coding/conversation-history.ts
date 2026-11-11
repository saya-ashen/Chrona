import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { callAgent, readCodingObservation } from "./agent";
import { executionEventPageSchema, executionSnapshotSchema, type ExecutionSnapshot, type ExecutionEventPage, type ExecutionEventPayload, type ExecutionView } from "./contract.js";
import { codingError, readCodingWork, writeCodingWork, type CodingContext } from "./storage";
import { saveSessionFile } from "./sessions";
import { getCodingWorkState } from "./work";
import { reconcileCodingResult } from "./results";

export type ConversationMessage = { id: string; author: string; content: string; timestamp: string; status: string };
export type ConversationHistory = { version: 1; cursor?: string; sequence: number; limited: boolean; snapshot?: ExecutionSnapshot; streams?: Record<string, string>; messages: ConversationMessage[]; progress: { sequence: number; text: string }[] };
const statuses = { queued: "排队中", running: "正在执行", completed: "已完成", failed: "执行失败", cancelled: "已停止", unknown: "状态未知，需核对停止证据" };
const record = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === "object" && !Array.isArray(raw);
function validMessage(raw: unknown) {
  return record(raw) && typeof raw.id === "string" && typeof raw.content === "string" && typeof raw.author === "string" && typeof raw.timestamp === "string" && Number.isFinite(Date.parse(raw.timestamp)) && typeof raw.status === "string";
}
function validProgress(raw: unknown) { return record(raw) && Number.isSafeInteger(raw.sequence) && typeof raw.text === "string"; }
function validStreams(raw: unknown) { return raw === undefined || record(raw) && Object.values(raw).every(value => typeof value === "string"); }
function validHistory(raw: unknown): raw is ConversationHistory {
  if (!record(raw) || raw.version !== 1 || !Number.isSafeInteger(raw.sequence) || Number(raw.sequence) < 0 || typeof raw.limited !== "boolean") return false;
  if (raw.cursor !== undefined && typeof raw.cursor !== "string") return false;
  if (!validStreams(raw.streams)) return false;
  return Array.isArray(raw.messages) && raw.messages.every(validMessage) && Array.isArray(raw.progress) && raw.progress.every(validProgress);
}
function progressText(payload: ExecutionEventPayload): string | null {
  switch (payload.type) {
    case "tool_started": return `正在调用 ${payload.tool}：${payload.display.path ?? payload.display.command ?? ""}`;
    case "tool_finished": return `${payload.isError ? "工具失败" : "工具完成"} ${payload.tool}：${payload.summary}`;
    case "question": return `等待答复：${payload.question.title}`;
    case "state": return statuses[payload.status];
    case "gap": return "部分进度已省略，请核对最终回复与项目文件。";
    case "usage": return `用量：输入 ${payload.input}，输出 ${payload.output}`;
    default: return null;
  }
}
export async function loadHistory(context: CodingContext, workId: string): Promise<ConversationHistory> {
  let raw: unknown;
  try { const path = join(context.dir, "sessions", `history-${workId}.json`); if ((await stat(path)).size > 64 * 1024 * 1024) throw codingError("too_large", "Coding history exceeds storage budget"); raw = JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, sequence: 0, limited: false, messages: [], progress: [] }; throw error; }
  if (!validHistory(raw)) throw codingError("conflict", "Invalid conversation history");
  if (raw.snapshot) raw.snapshot = executionSnapshotSchema.parse(raw.snapshot);
  return raw;
}
function message(history: ConversationHistory, messageId: string, at: string) {
  let found = history.messages.find(item => item.id === messageId);
  if (!found) { found = { id: messageId, author: "编码助手", content: "", timestamp: at, status: "回复中" }; history.messages.push(found); }
  return found;
}
function applyMessage(history: ConversationHistory, payload: ExecutionEventPayload, at: string) {
  if (payload.type !== "text_delta" && !(payload.type === "message" && payload.role === "assistant")) return;
  const found = message(history, payload.messageId, at), streams = history.streams ??= {};
  // Snapshot text must never become the accumulator for later stream pages: that would duplicate deltas.
  const previous = Object.hasOwn(streams, payload.messageId) ? streams[payload.messageId]! : "";
  const text = payload.type === "message" ? payload.text : previous + payload.delta;
  Object.defineProperty(streams, payload.messageId, { value: text, writable: true, configurable: true, enumerable: true }); found.content = text;
  found.status = payload.type === "message" && payload.complete ? "" : "回复中";
}
function applyPage(history: ConversationHistory, page: ExecutionEventPage) {
  // snapshotRequired also marks ordinary lifecycle refreshes; only loss evidence limits history.
  history.limited ||= page.gap;
  for (const event of page.events) {
    if (event.seq <= history.sequence) continue;
    if (event.seq !== history.sequence + 1) history.limited = true;
    history.sequence = event.seq;
    applyMessage(history, event.payload, event.at);
    const text = progressText(event.payload);
    if (text) history.progress.push({ sequence: event.seq, text });
    if (event.payload.type === "gap") history.limited = true;
  }
  if (history.progress.length > 100) { history.progress = history.progress.slice(-100); history.limited = true; }
  history.cursor = page.cursor;
}
async function readPage(context: CodingContext, target: Record<string, unknown>, history: ConversationHistory) {
  try { return await callAgent<ExecutionEventPage>(context, "events", { ...target, ...(history.cursor ? { cursor: history.cursor } : {}), limit: 100, waitMs: 0 }); }
  catch (error) {
    const failure = error as { code?: string; reason?: string };
    const code = failure.reason ?? failure.code;
    if (!["cursor_expired", "not_found", "unavailable"].includes(code ?? "")) throw error;
    history.limited = true;
    if (code === "cursor_expired") return callAgent<ExecutionEventPage>(context, "events", { ...target, limit: 100, waitMs: 0 });
  }
}
function applySnapshot(history: ConversationHistory, snapshot: ExecutionSnapshot) {
  history.snapshot = snapshot;
  history.limited ||= snapshot.missing || !!snapshot.finalMessage?.truncated;
  const final = snapshot.finalMessage;
  if (!final) return;
  const found = message(history, final.messageId, new Date().toISOString());
  if (!final.truncated || found.content.length <= final.text.length) found.content = final.text;
  found.status = final.truncated ? "回复可能不完整" : "";
}
function applyFullReply(history: ConversationHistory, snapshot: ExecutionSnapshot, text: string | undefined) {
  if (!snapshot.finalMessage || text === undefined) return;
  const found = message(history, snapshot.finalMessage.messageId, new Date().toISOString());
  if (!snapshot.missing || text.length >= found.content.length) found.content = text;
  found.status = snapshot.stopConfirmed ? "" : "回复中";
}
function matchesExecution(actual: Pick<ExecutionView, "workId" | "sessionId" | "runId" | "attemptId">, expected: ExecutionView): boolean {
  return actual.workId === expected.workId && actual.sessionId === expected.sessionId && actual.runId === expected.runId && actual.attemptId === expected.attemptId;
}
/** Cache full replies and incremental cursors without re-running work on reads. */
export async function refreshHistory(context: CodingContext, view: ExecutionView, history: ConversationHistory) {
  const target = { workId: view.workId, runId: view.runId, attemptId: view.attemptId };
  if (history.snapshot && !matchesExecution(history.snapshot, view)) throw codingError("conflict", "Conversation execution identity changed");
  const page = await readPage(context, target, history);
  if (page) {
    if (!executionEventPageSchema.safeParse(page).success || page.events.some(event => !matchesExecution(event, view))) throw codingError("conflict", "Conversation event identity changed");
    applyPage(history, page);
  }
  const observed = await readCodingObservation(context, target), snapshot = observed.snapshot;
  if (!executionSnapshotSchema.safeParse(snapshot).success || !matchesExecution(snapshot, view)) throw codingError("conflict", "Conversation snapshot identity changed");
  applySnapshot(history, snapshot);
  applyFullReply(history, snapshot, observed.text);
  await saveSessionFile(context, `history-${view.workId}.json`, history);
  return history;
}
const stopped = (snapshot: Pick<ExecutionView, "stopConfirmed" | "status">) => snapshot.stopConfirmed && ["completed", "failed", "cancelled"].includes(snapshot.status);
async function captureResult(context: CodingContext, view: ExecutionView) {
  const work = await readCodingWork(context, view.workId);
  await reconcileCodingResult(context, work, view); await writeCodingWork(context, work);
}
export async function readConversationWork(context: CodingContext, workId: string, projectRef: string, cachedOnly: boolean) {
  let history = await loadHistory(context, workId);
  let view: ExecutionView | undefined;
  if (cachedOnly && history.snapshot && stopped(history.snapshot) && history.sequence >= history.snapshot.highWatermark) {
    const view = { ...history.snapshot, projectRef }; await captureResult(context, view); return { history, view };
  }
  try {
    view = await getCodingWorkState(context, { workId });
    history = await refreshHistory(context, view, history);

  } catch (error) {
    if (!["not_found", "unavailable"].includes((error as { code?: string }).code ?? "")) throw error;
    history.limited = true;
    if (history.snapshot && stopped(history.snapshot)) view = { ...history.snapshot, projectRef };
  }
  if (view) await captureResult(context, view);
  return { history, view };
}
