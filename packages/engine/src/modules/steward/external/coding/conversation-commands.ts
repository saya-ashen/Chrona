import { executionIdSchema, type ExecutionView, type ExecutionSnapshot, type ExecutionStart } from "./contract.js";
import { callAgent } from "./agent";
import { codingError, type CodingContext } from "./storage";
import { createCodingWork, getCodingWorkState, sendCodingWork, answerCodingWork } from "./work";
import { codingGoal } from "./instructions";
import { pendingTurn, saveSessions, type CodingSessions, type CodingSession, type ConversationTurn } from "./sessions";

export type ConversationCommand = { action: string; "request-key": string; "work-id"?: string; "session-id"?: string; project?: string; path?: string; text?: string; question?: string };
export const isStopped = (view: Pick<ExecutionView, "status" | "stopConfirmed">) => view.stopConfirmed && ["completed", "failed", "cancelled"].includes(view.status);
const actions = ["create", "send", "stop", "answer", "select", "new", "retry", "register-project", "default-project"];
const fields = ["action", "request-key", "work-id", "session-id", "project", "path", "text", "question"];
function checkField(key: string, value: unknown) {
  const max = key === "text" ? 20_000 : key === "path" ? 4096 : 128;
  if (typeof value !== "string" || value.length > max) throw codingError("invalid", "输入内容过长或格式无效。");
  if (key === "project" && value === "") return; // Empty UI selection uses the durable draft/default.
  if (!["text", "action", "path"].includes(key) && !executionIdSchema.safeParse(value).success) throw codingError("invalid", "对话引用无效。");
}
export function parseConversationCommand(raw: unknown): ConversationCommand {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw codingError("invalid", "请检查操作参数。");
  const args = raw as Record<string, unknown>;
  if (Object.keys(args).some(key => !fields.includes(key)) || !actions.includes(String(args.action))) throw codingError("invalid", "未知工作台操作。");
  for (const [key, value] of Object.entries(args)) checkField(key, value);
  if (!args["request-key"] || String(args["request-key"]).length > 100) throw codingError("invalid", "缺少有效操作标识，请刷新页面。");
  if (args.action === "stop" && !args["work-id"]) throw codingError("invalid", "停止操作必须指定原执行轮次。");
  return args as ConversationCommand;
}
function signature(args: ConversationCommand) { return JSON.stringify(Object.entries(args).sort(([a], [b]) => a.localeCompare(b))); }
async function dispatch(context: CodingContext, turn: ConversationTurn) {
  if (turn.kind === "start") {
    const view = await createCodingWork(context, turn.start!);
    if (turn.start!.resumeFrom) {
      const parent = await getCodingWorkState(context, { workId: turn.start!.resumeFrom.workId });
      if (view.sessionId !== parent.sessionId || view.projectRef !== parent.projectRef || view.runId === parent.runId || view.attemptId === parent.attemptId) throw codingError("conflict", "续接执行未保留原会话或未创建新的执行轮次。");
    }
    return;
  }
  if (turn.kind === "send") { await sendCodingWork(context, { ...turn.target!, commandKey: turn.key, text: turn.text }); return; }
  await answerCodingWork(context, { ...turn.target!, commandKey: turn.key, requestId: turn.questionId!, answer: turn.answer! });
}
const rejectionCodes = ["conflict", "invalid", "not_found", "forbidden", "unauthorized", "unsupported", "unsupported_version", "too_large", "capacity"];
const errorCode = (error: unknown) => (error as { code?: string } | null)?.code;
async function reconcileRejection(context: CodingContext, turn: ConversationTurn, error: unknown) {
  if (!rejectionCodes.includes(errorCode(error) ?? "")) throw error;
  if (turn.kind !== "start") {
    // Control receipts precede delivery: replay the identical command to distinguish a consumed receipt from rejection.
    try { await dispatch(context, turn); }
    catch (replayed) {
      if (rejectionCodes.includes(errorCode(replayed) ?? "")) turn.rejected = { code: errorCode(replayed)! };
      throw replayed;
    }
    return;
  }
  try { await callAgent(context, "lookup-start", { commandKey: turn.start!.commandKey }); }
  catch (lookupError) { if (errorCode(lookupError) === "not_found") turn.rejected = { code: errorCode(error)! }; }
  throw error;
}
async function dispatchTurn(context: CodingContext, journal: CodingSessions, session: CodingSession, turn: ConversationTurn) {
  try {
    try { await dispatch(context, turn); }
    catch (error) { await reconcileRejection(context, turn, error); }
    turn.accepted = true;
  } catch (error) {
    if (turn.rejected && turn.kind === "start") session.selectedWorkId = session.workIds.slice().reverse().find(workId => workId !== turn.workId && !(session.turns ?? []).some(item => item.workId === workId && item.kind === "start" && item.rejected)) ?? null;
    await saveSessions(context, journal); throw error;
  }
  await saveSessions(context, journal);
}
function makeTurn(args: ConversationCommand, text: string): Omit<ConversationTurn, "kind" | "workId"> {
  return { key: args["request-key"], signature: signature(args), text, createdAt: new Date().toISOString(), accepted: false };
}
async function answerTurn(context: CodingContext, args: ConversationCommand, view: ExecutionView, text: string): Promise<ConversationTurn> {
  if (text.length > 8000) throw codingError("invalid", "问题答复最多允许 8000 个字符。");
  if (view.cancelRequested || view.stopConfirmed) throw codingError("conflict", "当前执行已停止或正在停止。");
  const target = { workId: view.workId, runId: view.runId, attemptId: view.attemptId };
  const snapshot = await callAgent<ExecutionSnapshot>(context, "snapshot", target);
  const question = snapshot.questions.find(item => item.requestId === args.question && item.status === "pending" && Date.parse(item.expiresAt) > Date.now());
  if (!question) throw codingError("conflict", "该问题已不再等待答复，请刷新。");
  let value: string | number | boolean = text;
  if (question.method === "confirm") { if (!["是", "否"].includes(text)) throw codingError("invalid", "请选择是或否。"); value = text === "是"; }
  if (question.method === "select") { value = question.options.indexOf(text); if (value < 0) throw codingError("invalid", "请选择有效选项。"); }
  return { ...makeTurn(args, text), kind: "answer", workId: view.workId, target, questionId: question.requestId, answer: { decision: "submit", value } };
}
function startTurn(args: ConversationCommand, projectRef: string, text: string, resumeFrom?: NonNullable<ExecutionStart["resumeFrom"]>): ConversationTurn {
  codingGoal(text); // Validate the provider envelope before persisting a pending turn.
  const key = args["request-key"];
  const start: ExecutionStart = { workId: `web-${key}`, commandKey: `web-${key}`, projectRef, goal: text, budget: { timeoutMs: 600_000, maxToolCalls: 30 }, ...(resumeFrom ? { resumeFrom } : {}) };
  return { ...makeTurn(args, text), kind: "start", workId: start.workId, start };
}
async function continuation(context: CodingContext, args: ConversationCommand, session: CodingSession, text: string) {
  if (!session.selectedWorkId) {
    if (args.action === "answer" || !session.projectRef) throw codingError("invalid", "请先选择项目并开始对话。");
    return startTurn(args, session.projectRef, text);
  }
  const view = await getCodingWorkState(context, { workId: session.selectedWorkId });
  if (args.action === "answer") return answerTurn(context, args, view, text);
  const target = { workId: view.workId, runId: view.runId, attemptId: view.attemptId };
  if (isStopped(view)) return startTurn(args, view.projectRef, text, target);
  if (view.status !== "running" || view.cancelRequested) throw codingError("conflict", "尚未确认当前执行已停止，暂不能开始下一轮。");
  return { ...makeTurn(args, text), kind: "send" as const, workId: view.workId, target };
}
async function retry(context: CodingContext, journal: CodingSessions, session: CodingSession | undefined) {
  const turn = session?.turns?.find(pendingTurn);
  if (!session || !turn) throw codingError("conflict", "没有待核对的发送操作。");
  await dispatchTurn(context, journal, session, turn); return session;
}
function requireSession(session: CodingSession | undefined): asserts session is CodingSession {
  if (!session) throw codingError("invalid", "请先打开一个对话。");
}
type ProjectServices = { list: () => Promise<string[]>; default: (path?: string) => Promise<string> };
async function projectDraft(context: CodingContext, args: ConversationCommand, journal: CodingSessions, projects: ProjectServices) {
  if (args.action === "register-project") {
    if (!args.path?.trim()) throw codingError("invalid", "请填写主机上已有目录的绝对路径。");
    const project = await context.call<{ projectRef?: unknown } | null>("projects.register", { path: args.path });
    const ref = executionIdSchema.safeParse(project?.projectRef);
    if (!ref.success) throw codingError("conflict", "项目服务返回了无效目录引用。");
    return openDraft(context, journal, ref.data);
  }
  if (args.action === "default-project") return openDraft(context, journal, await projects.default(args.path));
  if (args.project && !(await projects.list()).includes(args.project)) throw codingError("invalid", "请选择已添加的项目目录。");
  return openDraft(context, journal, args.project || await projects.default());
}
export async function applyConversationCommand(context: CodingContext, args: ConversationCommand, journal: CodingSessions, current: CodingSession | undefined, projects: ProjectServices) {
  const session = current;
  if (["register-project", "default-project", "new"].includes(args.action)) return projectDraft(context, args, journal, projects);
  if (args.action === "select") { requireSession(session); journal.selected = session.id; await saveSessions(context, journal); return session; }
  const previous = journal.sessions.flatMap(item => (item.turns ?? []).map(turn => ({ session: item, turn }))).find(item => item.turn.key === args["request-key"]);
  if (previous) {
    if (previous.turn.signature !== signature(args)) throw codingError("conflict", "该操作标识已用于不同输入。");
    if (previous.turn.rejected) throw codingError(previous.turn.rejected.code, "上次发送未被接受，请使用新的操作重新发送。");
    if (pendingTurn(previous.turn)) await dispatchTurn(context, journal, previous.session, previous.turn);
    return previous.session;
  }
  if (args.action === "retry") return retry(context, journal, session);
  return appendOrStop(context, args, journal, session, projects);
}
async function openDraft(context: CodingContext, journal: CodingSessions, projectRef: string) {
  journal.selected = null; journal.draftProject = projectRef;
  await saveSessions(context, journal);
  return undefined;
}
async function stop(context: CodingContext, args: ConversationCommand, session: CodingSession) {
  if (!session.selectedWorkId) throw codingError("invalid", "尚无执行可停止。");
  const view = await getCodingWorkState(context, { workId: session.selectedWorkId });
  await callAgent(context, "cancel", { workId: view.workId, runId: view.runId, attemptId: view.attemptId, commandKey: args["request-key"] }); return session;
}
async function newSession(args: ConversationCommand, journal: CodingSessions, text: string, projects: ProjectServices) {
  const projectRef = args.project || journal.draftProject || await projects.default();
  if (args.project && !(await projects.list()).includes(projectRef)) throw codingError("invalid", "请选择已添加的项目目录。");
  if (journal.sessions.length >= 1000) throw codingError("capacity", "对话数量已达上限。");
  const session: CodingSession = { id: `chat-${args["request-key"]}`, title: text.slice(0, 200), projectRef, workIds: [], selectedWorkId: null, turns: [] };
  if (journal.sessions.some(item => item.id === session.id)) throw codingError("conflict", "对话标识已存在。");
  const turn = startTurn(args, projectRef, text); journal.sessions.push(session);
  return { session, turn };
}
function validateTarget(args: ConversationCommand, existing?: CodingSession) {
  if (args.action !== "create") requireSession(existing);
  if (args["work-id"] && existing?.selectedWorkId !== args["work-id"]) throw codingError("conflict", "此页面的轮次已过期，请重新打开对话。");
}
function commandText(args: ConversationCommand) {
  const text = args.action === "answer" ? args.text : args.text?.trim();
  if (typeof text !== "string" || args.action !== "answer" && !text) throw codingError("invalid", "请填写要发送的内容。");
  return text;
}
async function appendOrStop(context: CodingContext, args: ConversationCommand, journal: CodingSessions, existing: CodingSession | undefined, projects: ProjectServices) {
  validateTarget(args, existing);
  if (args.action === "stop") return stop(context, args, existing!);
  if (existing?.turns?.some(pendingTurn)) throw codingError("conflict", "请先核对上次发送结果。");
  const text = commandText(args);
  const { session, turn } = args.action === "create" ? await newSession(args, journal, text, projects) : { session: existing!, turn: await continuation(context, args, existing!, text) };
  if (!session.workIds.includes(turn.workId)) session.workIds.push(turn.workId);
  session.selectedWorkId = turn.workId; (session.turns ??= []).push(turn); journal.selected = session.id;
  // Persist the exact input and binding before any dispatch. Retrying this record cannot mint a new execution.
  await saveSessions(context, journal);
  await dispatchTurn(context, journal, session, turn);
  return session;
}
