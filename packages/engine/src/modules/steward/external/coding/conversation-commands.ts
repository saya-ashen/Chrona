import { createHash } from "node:crypto";
import { executionSnapshotSchema, type ExecutionView, type ExecutionSnapshot, type ExecutionStart } from "./contract.js";
import { callAgent } from "./agent";
import { codingError, type CodingContext } from "./storage";
import { createCodingWork, getCodingWorkState, sendCodingWork, answerCodingWork } from "./work";
import { codingGoal } from "./instructions";
import { pendingTurn, type CodingSession, type ConversationTurn } from "./sessions";
import type { CodingCommand, RoundTarget } from "./commands";

export const isStopped = (view: Pick<ExecutionView, "status" | "stopConfirmed">) => view.stopConfirmed && ["completed", "failed", "cancelled"].includes(view.status);
export const commandId = (prefix: string, key: string) => `${prefix}-${createHash("sha256").update(key).digest("hex")}`;
export function requireWork(session: CodingSession, workId: string) {
  if (!session.workIds.includes(workId)) throw codingError("not_found", "Work does not belong to this conversation");
}
export async function roundView(context: CodingContext, session: CodingSession, target: RoundTarget, current = false) {
  requireWork(session, target.workId);
  if (current && session.currentWorkId !== target.workId) throw codingError("conflict", "Conversation has advanced to another round");
  const view = await getCodingWorkState(context, { workId: target.workId });
  if (view.projectRef !== session.projectRef || view.runId !== target.runId || view.attemptId !== target.attemptId) throw codingError("conflict", "Execution reference changed");
  return view;
}
export function checkSnapshot(snapshot: ExecutionSnapshot, view: ExecutionView) {
  if (!executionSnapshotSchema.safeParse(snapshot).success || snapshot.workId !== view.workId || snapshot.sessionId !== view.sessionId || snapshot.runId !== view.runId || snapshot.attemptId !== view.attemptId) throw codingError("conflict", "Snapshot does not match execution");
}
function startTurn(key: string, projectRef: string, text: string, resumeFrom?: ExecutionStart["resumeFrom"]): ConversationTurn {
  codingGoal(text);
  const start: ExecutionStart = { workId: commandId("work", key), commandKey: key, projectRef, goal: text, budget: { timeoutMs: 600_000, maxToolCalls: 30 }, ...(resumeFrom ? { resumeFrom } : {}) };
  return { key, kind: "start", workId: start.workId, text, createdAt: new Date().toISOString(), accepted: false, start };
}
export async function prepareTurn(context: CodingContext, session: CodingSession, command: Extract<CodingCommand, { op: "round.send" | "round.answer" }>): Promise<ConversationTurn> {
  if (session.turns.some(pendingTurn)) throw codingError("conflict", "Resolve the pending command before sending another turn");
  if (session.currentWorkId !== command.workId) throw codingError("conflict", "Conversation has advanced to another round");
  if (command.op === "round.send" && !session.currentWorkId) return startTurn(command.requestKey, session.projectRef, command.text.trim());
  const view = command.op === "round.answer" ? await roundView(context, session, command, true) : await getCodingWorkState(context, { workId: session.currentWorkId! });
  if (view.projectRef !== session.projectRef) throw codingError("conflict", "Conversation project changed");
  const target = { workId: view.workId, runId: view.runId, attemptId: view.attemptId };
  if (command.op === "round.send") {
    if (isStopped(view)) return startTurn(command.requestKey, session.projectRef, command.text.trim(), target);
    if (view.status !== "running" || view.cancelRequested || view.stopConfirmed) throw codingError("conflict", "Current execution has not confirmed its stop");
    return { key: command.requestKey, kind: "send", workId: view.workId, text: command.text.trim(), createdAt: new Date().toISOString(), accepted: false, target };
  }
  return prepareAnswer(context, view, command);
}
async function prepareAnswer(context: CodingContext, view: ExecutionView, command: Extract<CodingCommand, { op: "round.answer" }>): Promise<ConversationTurn> {
  if (view.status !== "running" || view.cancelRequested || view.stopConfirmed) throw codingError("conflict", "Execution is no longer waiting for answers");
  const target = { workId: view.workId, runId: view.runId, attemptId: view.attemptId };
  const snapshot = await callAgent<ExecutionSnapshot>(context, "snapshot", target); checkSnapshot(snapshot, view);
  const question = snapshot.questions.find(item => item.requestId === command.questionId && item.status === "pending" && Date.parse(item.expiresAt) > Date.now());
  if (!question) throw codingError("conflict", "Question is no longer awaiting an answer");
  let value: string | number | boolean = command.text;
  if (question.method === "confirm") { if (!["是", "否"].includes(command.text)) throw codingError("invalid", "Confirm answer must be 是 or 否"); value = command.text === "是"; }
  if (question.method === "select") { value = question.options.indexOf(command.text); if (value < 0) throw codingError("invalid", "Answer must equal an offered option"); }
  return { key: command.requestKey, kind: "answer", workId: view.workId, text: command.text, createdAt: new Date().toISOString(), accepted: false, target, questionId: question.requestId, answer: { decision: "submit", value } };
}
function checkParent(parent: ExecutionView, from: NonNullable<ExecutionStart["resumeFrom"]>) {
  if (!isStopped(parent) || parent.runId !== from.runId || parent.attemptId !== from.attemptId) throw codingError("conflict", "Continuation parent has not confirmed its stop");
}
function checkContinuation(parent: ExecutionView, view: ExecutionView) {
  if (view.sessionId !== parent.sessionId || view.projectRef !== parent.projectRef || view.runId === parent.runId || view.attemptId === parent.attemptId) throw codingError("conflict", "Continuation must retain the Agent session and create a new stopped-parent round");
}
/** Only initial dispatch or an explicit round.retry calls this function. */
export async function dispatchTurn(context: CodingContext, turn: ConversationTurn) {
  if (turn.kind === "start") {
    const from = turn.start!.resumeFrom;
    const parent = from ? await getCodingWorkState(context, { workId: from.workId }) : undefined;
    if (parent) checkParent(parent, from!);
    const view = await createCodingWork(context, turn.start!);
    if (parent) checkContinuation(parent, view);
    return view;
  }
  if (turn.kind === "send") return sendCodingWork(context, { ...turn.target!, commandKey: turn.key, text: turn.text });
  return answerCodingWork(context, { ...turn.target!, commandKey: turn.key, requestId: turn.questionId!, answer: turn.answer! });
}
