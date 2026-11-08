import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { executionIdSchema, executionStartSchema, type ExecutionSnapshot, type ExecutionView } from "./contract.js";
import { codingError, readCodingWork, type CodingContext } from "./storage";
import { loadSessions, pendingTurn, saveSessionFile, saveSessions, serializeConversation, type CodingSession, type CodingSessions } from "./sessions";
import { readConversationWork, type ConversationMessage } from "./conversation-history";
import { applyConversationCommand, parseConversationCommand, isStopped } from "./conversation-commands";

const id = executionIdSchema;
const statuses = { queued: "排队中", running: "正在执行", completed: "已完成", failed: "执行失败", cancelled: "已停止", unknown: "状态未知，需核对停止证据" };
function stopText(view?: Pick<ExecutionView, "status" | "stopConfirmed" | "cancelRequested">) {
  if (!view) return "尚未确认执行状态。";
  if (view.stopConfirmed) return "执行已停止。项目文件已保留，可继续对话。";
  if (view.cancelRequested) return "已请求停止，尚未确认；确认前不能开始下一轮。";
  if (view.status === "queued") return "正在排队，执行尚未开始。";
  if (view.status !== "running") return "尚未确认执行已停止；确认前不能开始下一轮。";
  return "正在直接编辑项目文件。";
}
type Project = { projectRef: string; path: string; label: string };
async function projects(context: CodingContext): Promise<Project[]> {
  const result = await context.call<unknown>("projects.list", {});
  const value = result as { projects?: unknown } | null;
  if (!value || !Array.isArray(value.projects) || !value.projects.every(validProject)) throw codingError("conflict", "项目服务返回了无效目录引用。");
  return value.projects;
}
function validProject(raw: unknown): raw is Project {
  if (!raw || typeof raw !== "object") return false;
  const value = raw as Record<string, unknown>;
  return id.safeParse(value.projectRef).success && typeof value.path === "string" && typeof value.label === "string";
}
type ProjectSelection = { version: 1; projectRef: string; automatic: boolean };
function validProjectSelection(raw: unknown): raw is ProjectSelection {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  return Object.keys(value).length === 3 && value.version === 1 && id.safeParse(value.projectRef).success && typeof value.automatic === "boolean";
}
async function readProjectSelection(context: CodingContext): Promise<ProjectSelection | undefined> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(context.dir, "sessions", "project.json"), "utf8"));
    if (!validProjectSelection(raw)) throw codingError("conflict", "默认项目设置无效，请重新选择目录。");
    return raw;
  } catch (error) {
    if (error instanceof SyntaxError) throw codingError("conflict", "默认项目设置无效，请重新选择目录。");
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
async function defaultProject(context: CodingContext, path?: string): Promise<Project> {
  if (path === undefined) {
    const selection = await readProjectSelection(context);
    if (selection) {
      const project = (await projects(context)).find(project => project.projectRef === selection.projectRef);
      if (!project) throw codingError("conflict", "默认项目记录不存在，请重新选择目录。");
      return selection.automatic ? { ...project, label: "默认空间" } : project;
    }
  }
  const automatic = path === undefined;
  const project = await context.call<unknown>(automatic ? "projects.create" : "projects.register", automatic ? { name: "default" } : { path });
  if (!validProject(project)) throw codingError("conflict", "项目服务返回了无效目录引用。");
  await saveSessionFile(context, "project.json", { version: 1, projectRef: project.projectRef, automatic });
  return automatic ? { ...project, label: "默认空间" } : project;
}
async function initializeDraft(context: CodingContext, journal: CodingSessions, project?: Project) {
  if (!journal.draftProject) {
    journal.draftProject = (project ?? await defaultProject(context)).projectRef;
    await saveSessions(context, journal);
  }
  return journal.draftProject;
}
async function restoreSessionProjects(context: CodingContext, journal: CodingSessions) {
  let changed = false;
  for (const session of journal.sessions) {
    if (session.projectRef || !session.workIds.length) continue;
    const work = await readCodingWork(context, session.workIds[0]!);
    const start = executionStartSchema.safeParse(work.start);
    if (start.success) { session.projectRef = start.data.projectRef; changed = true; }
  }
  return changed;
}
async function adoptLegacyWorks(context: CodingContext, journal: CodingSessions) {
  let entries: string[];
  try { entries = await readdir(context.dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  let changed = await restoreSessionProjects(context, journal);
  for (const name of entries.sort()) {
    if (!name.endsWith(".json") || name === "works-v2.json") continue;
    const workId = name.slice(0, -5);
    if (!id.safeParse(workId).success || journal.sessions.some(item => item.workIds.includes(workId))) continue;
    const work = await readCodingWork(context, workId), start = executionStartSchema.safeParse(work.start);
    if (!start.success) continue; // v2 works remain in the existing editor/work interface.
    if (journal.sessions.length >= 1000) break;
    let sessionId = `legacy-${workId}`.slice(0, 128);
    if (journal.sessions.some(item => item.id === sessionId)) sessionId = `legacy-${randomUUID()}`;
    journal.sessions.push({ id: sessionId, title: start.data.goal.slice(0, 200), projectRef: start.data.projectRef, workIds: [workId], selectedWorkId: workId, turns: [] }); changed = true;
  }
  if (changed) await saveSessions(context, journal);
}
const projectReadError = (error: unknown) => ["invalid", "conflict", "not_found", "unavailable"].includes((error as { code?: string }).code ?? "");
async function catalogProjects(context: CodingContext, journal: CodingSessions) {
  let registered: Project[] = [], automatic: Project | undefined, notice = "直接编辑所选目录；每轮最多 10 分钟、30 次工具调用。";
  try { registered = await projects(context); }
  catch (error) { if (!projectReadError(error)) throw error; notice = "暂时无法读取项目目录。已有对话仍保留，请稍后重试。"; }
  try {
    automatic = await defaultProject(context);
    await initializeDraft(context, journal, automatic);
    registered = [automatic, ...registered.filter(project => project.projectRef !== automatic!.projectRef)];
  } catch (error) { if (!projectReadError(error)) throw error; notice = "默认空间暂不可用。仍可打开已有项目与对话，或在默认空间设置中指定有效目录。"; }
  return { registered, automatic, notice };
}
function groupedSessions(journal: CodingSessions, registered: Project[], automatic?: Project) {
  const known = new Map(registered.map(project => [project.projectRef, project]));
  if (automatic) known.set(automatic.projectRef, automatic);
  for (const projectRef of [journal.draftProject, ...journal.sessions.map(session => session.projectRef ?? "")]) {
    if (projectRef !== undefined && !known.has(projectRef)) known.set(projectRef, { projectRef, label: projectRef || "已保存项目", path: "" });
  }
  const ordered = journal.sessions.map((session, index) => ({ session, index, at: (session.turns ?? []).reduce((last, turn) => Math.max(last, Date.parse(turn.createdAt)), 0) }))
    .sort((a, b) => b.at - a.at || b.index - a.index).map(item => item.session);
  const row = (session: CodingSession) => ({ id: session.id, title: session.title, project: known.get(session.projectRef ?? "")!.label, selected: session.id === journal.selected });
  const sessions = ordered.map(row);
  const selectedProject = journal.selected ? journal.sessions.find(session => session.id === journal.selected)?.projectRef ?? "" : journal.draftProject;
  const projectGroups = [...known.values()].map(project => {
    const grouped = ordered.filter(session => (session.projectRef ?? "") === project.projectRef).map(row);
    return { ...project, isDefault: project.projectRef === automatic?.projectRef, selected: project.projectRef === selectedProject, sessions: grouped, hasSessions: grouped.length > 0 };
  });
  return { sessions, projectGroups };
}
type Catalog = ReturnType<typeof groupedSessions> & { projects: string[]; projectOptions: {value: string; label: string}[]; projectDetails: Project[]; defaultProject: string; hasSessions: boolean; selectedSession: string; requestKey: string; configured: boolean; notice: string };
function boundedCatalog(catalog: Catalog) {
  // Keep the selected conversation and most recent user turns inside the SDK reply budget.
  while (Buffer.byteLength(JSON.stringify(catalog)) > 192_000) {
    catalog.notice = "侧栏只显示最近的部分对话与项目，全部记录仍保留。";
    const index = catalog.sessions.findLastIndex(session => !session.selected);
    if (index >= 0) {
      const [removed] = catalog.sessions.splice(index, 1);
      for (const group of catalog.projectGroups) { group.sessions = group.sessions.filter(session => session.id !== removed!.id); group.hasSessions = !!group.sessions.length; }
    } else {
      const index = catalog.projectGroups.findLastIndex(group => !group.selected && !group.hasSessions);
      if (index < 0) throw codingError("too_large", "当前项目显示信息过大，请缩短项目路径或对话标题。");
      const [group] = catalog.projectGroups.splice(index, 1);
      catalog.projects = catalog.projects.filter(ref => ref !== group!.projectRef);
      catalog.projectOptions = catalog.projectOptions.filter(item => item.value !== group!.projectRef);
      catalog.projectDetails = catalog.projectDetails.filter(item => item.projectRef !== group!.projectRef);
    }
  }
  return catalog;
}
export function workbenchCatalog(context: CodingContext) {
  return serializeConversation(async () => {
    const journal = await loadSessions(context);
    await adoptLegacyWorks(context, journal);
    const { registered, automatic, notice } = await catalogProjects(context, journal);
    const { sessions, projectGroups } = groupedSessions(journal, registered, automatic);
    return boundedCatalog({ projects: registered.map(item => item.projectRef), projectOptions: registered.map(item => ({ value: item.projectRef, label: `${item.label} · ${item.path}` })), projectDetails: registered,
      defaultProject: automatic?.projectRef ?? "", projectGroups, sessions, hasSessions: sessions.length > 0, selectedSession: journal.selected ?? "", requestKey: randomUUID(), configured: !!automatic, notice });
  });
}
async function latestPatch(context: CodingContext, workId: string) {
  const work = await readCodingWork(context, workId), result = work.results.at(-1);
  if (!result) return "本轮没有可显示的差异；请结合回复与项目文件核对。";
  const artifact = JSON.parse(await readFile(join(context.dir, "artifacts", `${result.artifactRef}.json`), "utf8")) as { changes?: { patch: string } };
  const patch = artifact.changes?.patch || "本轮没有可显示的差异。";
  return Buffer.byteLength(patch) <= 48_000 ? patch : `${Buffer.from(patch).subarray(0, 48_000).toString("utf8")}\n\n页面差异已省略后续内容，请查看执行记录和项目文件。`;

}
function boundProgress(progress: { sequence: number; text: string }[]) {
  let bytes = 0;
  return progress.slice().reverse().filter(item => { bytes += Buffer.byteLength(JSON.stringify(item)); return bytes <= 16_000; }).reverse();
}
function emptyDetail(project?: Project) {
  return { sessionId: "", workId: "", goal: "新的编码对话", project: project?.projectRef ?? "", projectLabel: project?.label ?? "本机项目", projectPath: project?.path ?? "", status: "准备开始", statusTone: "neutral", canSend: !!project, canStop: false, canRetry: false, stop: project ? "发送你的需求，即可开始编码。" : "选择项目并发送你的需求。", output: "", patch: "", messages: [] as ConversationMessage[], progress: [] as { sequence: number; text: string }[], limited: false, hasQuestions: false, questions: [] as { id: string; title: string; method: string; options: string[]; choices: { questionId: string; label: string }[]; help: string }[], results: [] as { id: string; ref: string; status: string }[], requestKey: randomUUID(), hasEarlier: false, historyBefore: "", historyPage: "" };
}
async function draftDetail(context: CodingContext, journal: CodingSessions) {
  try {
    const projectRef = await initializeDraft(context, journal);
    const project = await conversationProject(context, projectRef);
    return emptyDetail({ projectRef, label: project.projectLabel, path: project.projectPath });
  } catch (error) {
    if (!projectReadError(error)) throw error;
    return { ...emptyDetail(), stop: "默认空间暂不可用，请在侧栏设置有效目录，或新建其他项目的对话。" };
  }
}
async function resolveSession(context: CodingContext, journal: CodingSessions, workId?: string, sessionId?: string) {
  if ([workId, sessionId].some(value => value && !id.safeParse(value).success)) throw codingError("invalid", "请选择有效的对话。");
  await adoptLegacyWorks(context, journal);
  const session = sessionId ? journal.sessions.find(item => item.id === sessionId) : workId ? journal.sessions.find(item => item.workIds.includes(workId)) : journal.sessions.find(item => item.id === journal.selected);
  if (!session && (workId || sessionId)) throw codingError("not_found", "编码对话不存在。");
  if (session && workId && !session.workIds.includes(workId)) throw codingError("conflict", "工作不属于此对话。");
  return session;
}
/** Reads only reconcile receipts/history; they never dispatch a missing start. */
export function workbenchDetail(context: CodingContext, workId = "", sessionId = "", before = "") {
  return serializeConversation(async () => {
    const journal = await loadSessions(context), session = await resolveSession(context, journal, workId, sessionId);
    return session ? detail(context, session, before) : draftDetail(context, journal);
  });
}
async function workMessages(context: CodingContext, session: CodingSession, workId: string, assistant: ConversationMessage[]) {
  const turns = (session.turns ?? []).filter(turn => turn.workId === workId);
  const users: ConversationMessage[] = turns.map(turn => ({ id: turn.key, author: "你", content: turn.text, timestamp: turn.createdAt, status: turn.rejected ? "发送未被接受" : turn.accepted ? "" : "发送结果待核对" }));
  if (!turns.some(turn => turn.kind === "start")) {
    const work = await readCodingWork(context, workId);
    users.unshift({ id: `legacy-${workId}`, author: "你", content: work.start.goal, timestamp: "", status: "历史工作" });
  }
  return [...users, ...assistant].map(message => ({ ...message, id: `${workId}:${message.id}` })).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
function messageParts(message: ConversationMessage): ConversationMessage[] {
  if (Buffer.byteLength(JSON.stringify(message)) <= 64_000) return [message];
  const characters = Array.from(message.content), parts: ConversationMessage[] = [];
  for (let offset = 0; offset < characters.length; offset += 8192) parts.push({ ...message, id: offset ? `${message.id}.part-${offset}` : message.id, content: characters.slice(offset, offset + 8192).join("") });
  return parts;
}
function paginate(history: ConversationMessage[], before: string) {
  const messages = history.flatMap(messageParts);
  const end = before ? messages.findIndex(item => item.id === before) : messages.length;
  if (end < 0) throw codingError("invalid", "历史页引用已失效，请重新打开对话。");
  let start = end, bytes = 0;
  while (start > 0) {
    const size = Buffer.byteLength(JSON.stringify(messages[start - 1]));
    if (bytes + size > 96_000 && start < end) break;
    bytes += size; start--;
  }
  return { messages: messages.slice(start, end), hasEarlier: start > 0, historyBefore: start > 0 ? messages[start]!.id : "" };
}
function executionTone(view?: ExecutionView) {
  if (!view) return "neutral";
  if (view.status === "failed") return "danger";
  if (view.status === "unknown" || view.cancelRequested && !view.stopConfirmed) return "warning";
  return view.status === "completed" && view.stopConfirmed ? "success" : "neutral";
}
function executionState(view?: ExecutionView) {
  return { statusTone: executionTone(view), status: view ? statuses[view.status] : "发送结果待核对", stop: stopText(view), canSend: !!view && (isStopped(view) || view.status === "running" && !view.cancelRequested), canStop: !!view && !view.stopConfirmed && !view.cancelRequested };
}
function pendingQuestions(snapshot?: ExecutionSnapshot) {
  // Answer pending questions one at a time so each native input has an unambiguous draft.
  const questions = (snapshot?.questions.filter(question => question.status === "pending" && Date.parse(question.expiresAt) > Date.now()) ?? []).slice(0, 1);
  return questions.map(question => ({ id: question.requestId, title: question.title, method: question.method, options: question.options, choices: question.options.map(label => ({ questionId: question.requestId, label })), help: question.method === "confirm" ? "请选择是或否" : question.method === "select" ? "请选择一个选项" : "填写你的答复" }));
}
async function resultDetails(context: CodingContext, workId: string) {
  try {
    const work = await readCodingWork(context, workId);
    return { results: work.results.map(item => ({ id: item.resultId, ref: `coding/${item.artifactRef}.json`, status: "执行记录" })), patch: await latestPatch(context, workId) };
  } catch (error) { if ((error as { code?: string }).code !== "not_found") throw error; }
  return { results: [], patch: "" };
}
function currentHistory(history: Awaited<ReturnType<typeof readConversationWork>>["history"], view?: ExecutionView) {
  const progress = boundProgress(history.progress), questions = pendingQuestions(history.snapshot);
  return { ...executionState(view), output: history.snapshot?.finalMessage?.text ?? "", questions, hasQuestions: questions.length > 0, progress, limited: history.limited || progress.length < history.progress.length };
}
function rejectedWork(session: CodingSession, workId: string) {
  return (session.turns ?? []).some(turn => turn.workId === workId && turn.kind === "start" && turn.rejected);
}
function restoreIdleSession(result: ReturnType<typeof emptyDetail>, session: CodingSession) {
  if (!session.selectedWorkId && session.projectRef) Object.assign(result, { canSend: true, status: "准备发送", stop: "上次发送未被接受，可以重新发送。" });
  result.canRetry = (session.turns ?? []).some(pendingTurn); result.canSend &&= !result.canRetry;
}
async function conversationProject(context: CodingContext, projectRef?: string) {
  try {
    const project = (await projects(context)).find(project => project.projectRef === projectRef);
    let selection: ProjectSelection | undefined;
    try { selection = await readProjectSelection(context); }
    catch (error) { if (!projectReadError(error)) throw error; } // Broken default settings must not hide existing conversations.
    const label = selection?.automatic && selection.projectRef === projectRef ? "默认空间" : project?.label;
    return { projectLabel: label ?? "已保存项目", projectPath: project?.path ?? "" };
  } catch (error) {
    // Cached conversations stay readable while the project registry is unavailable.
    if ((error as { code?: string }).code !== "unavailable") throw error;
    return { projectLabel: "已保存项目", projectPath: "" };
  }
}
async function detail(context: CodingContext, session: CodingSession, before = "") {
  const result = { ...emptyDetail(), ...await conversationProject(context, session.projectRef), sessionId: session.id, goal: session.title, project: session.projectRef ?? "", workId: session.selectedWorkId ?? "", historyPage: before };
  const messages: ConversationMessage[] = [];
  for (const workId of session.workIds) {
    if (rejectedWork(session, workId)) {
      messages.push(...await workMessages(context, session, workId, [])); continue;
    }
    const current = workId === session.selectedWorkId;
    const { history, view } = await readConversationWork(context, workId, result.project, !current);
    messages.push(...await workMessages(context, session, workId, history.messages));
    result.limited ||= history.limited;
    if (current) { const state = currentHistory(history, view); state.limited ||= result.limited; Object.assign(result, state); }
  }
  Object.assign(result, paginate(messages, before));
  restoreIdleSession(result, session);
  if (result.workId) Object.assign(result, await resultDetails(context, result.workId));
  // Leave room in the routed response for the complete transcript page and native question.
  if (Buffer.byteLength(JSON.stringify(result)) > 240_000) Object.assign(result, { output: "", patch: "", progress: [], results: [], limited: true });
  return result;
}
export function workbenchCommand(context: CodingContext, raw: unknown) {
  return serializeConversation(async () => {
    const args = parseConversationCommand(raw), journal = await loadSessions(context);
    const current = await resolveSession(context, journal, args["work-id"], args["session-id"]);
    const session = await applyConversationCommand(context, args, journal, current, { list: async () => (await projects(context)).map(project => project.projectRef), default: async path => (await defaultProject(context, path)).projectRef });
    return session ? detail(context, session) : draftDetail(context, journal);
  });
}
