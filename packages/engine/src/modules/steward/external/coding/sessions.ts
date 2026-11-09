import { mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { executionStartSchema, type ExecutionStart } from "./contract.js";
import { codingError, type CodingContext } from "./storage";
import { commandSignature, parseCodingCommand, record, validId, type Mutation } from "./commands";

export type ConversationTurn = {
  key: string; kind: "start" | "send" | "answer"; workId: string; text: string;
  createdAt: string; accepted: boolean; rejected?: { code: string };
  start?: ExecutionStart; target?: { workId: string; runId: string; attemptId: string };
  questionId?: string; answer?: { decision: "submit"; value: string | number | boolean };
};
export type CodingSession = { id: string; title: string; projectRef: string; workIds: string[]; currentWorkId: string | null; turns: ConversationTurn[] };
export type Receipt = { requestKey: string; op: Mutation["op"]; status: "pending" | "accepted" | "rejected"; sessionId?: string; workId?: string; value?: unknown; error?: { code: string; message: string } };
export type CommandRecord = { command: Mutation; signature: string; receipt: Receipt };
export type CodingSessions = { version: 2; defaultProjectRef: string | null; sessions: CodingSession[]; commands: CommandRecord[] };
export const pendingTurn = (turn: ConversationTurn) => !turn.accepted && !turn.rejected;
function validTurnBase(raw: Record<string, unknown>, session: CodingSession) {
  return validId(raw.key) && session.workIds.includes(String(raw.workId)) && typeof raw.text === "string" && raw.text.length <= 20_000 && typeof raw.accepted === "boolean" && typeof raw.createdAt === "string" && Number.isFinite(Date.parse(raw.createdAt));
}
function validTurnTarget(raw: Record<string, unknown>) {
  return ["send", "answer"].includes(String(raw.kind)) && record(raw.target) && raw.target.workId === raw.workId && validId(raw.target.runId) && validId(raw.target.attemptId);
}
function validAnswer(raw: Record<string, unknown>) {
  return raw.kind !== "answer" || validId(raw.questionId) && record(raw.answer) && raw.answer.decision === "submit" && ["string", "number", "boolean"].includes(typeof raw.answer.value);
}
function validTurn(raw: unknown, session: CodingSession): raw is ConversationTurn {
  if (!record(raw) || !validTurnBase(raw, session)) return false;
  if (raw.rejected !== undefined && (raw.accepted || !record(raw.rejected) || typeof raw.rejected.code !== "string")) return false;
  if (raw.kind === "start") { const start = executionStartSchema.safeParse(raw.start); return start.success && start.data.workId === raw.workId && start.data.commandKey === raw.key && start.data.projectRef === session.projectRef; }
  return validTurnTarget(raw) && validAnswer(raw);
}
const unique = (values: unknown[]) => new Set(values).size === values.length;
function validWorkIds(raw: Record<string, unknown>) {
  if (!Array.isArray(raw.workIds) || !raw.workIds.every(validId) || !unique(raw.workIds)) return false;
  return raw.currentWorkId === null || validId(raw.currentWorkId) && raw.workIds.includes(raw.currentWorkId);
}
function validSession(raw: unknown): raw is CodingSession {
  if (!record(raw) || !validId(raw.id) || !validId(raw.projectRef) || typeof raw.title !== "string" || !raw.title.trim() || raw.title.length > 200 || !validWorkIds(raw)) return false;
  return Array.isArray(raw.turns) && raw.turns.every(turn => validTurn(turn, raw as CodingSession));
}
function validReceipt(receipt: Record<string, unknown>, command: Mutation, sessions: CodingSession[]) {
  if (receipt.requestKey !== command.requestKey || receipt.op !== command.op || !["pending", "accepted", "rejected"].includes(String(receipt.status))) return false;
  const session = sessions.find(item => item.id === receipt.sessionId);
  if (receipt.sessionId !== undefined && !session) return false;
  if (receipt.workId !== undefined && !session?.workIds.includes(String(receipt.workId))) return false;
  return receipt.error === undefined || record(receipt.error) && typeof receipt.error.code === "string" && typeof receipt.error.message === "string";
}
function validCommand(raw: unknown, sessions: CodingSession[], keys: Set<string>) {
  if (!record(raw) || !record(raw.receipt)) return false;
  let command;
  try { command = parseCodingCommand(raw.command); } catch { return false; }
  if (!("requestKey" in command) || command.op === "receipt" || raw.signature !== commandSignature(command) || keys.has(command.requestKey)) return false;
  keys.add(command.requestKey);
  return validReceipt(raw.receipt, command, sessions);
}
function validJournal(raw: unknown): raw is CodingSessions {
  if (!record(raw) || raw.version !== 2 || raw.defaultProjectRef !== null && !validId(raw.defaultProjectRef)) return false;
  return validJournalContent(raw);
}
function validJournalContent(raw: Record<string, unknown>) {
  if (!Array.isArray(raw.sessions) || raw.sessions.length > 1000 || !raw.sessions.every(validSession)) return false;
  if (!Array.isArray(raw.commands) || raw.commands.length > 10_000) return false;
  const sessions = raw.sessions, keys = new Set<string>();
  if (!unique(sessions.map(session => session.id)) || !unique(sessions.flatMap(session => session.workIds))) return false;
  if (!raw.commands.every(entry => validCommand(entry, sessions, keys))) return false;
  const turns = sessions.flatMap(session => session.turns);
  return unique(turns.map(turn => turn.key)) && turns.every(turn => keys.has(turn.key));
}
export async function loadSessions(context: CodingContext): Promise<CodingSessions> {
  const path = join(context.dir, "sessions", "index.json");
  let raw: unknown;
  try {
    if ((await stat(path)).size > 64 * 1024 * 1024) throw codingError("too_large", "Coding journal exceeds storage budget");
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 2, defaultProjectRef: null, sessions: [], commands: [] }; throw error; }
  if (!validJournal(raw)) throw codingError("conflict", "Invalid coding conversation journal");
  return raw;
}
export async function saveSessionFile(context: CodingContext, name: string, value: unknown) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > 64 * 1024 * 1024) throw codingError("capacity", "Coding journal storage budget reached");
  const dir = join(context.dir, "sessions"); await mkdir(dir, { recursive: true });
  const path = join(dir, name), temporary = `${path}.next`;
  const file = await open(temporary, "w", 0o600);
  try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
  await rename(temporary, path);
  const directory = await open(dir, "r");
  try { await directory.sync(); } finally { await directory.close(); }
}
export const saveSessions = (context: CodingContext, journal: CodingSessions) => saveSessionFile(context, "index.json", journal);
// The one module process owns its private journal. Shared tool and HTTP requests use this lock.
let pending: Promise<unknown> = Promise.resolve();
export function serializeConversation<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation); pending = result.catch(() => {}); return result;
}
export function publicSession(session: CodingSession, workBefore?: string, includeTurns = true) {
  const end = workBefore ? session.workIds.indexOf(workBefore) : session.workIds.length;
  if (end < 0) throw codingError("invalid", "Unknown conversation round cursor");
  const start = Math.max(0, end - 100), workIds = session.workIds.slice(start, end);
  const candidates = includeTurns ? session.turns.filter(turn => workIds.includes(turn.workId)).map(({ start: _start, target: _target, answer: _answer, ...turn }) => ({ ...turn })) : [];
  let first = candidates.length, bytes = 0;
  while (first > 0) { const size = Buffer.byteLength(JSON.stringify(candidates[first - 1])); if (bytes + size > 32_000) break; bytes += size; first--; }
  return { id: session.id, title: session.title, projectRef: session.projectRef, currentWorkId: session.currentWorkId, workIds, worksBefore: start > 0 ? workIds[0]! : null, turns: candidates.slice(first), hasEarlierTurns: first > 0 || start > 0 || !includeTurns && session.turns.length > 0 };
}
