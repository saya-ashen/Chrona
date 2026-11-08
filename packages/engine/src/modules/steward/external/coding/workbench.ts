import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { executionIdSchema, type ExecutionSnapshot, type ExecutionEventPage, type ExecutionEventPayload, type WorkLocation } from "./contract.js";
import { callAgent } from "./agent";
import { codingError, readCodingWork } from "./storage";
import type { CodingContext } from "./types";
import { createCodingWork, getCodingWork, listCodingWorks, sendCodingWork, answerCodingWork, cancelCodingWork } from "./work";
import { acceptCodingResult, listCodingResults } from "./results";

const id = executionIdSchema;
function progressText(payload: ExecutionEventPayload): string {
  switch (payload.type) {
    case "message": return payload.text;
    case "text_delta": return payload.delta;
    case "tool_started": return `正在调用 ${payload.tool}：${payload.display.path ?? payload.display.command ?? ""}`;
    case "tool_finished": return `${payload.isError ? "工具失败" : "工具完成"} ${payload.tool}：${payload.summary}`;
    case "question": return `等待答复：${payload.question.title}`;
    case "state": return statuses[payload.status];
    case "gap": return "部分进度已省略，请核对最终成果。";
    case "usage": return `用量：输入 ${payload.input}，输出 ${payload.output}`;
  }
}
const statuses = { queued: "排队中", running: "正在执行", completed: "已完成", failed: "执行失败", cancelled: "已取消", unknown: "状态未知，需核对停止证据" };
async function serverLocations(context: CodingContext) {
  try { return await callAgent<{ locations: WorkLocation[] }>(context, "locations", { limit: 100 }); }
  catch (error) {
    if ((error as { code?: string }).code !== "unavailable") throw error;
    return { locations: [] };
  }
}
export async function workbenchCatalog(context: CodingContext) {
  const [locations, list] = await Promise.all([
    serverLocations(context),
    listCodingWorks(context, { limit: 100 }),
  ]);
  const projects = [...new Set(locations.locations.filter(item => item.kind === "server" && item.online).map(item => item.projectRef))];
  const works = await Promise.all(list.works.map(async view => ({ id: view.workId, goal: (await readCodingWork(context, view.workId)).start.goal, status: statuses[view.status] })));
  return { projects, hasWorks: works.length > 0, workIds: works.map(item => item.id), works, requestKey: randomUUID(), configured: projects.length > 0,
    notice: projects.length ? "在已授权的服务器项目中执行；默认最多 10 分钟、30 次工具调用。" : "尚无在线的服务器项目。请先配置项目访问权限和执行位置，再刷新此页。" };
}
const stopText = (view: { stopConfirmed: boolean; cancelRequested: boolean }) => view.stopConfirmed ? "执行已停止。成果和项目文件会保留。" : view.cancelRequested ? "已请求停止，尚未确认；请勿重跑或清理目录。" : "执行尚未停止。";
const questionHelp = (question: ExecutionSnapshot["questions"][number]) => question.method === "confirm" ? "填写“是”或“否”" : question.method === "select" ? `填写一个完整选项：${question.options.join(" / ")}` : "填写你的答复";
async function latestPatch(context: CodingContext, result: { artifactRef: string } | undefined) {
  if (!result) return "尚无可显示的代码差异。请结合最终回复与项目文件核对成果。";
  const artifact = JSON.parse(await readFile(join(context.dir, "artifacts", `${result.artifactRef}.json`), "utf8")) as { changes?: { patch: string } };
  return artifact.changes?.patch || "本成果没有可显示的代码差异。";
}
export async function workbenchDetail(context: CodingContext, workId: string) {
  if (!id.safeParse(workId).success) throw codingError("invalid", "请选择有效的工作。");
  const view = await getCodingWork(context, { workId });
  const target = { workId, runId: view.runId, attemptId: view.attemptId };
  const [snapshot, events, results] = await Promise.all([
    callAgent<ExecutionSnapshot>(context, "snapshot", target),
    callAgent<ExecutionEventPage>(context, "events", { ...target, limit: 100, waitMs: 0 }),
    listCodingResults(context, { workId }),
  ]);
  const questions = snapshot.questions.filter(question => question.status === "pending");
  return { workId, goal: (await readCodingWork(context, workId)).start.goal, project: view.projectRef, status: statuses[view.status],
    canSend: view.status === "running" && !view.cancelRequested, canStop: !view.stopConfirmed,
    stop: stopText(view),
    output: snapshot.finalMessage?.text ?? "尚无最终回复。运行过程请查看下方进度。",
    patch: await latestPatch(context, results.results.at(-1)),
    progress: events.events.map(event => ({ sequence: event.seq, text: progressText(event.payload) })),
    limited: events.gap || events.snapshotRequired || snapshot.missing || snapshot.highWatermark > (events.events.at(-1)?.seq ?? 0),
    hasQuestions: questions.length > 0, questions: questions.map(question => ({ id: question.requestId, title: question.title, help: questionHelp(question) })),
    questionIds: questions.map(question => question.requestId), results: results.results.map(result => ({ id: result.resultId, ref: `coding/${result.artifactRef}.json`, status: result.accepted ? "已接受" : "待验收" })),
    resultIds: results.results.filter(result => !result.accepted).map(result => result.resultId) };
}
type Command = { action: string; "request-key": string; "work-id"?: string; project?: string; text?: string; question?: string; result?: string };
function checkField(key: string, value: unknown) {
  if (typeof value !== "string" || value.length > (key === "text" ? 20_000 : 128)) throw codingError("invalid", "输入内容过长或格式无效。");
  if (!["text", "action"].includes(key) && !id.safeParse(value).success) throw codingError("invalid", "工作引用无效。");
}
function command(raw: unknown): Command {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw codingError("invalid", "请检查操作参数。");
  const args = raw as Record<string, unknown>;
  const allowed = ["action", "request-key", "work-id", "project", "text", "question", "result"];
  if (Object.keys(args).some(key => !allowed.includes(key)) || !["create", "send", "stop", "answer", "accept"].includes(String(args.action))) throw codingError("invalid", "未知工作台操作。");
  for (const [key, value] of Object.entries(args)) checkField(key, value);
  if (String(args["request-key"]).length > 100) throw codingError("invalid", "操作标识过长。");
  if (!args["request-key"]) throw codingError("invalid", "缺少操作标识，请刷新页面。");
  return args as Command;
}
export async function workbenchCommand(context: CodingContext, raw: unknown) {
  const args = command(raw), key = args["request-key"];
  if (args.action === "create") return createFromPage(context, args);
  if (!args["work-id"]) throw codingError("invalid", "请先打开一项工作。");
  const view = await getCodingWork(context, { workId: args["work-id"] });
  const target = { workId: view.workId, runId: view.runId, attemptId: view.attemptId, commandKey: key };
  if (args.action === "send") await sendCodingWork(context, { ...target, text: args.text?.trim() ?? "" });
  if (args.action === "stop") await cancelCodingWork(context, target);
  if (args.action === "accept") {
    if (!args.result) throw codingError("invalid", "请选择要接受的成果版本。");
    await acceptCodingResult(context, { workId: view.workId, resultId: args.result, commandKey: key });
  }
  if (args.action === "answer") await answerQuestion(context, target, args.question, args.text ?? "");
  return workbenchDetail(context, view.workId);
}
async function createFromPage(context: CodingContext, args: Command) {
  if (!args.project || !args.text?.trim()) throw codingError("invalid", "请选择项目并填写工作目标。");
  const key = args["request-key"];
  const view = await createCodingWork(context, { workId: `web-${key}`, commandKey: `web-${key}`, projectRef: args.project, goal: args.text.trim(), budget: { timeoutMs: 600_000, maxToolCalls: 30 } });
  return workbenchDetail(context, view.workId);
}
async function answerQuestion(context: CodingContext, target: { workId: string; runId: string; attemptId: string; commandKey: string }, requestId: string | undefined, text: string) {
  const snapshot = await callAgent<ExecutionSnapshot>(context, "snapshot", { workId: target.workId, runId: target.runId, attemptId: target.attemptId });
  const question = snapshot.questions.find(item => item.requestId === requestId && item.status === "pending");
  if (!question) throw codingError("conflict", "该问题已不再等待答复，请刷新。");
  let value: string | number | boolean = text;
  if (question.method === "confirm") {
    if (!["是", "否"].includes(text.trim())) throw codingError("invalid", "请填写“是”或“否”。");
    value = text.trim() === "是";
  }
  if (question.method === "select") {
    value = question.options.indexOf(text.trim());
    if (value < 0) throw codingError("invalid", "请填写一个完整选项。");
  }
  await answerCodingWork(context, { ...target, requestId: question.requestId, answer: { decision: "submit", value } });
}
