import { callAgent } from "./agent";
import { parseCodingCommand, commandSignature, type CodingCommand, type Mutation } from "./commands";
import { checkSnapshot, commandId, dispatchTurn, prepareTurn, requireWork, roundView } from "./conversation-commands";
import { readConversationWork, type ConversationMessage } from "./conversation-history";
import { executionEventPageSchema, type ExecutionEventPage, type ExecutionSnapshot } from "./contract.js";
import { readCodingResult } from "./result-reader";
import { acceptCodingResult, listCodingResults } from "./results";
import { loadSessions, publicSession, saveSessions, serializeConversation, type CodingSession, type CodingSessions, type CommandRecord } from "./sessions";
import { codingError, readCodingWork, remember, type CodingContext } from "./storage";
import { listProjects as projects, mutateProject } from "./projects";
import { boundedCodingOutput, encodedBytes } from "./output";
export type { CodingContext } from "./types";
export type { CodingCommand } from "./commands";

function sessionFor(journal: CodingSessions, id: string) {
  const session = journal.sessions.find(item => item.id === id);
  if (!session) throw codingError("not_found", "Coding conversation not found");
  return session;
}
function parts(message: ConversationMessage): ConversationMessage[] {
  if (Buffer.byteLength(JSON.stringify(message)) <= 32_000) return [message];
  const characters = Array.from(message.content), result: ConversationMessage[] = [];
  for (let offset = 0; offset < characters.length; offset += 4096) result.push({ ...message, id: offset ? `${message.id}.part-${offset}` : message.id, content: characters.slice(offset, offset + 4096).join("") });
  return result;
}
function historyPage(history: ConversationMessage[], before?: string) {
  const messages = history.flatMap(parts), end = before ? messages.findIndex(item => item.id === before) : messages.length;
  if (end < 0) throw codingError("invalid", "History cursor is no longer available");
  let start = end, bytes = 0;
  while (start > 0) { const size = Buffer.byteLength(JSON.stringify(messages[start - 1])); if (bytes + size > 96_000 && start < end) break; bytes += size; start--; }
  return { messages: messages.slice(start, end), hasEarlier: start > 0, before: start > 0 ? messages[start]!.id : null };
}
function sessionPage(journal: CodingSessions, command: Extract<CodingCommand, { op: "conversations.list" }>) {
  const sessions = journal.sessions.filter(item => !command.projectRef || item.projectRef === command.projectRef);
  const index = command.after ? sessions.findIndex(item => item.id === command.after) : -1;
  if (command.after && index < 0) throw codingError("invalid", "Unknown conversation list cursor");
  const page: ReturnType<typeof publicSession>[] = []; let bytes = 0, next = index + 1;
  for (; next < sessions.length && page.length < (command.limit ?? 50); next++) {
    const summary = publicSession(sessions[next]!, undefined, false), size = Buffer.byteLength(JSON.stringify(summary));
    if (page.length && bytes + size > 96_000) break;
    page.push(summary); bytes += size;
  }
  return { sessions: page, after: next < sessions.length ? page.at(-1)!.id : null };
}
async function conversation(context: CodingContext, session: CodingSession, before?: string, workBefore?: string) {
  const messages: ConversationMessage[] = [];
  let view: Awaited<ReturnType<typeof readConversationWork>>["view"], limited = false;
  let snapshot: ExecutionSnapshot | undefined, progress: { sequence: number; text: string }[] = [];
  for (const workId of session.workIds) {
    const turns = session.turns.filter(turn => turn.workId === workId);
    let assistant: ConversationMessage[] = [];
    if (!turns.some(turn => turn.kind === "start" && turn.rejected)) {
      const result = await readConversationWork(context, workId, session.projectRef, workId !== session.currentWorkId);
      if (result.view && result.view.projectRef !== session.projectRef) throw codingError("conflict", "Conversation project changed");
      assistant = result.history.messages; limited ||= result.history.limited;
      if (workId === session.currentWorkId) { view = result.view; snapshot = result.history.snapshot; progress = result.history.progress; }
    }
    const users = turns.map(turn => ({ id: turn.key, author: "你", content: turn.text, timestamp: turn.createdAt, status: turn.rejected ? "发送未被接受" : turn.accepted ? "" : "发送结果待核对" }));
    messages.push(...[...users, ...assistant].map(message => ({ ...message, id: `${workId}:${message.id}` })).sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
  }
  let progressBytes = 0, firstProgress = progress.length;
  while (firstProgress > 0) { const size = Buffer.byteLength(JSON.stringify(progress[firstProgress - 1])); if (progressBytes + size > 32_000) break; progressBytes += size; firstProgress--; }
  const snapshotOmitted = !!snapshot && encodedBytes(snapshot) > 32_000;
  limited ||= firstProgress > 0 || snapshotOmitted;
  // Cached history views may carry snapshot fields; expose only the view projection.
  if (view) {
    const { workId, sessionId, runId, attemptId, projectRef, status, cancelRequested, stopConfirmed } = view;
    view = { workId, sessionId, runId, attemptId, projectRef, status, cancelRequested, stopConfirmed };
  }
  return { session: publicSession(session, workBefore), view: view ?? null, history: { ...historyPage(messages, before), limited, snapshot: snapshotOmitted ? null : snapshot ?? null, snapshotOmitted, progress: progress.slice(firstProgress) } };
}
async function readCommand(context: CodingContext, journal: CodingSessions, command: CodingCommand): Promise<unknown> {
  switch (command.op) {
    case "projects.list": return { projects: await projects(context), defaultProjectRef: journal.defaultProjectRef };
    case "conversations.list": return sessionPage(journal, command);
    case "conversations.get": return conversation(context, sessionFor(journal, command.sessionId), command.before, command.workBefore);
    case "receipt": {
      const entry = journal.commands.find(item => item.command.requestKey === command.requestKey);
      if (!entry) throw codingError("not_found", "Coding command receipt not found");
      return { receipt: entry.receipt };
    }
    case "events": case "snapshot": return readRound(context, journal, command);
    case "results": requireWork(sessionFor(journal, command.sessionId), command.workId); return listCodingResults(context, command);
    case "read-result": {
      requireWork(sessionFor(journal, command.sessionId), command.workId);
      const work = await readCodingWork(context, command.workId), result = work.results.find(item => item.resultId === command.resultId);
      if (!result) throw codingError("not_found", "Result does not belong to this work");
      return readCodingResult(context, `coding/${result.artifactRef}.json`);
    }
    default: throw codingError("invalid", "Expected a read command");
  }
}
async function readRound(context: CodingContext, journal: CodingSessions, command: Extract<CodingCommand, { op: "events" | "snapshot" }>) {
  const session = sessionFor(journal, command.sessionId), view = await roundView(context, session, command);
  const target = { workId: command.workId, runId: command.runId, attemptId: command.attemptId };
  if (command.op === "snapshot") { const snapshot = await callAgent<ExecutionSnapshot>(context, "snapshot", target); checkSnapshot(snapshot, view); return snapshot; }
  const page = await callAgent<ExecutionEventPage>(context, "events", { ...target, ...(command.cursor ? { cursor: command.cursor } : {}), limit: command.limit ?? 100, waitMs: 0 });
  if (!executionEventPageSchema.safeParse(page).success || page.events.some(event => event.workId !== view.workId || event.sessionId !== view.sessionId || event.runId !== view.runId || event.attemptId !== view.attemptId)) throw codingError("conflict", "Events do not match execution");
  return page;
}
function isMutation(command: CodingCommand): command is Mutation { return "requestKey" in command && command.op !== "receipt"; }
function originalFor(journal: CodingSessions, command: Extract<CodingCommand, { op: "round.retry" }>) {
  const original = journal.commands.find(item => item.command.requestKey === command.originalRequestKey);
  if (!original || original.receipt.sessionId !== command.sessionId || !["round.send", "round.answer", "round.stop", "accept"].includes(original.command.op)) throw codingError("not_found", "No retryable command in this conversation");
  return original;
}
async function prepare(context: CodingContext, journal: CodingSessions, command: Mutation): Promise<CommandRecord> {
  const receipt: CommandRecord["receipt"] = { requestKey: command.requestKey, op: command.op, status: "pending" };
  if ("sessionId" in command) receipt.sessionId = sessionFor(journal, command.sessionId).id;
  switch (command.op) {
    case "projects.register": case "projects.create": break;
    case "projects.default": case "conversations.create": await prepareProjectChoice(context, journal, command, receipt); break;
    case "round.send": case "round.answer": {
      receipt.workId = await prepareSessionTurn(context, journal, command); break;
    }
    case "round.stop": await roundView(context, sessionFor(journal, command.sessionId), command, true); receipt.workId = command.workId; break;
    case "accept": requireWork(sessionFor(journal, command.sessionId), command.workId); receipt.workId = command.workId; break;
    case "round.retry": originalFor(journal, command); break;
  }
  return { command, signature: commandSignature(command), receipt };
}
const prepareRejections = new Set(["invalid", "conflict", "not_found", "forbidden", "capacity"]);
async function prepareCommand(context: CodingContext, original: CodingSessions, command: Mutation) {
  // Preparation may change local state, but only a successful preparation may publish it.
  const journal = structuredClone(original);
  let entry: CommandRecord;
  try { entry = await prepare(context, journal, command); }
  catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code && prepareRejections.has(code)) {
      original.commands.push({ command, signature: commandSignature(command), receipt: {
        requestKey: command.requestKey, op: command.op, status: "rejected",
        error: { code, message: (error instanceof Error ? error.message : "Command rejected before dispatch").slice(0, 1000) },
      } });
      // A failed save propagates as a storage failure; it is never rejection evidence.
      await saveSessions(context, original);
    }
    throw error;
  }
  journal.commands.push(entry);
  return { journal, entry };
}
async function prepareProjectChoice(context: CodingContext, journal: CodingSessions, command: Extract<Mutation, { op: "projects.default" | "conversations.create" }>, receipt: CommandRecord["receipt"]) {
  if (!(await projects(context)).some(item => item.projectRef === command.projectRef)) throw codingError("not_found", "Project is not registered");
  if (command.op === "conversations.create") {
    if (journal.sessions.length >= 1000) throw codingError("capacity", "Coding conversation capacity reached");
    const session: CodingSession = { id: commandId("chat", command.requestKey), title: command.title.trim(), projectRef: command.projectRef, workIds: [], currentWorkId: null, turns: [] };
    if (journal.sessions.some(item => item.id === session.id)) throw codingError("conflict", "Conversation identity already exists");
    journal.sessions.push(session); receipt.sessionId = session.id;
  }
}
async function prepareSessionTurn(context: CodingContext, journal: CodingSessions, command: Extract<Mutation, { op: "round.send" | "round.answer" }>) {
  const session = sessionFor(journal, command.sessionId);
  // An unresolved stop must be explicitly recovered, even when another client sends.
  if (journal.commands.some(item => item.receipt.sessionId === session.id && item.receipt.status === "pending" && item.command.op !== "round.retry")) throw codingError("conflict", "Resolve the pending command before sending another turn");
  const turn = await prepareTurn(context, session, command);
  session.turns.push(turn); if (!session.workIds.includes(turn.workId)) session.workIds.push(turn.workId);
  session.currentWorkId = turn.workId; return turn.workId;
}
async function execute(context: CodingContext, journal: CodingSessions, entry: CommandRecord): Promise<unknown> {
  const command = entry.command;
  switch (command.op) {
    case "projects.register": case "projects.create": return mutateProject(context, command.op === "projects.create" ? { action: "create", name: command.name } : { action: "register", path: command.path });
    case "projects.default": journal.defaultProjectRef = command.projectRef; return { defaultProjectRef: command.projectRef };
    case "conversations.create": return publicSession(sessionFor(journal, entry.receipt.sessionId!));
    case "round.send": case "round.answer": {
      const session = sessionFor(journal, command.sessionId), turn = session.turns.find(item => item.key === command.requestKey)!;
      const result = await dispatchTurn(context, turn); turn.accepted = true;
      return { sessionId: session.id, workId: turn.workId, execution: result };
    }
    case "round.stop": {
      const work = await readCodingWork(context, command.workId);
      const view = await callAgent<import("./contract.js").ExecutionView>(context, "cancel", { workId: command.workId, runId: command.runId, attemptId: command.attemptId, commandKey: command.requestKey });
      remember(work, view); return view;
    }
    case "accept": return acceptCodingResult(context, { workId: command.workId, resultId: command.resultId, commandKey: command.requestKey });
    case "round.retry": {
      const original = originalFor(journal, command);
      if (original.receipt.status === "pending") await settle(context, journal, original, false);
      return { receipt: structuredClone(original.receipt) };
    }
  }
}
const definitive = new Set(["invalid", "forbidden", "unauthorized", "unsupported", "unsupported_version", "capacity"]);
async function settle(context: CodingContext, journal: CodingSessions, entry: CommandRecord, throwRejected: boolean): Promise<void> {
  try {
    entry.receipt.value = await execute(context, journal, entry); entry.receipt.status = "accepted"; delete entry.receipt.error;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code ?? "unavailable";
    entry.receipt.error = { code, message: (error instanceof Error ? error.message : "Unknown command outcome").slice(0, 1000) };
    // Transport loss, changed evidence and unknown admission retain the exact pending identity.
    if (definitive.has(code)) {
      entry.receipt.status = "rejected";
      const session = journal.sessions.find(item => item.id === entry.receipt.sessionId), turn = session?.turns.find(item => item.key === entry.command.requestKey);
      if (turn) {
        turn.rejected = { code };
        if (turn.kind === "start") session!.currentWorkId = session!.workIds.slice().reverse().find(id => id !== turn.workId && !session!.turns.some(item => item.workId === id && item.kind === "start" && item.rejected)) ?? null;
      }
    }
    await saveSessions(context, journal);
    if (entry.receipt.status === "rejected" && throwRejected) throw codingError(code, entry.receipt.error.message);
    return;
  }
  await saveSessions(context, journal);
}
/** The single business boundary used by every admitted Coding client. */
export async function handleCodingCommand(context: CodingContext, raw: unknown): Promise<unknown> {
  const command = parseCodingCommand(raw);
  const output = await serializeConversation(async () => {
    const original = await loadSessions(context);
    if (!isMutation(command)) return readCommand(context, original, command);
    const previous = original.commands.find(item => item.command.requestKey === command.requestKey);
    if (previous) {
      if (previous.signature !== commandSignature(command)) throw codingError("conflict", "Request key already belongs to different arguments");
      return { receipt: structuredClone(previous.receipt) };
    }
    if (original.commands.length >= 10_000) throw codingError("capacity", "Coding command receipt capacity reached");
    const { journal, entry } = await prepareCommand(context, original, command);
    if (command.op === "conversations.create" || command.op === "projects.default") {
      entry.receipt.value = await execute(context, journal, entry);
      entry.receipt.status = "accepted";
      // Local state and acceptance share the same atomic journal replacement.
      await saveSessions(context, journal);
      return { receipt: structuredClone(entry.receipt) };
    }
    // Command, turn, project binding and current round become durable together before external effects.
    await saveSessions(context, journal);
    await settle(context, journal, entry, true);
    return { receipt: structuredClone(entry.receipt) };
  });
  return boundedCodingOutput(output);
}
