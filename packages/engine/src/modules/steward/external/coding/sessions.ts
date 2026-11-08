import { mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { executionIdSchema, executionStartSchema, type ExecutionStart } from "./contract.js";
import { codingError, type CodingContext } from "./storage";
import { getCodingWork } from "./work";

export type ConversationTurn = {
  key: string; signature: string; kind: "start" | "send" | "answer";
  workId: string; text: string; createdAt: string; accepted: boolean;
  rejected?: { code: string };
  start?: ExecutionStart;
  target?: { workId: string; runId: string; attemptId: string };
  questionId?: string; answer?: { decision: "submit"; value: string | number | boolean };
};
export type CodingSession = { id: string; title: string; workIds: string[]; selectedWorkId: string | null; projectRef?: string; turns?: ConversationTurn[] };
export type CodingSessions = { version: 1; selected: string | null; sessions: CodingSession[] };
const validId = (value: unknown) => executionIdSchema.safeParse(value).success;
const record = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === "object" && !Array.isArray(raw);
export const pendingTurn = (turn: ConversationTurn) => !turn.accepted && !turn.rejected;
function validRejection(raw: Record<string, unknown>) {
  return raw.rejected === undefined || !raw.accepted && record(raw.rejected) && typeof raw.rejected.code === "string" && raw.rejected.code.length <= 128;
}
function validTurnContent(raw: Record<string, unknown>) {
  return validRejection(raw) && typeof raw.signature === "string" && typeof raw.text === "string" && raw.text.length <= 20_000 && typeof raw.createdAt === "string" && Number.isFinite(Date.parse(raw.createdAt)) && typeof raw.accepted === "boolean";
}
function validTarget(raw: unknown, workId: string) {
  return record(raw) && raw.workId === workId && validId(raw.runId) && validId(raw.attemptId);
}
function validAnswer(raw: unknown) { return record(raw) && raw.decision === "submit" && ["string", "number", "boolean"].includes(typeof raw.value); }
function validTurn(raw: unknown, workIds: string[]): boolean {
  if (!record(raw) || !validId(raw.key) || typeof raw.workId !== "string" || !workIds.includes(raw.workId) || !validTurnContent(raw)) return false;
  if (raw.kind === "start") { const start = executionStartSchema.safeParse(raw.start); return start.success && start.data.workId === raw.workId; }
  if (!["send", "answer"].includes(String(raw.kind)) || !validTarget(raw.target, raw.workId)) return false;
  return raw.kind !== "answer" || validId(raw.questionId) && validAnswer(raw.answer);
}
function validWorkIds(raw: unknown): raw is string[] { return Array.isArray(raw) && raw.every(validId) && new Set(raw).size === raw.length; }
function validTurns(raw: unknown, workIds: string[]) { return raw === undefined || Array.isArray(raw) && raw.every(turn => validTurn(turn, workIds)); }
function validSession(raw: unknown): raw is CodingSession {
  if (!record(raw) || !validId(raw.id)) return false;
  if (typeof raw.title !== "string" || !raw.title.trim() || raw.title.length > 200 || !validWorkIds(raw.workIds)) return false;
  const workIds = raw.workIds;
  if (raw.selectedWorkId !== null && !workIds.includes(String(raw.selectedWorkId))) return false;
  return (raw.projectRef === undefined || validId(raw.projectRef)) && validTurns(raw.turns, workIds);
}
function validJournal(raw: unknown): raw is CodingSessions {
  if (!record(raw) || raw.version !== 1 || !Array.isArray(raw.sessions) || raw.sessions.length > 1000) return false;
  if (!raw.sessions.every(validSession)) return false;
  const sessions = raw.sessions;
  if (new Set(sessions.map(item => item.id)).size !== sessions.length) return false;
  return raw.selected === null || sessions.some(item => item.id === raw.selected);
}
export async function loadSessions(context: CodingContext): Promise<CodingSessions> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(join(context.dir, "sessions", "index.json"), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, selected: null, sessions: [] }; throw error; }
  if (!validJournal(raw)) throw codingError("conflict", "Invalid coding session journal");
  const keys = raw.sessions.flatMap(session => (session.turns ?? []).map(turn => turn.key));
  if (new Set(keys).size !== keys.length) throw codingError("conflict", "Duplicate conversation command identity");
  return raw;
}
export async function saveSessionFile(context: CodingContext, name: string, value: unknown) {
  const dir = join(context.dir, "sessions"); await mkdir(dir, { recursive: true });
  const path = join(dir, name), temporary = `${path}.next`;
  // One module process owns this directory. Replace an interrupted temporary write on recovery.
  const file = await open(temporary, "w", 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
  await rename(temporary, path);
  const directory = await open(dir, "r");
  try { await directory.sync(); } finally { await directory.close(); }
}
export const saveSessions = (context: CodingContext, journal: CodingSessions) => saveSessionFile(context, "index.json", journal);
// Separate from the execution registry lock: a conversation binds its work BEFORE createCodingWork acquires that lock.
let pending: Promise<unknown> = Promise.resolve();
export function serializeConversation<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation); pending = result.catch(() => {}); return result;
}
function publicSessions(journal: CodingSessions) {
  return { version: journal.version, selected: journal.selected, sessions: journal.sessions.map(({ id, title, workIds, selectedWorkId }) => ({ id, title, workIds, selectedWorkId })) };
}
function sessionCommand(raw: unknown): Record<string, unknown> & { op: string } {
  if (!record(raw)) throw codingError("invalid", "Expected session command");
  const fields: Record<string, string[]> = { list: ["op"], create: ["op", "id", "title"], select: ["op", "id"], bind: ["op", "id", "workId"] };
  const op = raw.op;
  if (typeof op !== "string" || !Object.hasOwn(fields, op) || Object.keys(raw).some(key => !fields[op]!.includes(key))) throw codingError("invalid", "Invalid session command");
  if (op !== "list" && !validId(raw.id)) throw codingError("invalid", "Invalid session identity");
  return { ...raw, op };
}
function createSession(journal: CodingSessions, id: string, title: unknown, existing?: CodingSession) {
  if (typeof title !== "string" || !title.trim() || title.length > 200) throw codingError("invalid", "Invalid session title");
  if (existing) { if (existing.title !== title.trim()) throw codingError("conflict", "Session identity already used"); return existing; }
  if (journal.sessions.length >= 1000) throw codingError("capacity", "Coding session capacity reached");
  const session = { id, title: title.trim(), workIds: [], selectedWorkId: null }; journal.sessions.push(session); return session;
}
async function bindSession(context: CodingContext, journal: CodingSessions, session: CodingSession, rawWorkId: unknown) {
  const workId = executionIdSchema.safeParse(rawWorkId);
  if (!workId.success) throw codingError("invalid", "Invalid work identity");
  const work = await getCodingWork(context, { workId: workId.data });
  if (session.projectRef && session.projectRef !== work.projectRef) throw codingError("conflict", "Conversation belongs to a different project");
  if (journal.sessions.some(item => item.id !== session.id && item.workIds.includes(workId.data))) throw codingError("conflict", "Work belongs to a different conversation");
  session.projectRef = work.projectRef;
  if (!session.workIds.includes(workId.data)) session.workIds.push(workId.data);
  session.selectedWorkId = workId.data;
}
/** Legacy collection interface remains available; selecting a session never starts an execution. */
export function codingSessions(context: CodingContext, raw: unknown) {
  return serializeConversation(async () => {
    const args = sessionCommand(raw), journal = await loadSessions(context);
    if (args.op === "list") return publicSessions(journal);
    const id = String(args.id);
    let session = journal.sessions.find(item => item.id === id);
    if (args.op === "create") session = createSession(journal, id, args.title, session);
    if (!session) throw codingError("not_found", "Coding session not found");
    if (args.op === "select") journal.selected = id;
    if (args.op === "bind") await bindSession(context, journal, session, args.workId);
    await saveSessions(context, journal);
    return publicSessions(journal);
  });
}
