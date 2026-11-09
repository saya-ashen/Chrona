import { randomUUID } from "node:crypto";
import type { Caller } from "chrona";

// This client owns presentation only. Coding validates business transitions,
// receipts, stale questions and exact execution identity through its protocol.
export type Call = <T>(target: string, args: Record<string, unknown>) => Promise<T>;
const identity = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
// UI inputs are deliberately strings; the first round's empty work ID is
// translated to Coding's null. Ordinary SDK apps need no package dependencies.
const fields = {
  "register-project": ["action", "request-key", "path"],
  "default-project": ["action", "request-key", "project"],
  create: ["action", "request-key", "project", "title"],
  send: ["action", "request-key", "project", "session-id", "work-id", "text"],
  answer: ["action", "request-key", "project", "session-id", "work-id", "run-id", "attempt-id", "question", "text"],
  stop: ["action", "request-key", "project", "session-id", "work-id", "run-id", "attempt-id"],
  retry: ["action", "request-key", "session-id", "original"],
} as const;
function checked<K extends string>(args: Record<string, unknown>, required: readonly K[], optional: readonly string[] = [], empty: readonly string[] = []): Record<K, string> & Record<string, string | undefined> {
  const allowed = [...required, ...optional];
  for (const key of Object.keys(args)) if (!allowed.includes(key)) invalid(`未知参数 ${key}`);
  for (const key of required) if (args[key] === undefined) invalid(`缺少参数 ${key}`);
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== "string") invalid(`${key} 必须为文本`);
    const str = value as string;
    if (!str && empty.includes(key)) continue;
    const max = key === "text" ? (args.action === "answer" ? 8000 : 20_000) : key === "path" ? 4096 : key === "title" ? 200 : key === "before" ? 1024 : 100;
    if (str.includes("\0") || str.length > max || (!str.trim() && key !== "before" && !(key === "text" && args.action === "answer"))) invalid(`${key} 长度无效`);
    if (!["action", "path", "title", "text", "before"].includes(key) && !identity.test(str)) invalid(`${key} 格式无效`);
  }
  return args as Record<K, string> & Record<string, string | undefined>;
}
function commandInput(args: Record<string, unknown>) {
  const action = args.action;
  if (typeof action !== "string" || !Object.hasOwn(fields, action)) invalid("未知操作");
  const name = action as keyof typeof fields;
  const optional = ["register-project", "default-project", "retry"].includes(name) ? ["project", "session-id"] : [];
  return checked(args, fields[name], optional, ["project", "session-id", ...(name === "send" ? ["work-id"] : [])]);
}
export type Receipt = { requestKey: string; op: string; status: "pending" | "accepted" | "rejected"; sessionId?: string; workId?: string; value?: unknown; error?: { code: string; message: string } };
type Project = { projectRef: string; path: string; label: string };
type Session = { id: string; title: string; projectRef: string; currentWorkId: string | null; workIds: string[]; turns: { key: string; kind: string; workId: string; text: string; createdAt: string; accepted: boolean }[] };
type View = { workId: string; runId: string; attemptId: string; status: string; cancelRequested: boolean; stopConfirmed: boolean };
type Question = { requestId: string; title: string; method: string; options: string[]; status: string };
type Snapshot = View & { questions: Question[]; missing: boolean; finalMessage: { text: string; truncated: boolean } | null };
type Message = { id: string; author: string; content: string; timestamp: string; status: string };
type Event = { seq: number; payload: Record<string, unknown> & { type: string } };
type EventPage = { events: Event[]; gap: boolean; snapshotRequired?: boolean; highWatermark?: number };
const isTooLarge = (error: unknown) => (error as { code?: unknown } | null)?.code === "too_large";
async function readEvents(coding: <T>(command: Record<string, unknown>) => Promise<T>, target: Record<string, string>) {
  let limited = false;
  for (const limit of [100, 25, 5, 1]) {
    try { return { page: await coding<EventPage>({ op: "events", ...target, limit }), limited }; }
    catch (error) { if (!isTooLarge(error)) throw error; limited = true; }
  }
  return { page: { events: [], gap: false } as EventPage, limited };
}
type Result = { resultId: string; artifactRef: string; accepted: boolean; checks: { command: string; outcome: string; exitCode: number | null }[] };
const statuses: Record<string, string> = { queued: "排队中", running: "正在执行", completed: "已完成", failed: "执行失败", cancelled: "已停止", unknown: "状态待核对" };
function invalid(message: string): never { throw Object.assign(new Error(message), { code: "invalid" }); }
export function authorize(caller?: Caller) {
  // The router supplies and verifies the actual current module identity. Arguments
  // cannot impersonate Web, an owner, or another client.
  if (caller?.kind !== "owner" && !(caller?.kind === "module" && caller.module === "web")) throw Object.assign(new Error("仅所有者或已认证网页可使用编码工作台。"), { code: "forbidden" });
}
function eventText(event: Event) {
  const p = event.payload;
  switch (p.type) {
    case "tool_started": return `正在调用 ${p.tool}`;
    case "tool_finished": return `${p.isError ? "工具失败" : "工具完成"} ${p.tool}：${p.summary}`;
    case "state": return statuses[String(p.status)] ?? String(p.status);
    case "question": return "等待你的答复";
    case "gap": return "部分进度已省略，请核对最终回复与项目文件。";
    default: return "";
  }
}
export function createClient(call: Call) {
  const coding = <T>(command: Record<string, unknown>) => call<T>("coding.command", { input: JSON.stringify(command) });
  return {
    async catalog(args: Record<string, unknown>) {
      const { project, after } = checked(args, [], ["project", "after"], ["project", "after"]);
      const projects = await coding<{ projects: Project[]; defaultProjectRef: string | null }>({ op: "projects.list" });
      const sessions = await coding<{ sessions: Session[]; after?: string | null }>({ op: "conversations.list", ...(project ? { projectRef: project } : {}), ...(after ? { after } : {}) });
      return { projects: projects.projects.map(p => ({ ...p, isDefault: p.projectRef === projects.defaultProjectRef })), sessions: sessions.sessions.map(s => ({ id: s.id, title: s.title, projectRef: s.projectRef })), after: sessions.after ?? "", notice: projects.projects.length ? "选择项目，再打开或新建对话。" : "添加一个已有项目目录，开始编码对话。" };
    },
    async work(args: Record<string, unknown>) {
      const input = checked(args, ["session-id"], ["before"]), sessionId = input["session-id"];
      const detail = await coding<{ session: Session; view: View | null; history: { messages: Message[]; hasEarlier: boolean; before: string | null; limited: boolean; snapshot?: Snapshot | null } | null }>({ op: "conversations.get", sessionId, ...(input.before ? { before: input.before } : {}) });
      const view = detail.view;
      let snapshot: Snapshot | null = detail.history?.snapshot ?? null, events: EventPage = { events: [], gap: false }, results: Result[] = [], limited = false;
      if (view) {
        const target = { sessionId, workId: view.workId, runId: view.runId, attemptId: view.attemptId };
        try { snapshot = await coding<Snapshot>({ op: "snapshot", ...target }); }
        catch (error) { if (!isTooLarge(error)) throw error; limited = true; }
        const progress = await readEvents(coding, target);
        events = progress.page; limited ||= progress.limited;
        results = (await coding<{ results: Result[] }>({ op: "results", sessionId, workId: view.workId })).results;
      }
      const current = snapshot ?? view;
      const stopped = !!current?.stopConfirmed;
      const questions = (snapshot?.questions ?? []).filter(q => q.status === "pending").map(q => ({ id: q.requestId, title: q.title, help: "请答复当前问题后继续。", method: q.method, choices: q.options.map(label => ({ questionId: q.requestId, label })) }));
      const messages = detail.history?.messages ?? detail.session.turns.filter(t => t.accepted).map(t => ({ id: t.key, author: "你", content: t.text, timestamp: t.createdAt, status: "" }));
      if (!detail.history && snapshot?.finalMessage) messages.push({ id: "final", author: "编码助手", content: snapshot.finalMessage.text, timestamp: "", status: snapshot.finalMessage.truncated ? "回复可能不完整" : "" });
      return {
        sessionId, project: detail.session.projectRef, goal: detail.session.title, workId: view?.workId ?? null, runId: view?.runId ?? "", attemptId: view?.attemptId ?? "",
        status: current ? statuses[current.status] ?? current.status : "尚未开始", statusTone: questions.length ? "warning" : current?.status === "failed" ? "danger" : stopped ? "success" : "neutral",
        stop: current?.cancelRequested && !stopped ? "已请求停止，正在等待确认。" : stopped ? "本轮已结束，可以继续对话。" : view ? "正在直接编辑项目文件。" : "发送消息开始第一轮。",
        canSend: !current || (stopped && ["completed", "failed", "cancelled"].includes(current.status)) || (current.status === "running" && !current.cancelRequested), canStop: !!current && !stopped && !current.cancelRequested,
        hasQuestions: questions.length > 0, questions, messages,
        historyBefore: detail.history?.before ?? "", hasEarlier: detail.history?.hasEarlier ?? false, historyPage: input.before ?? "",
        limited: limited || !!detail.history?.limited || !!snapshot?.missing || events.gap || !!events.snapshotRequired || (events.highWatermark ?? 0) > (events.events.at(-1)?.seq ?? 0),
        progress: events.events.map(e => ({ sequence: e.seq, text: eventText(e) })).filter(e => e.text),
        results: results.map(r => ({ id: r.resultId, ref: r.artifactRef, accepted: r.accepted, checks: r.checks.map(c => `${c.command}：${c.outcome}${c.exitCode === null ? "" : ` (${c.exitCode})`}`).join("\n") })),
      };
    },
    async result(args: Record<string, unknown>) {
      const input = checked(args, ["session-id", "work-id", "result-id"]);
      const payload = await coding<{ base64: string; mime: string }>({ op: "read-result", sessionId: input["session-id"], workId: input["work-id"], resultId: input["result-id"] });
      // Decode only the scoped immutable artifact; never resolve an arbitrary
      // content path or execute anything found inside a result.
      if (payload.mime !== "application/json" || payload.base64.length > 270_000) invalid("成果格式或大小无效");
      const artifact = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.base64), char => char.charCodeAt(0)))) as { finalMessage?: { text?: string; truncated?: boolean }; missing?: boolean; changes?: { status?: string; reason?: string; patch?: string; files?: { path: string; text?: string; omitted?: string }[] } };
      return { sessionId: input["session-id"], workId: input["work-id"], resultId: input["result-id"], message: artifact.finalMessage?.text ?? "", patch: artifact.changes?.patch ?? "", limited: !!artifact.missing || !!artifact.finalMessage?.truncated || (!!artifact.changes && artifact.changes.status !== "complete"), files: (artifact.changes?.files ?? []).map(file => ({ path: file.path, text: file.text ?? "", omitted: file.omitted ?? "" })) };
    },
    async command(args: Record<string, unknown>) {
      try {
        const input = commandInput(args);
        const requestKey = input["request-key"];
        let command: Record<string, unknown>;
        const sessionId = "session-id" in input ? input["session-id"] ?? "" : "";
        const project = input.project ?? "";
        switch (input.action) {
          case "register-project": command = { op: "projects.register", requestKey, path: input.path }; break;
          case "default-project": command = { op: "projects.default", requestKey, projectRef: input.project }; break;
          case "create": command = { op: "conversations.create", requestKey, projectRef: input.project, title: input.title }; break;
          case "send": command = { op: "round.send", requestKey, sessionId, workId: input["work-id"] || null, text: input.text }; break;
          case "retry": command = { op: "round.retry", requestKey, sessionId, originalRequestKey: input.original }; break;
          case "stop": case "answer": command = { op: `round.${input.action}`, requestKey, sessionId, workId: input["work-id"], runId: input["run-id"], attemptId: input["attempt-id"], ...(input.action === "answer" ? { questionId: input.question, text: input.text } : {}) }; break;
          default: return invalid("未知操作");
        }
        const { receipt } = await coding<{ receipt: Receipt }>(command);
        const value = receipt.value as { id?: string; projectRef?: string } | undefined;
        return { project: receipt.status === "accepted" && input.action === "register-project" ? value!.projectRef! : project, sessionId: receipt.status === "accepted" && input.action === "create" ? value!.id! : receipt.status === "accepted" && input.action === "register-project" ? "" : sessionId, ...receiptView(input.action === "retry" && receipt.status === "accepted" ? (receipt.value as { receipt: Receipt }).receipt : receipt) };
      } catch (error) {
        // Protocol-defined validation/admission failures are definitive. A lost
        // transport outcome (or key conflict) stays an error for receipt recovery.
        if (!(error instanceof Error) || !("code" in error) || !["invalid", "not_found", "forbidden", "capacity", "too_large"].includes(String(error.code))) throw error;
        const key = typeof args["request-key"] === "string" && identity.test(args["request-key"]) ? args["request-key"] : randomUUID();
        return { project: typeof args.project === "string" ? args.project : "", sessionId: typeof args["session-id"] === "string" ? args["session-id"] : "", ...receiptView({ requestKey: key, op: "", status: "rejected", error: { code: String(error.code), message: error.message } }) };
      }
    },
    async receipt(args: Record<string, unknown>) {
      const input = checked(args, ["request-key"], ["project", "session-id"], ["project", "session-id"]);
      const { receipt } = await coding<{ receipt: Receipt }>({ op: "receipt", requestKey: input["request-key"] });
      const value = receipt.value as { id?: string; projectRef?: string } | undefined;
      const accepted = receipt.status === "accepted";
      return { project: accepted && receipt.op === "projects.register" ? value!.projectRef! : input.project ?? "", sessionId: accepted && receipt.op === "conversations.create" ? value!.id! : accepted && receipt.op === "projects.register" ? "" : input["session-id"] ?? "", ...receiptView(receipt) };
    },
  };
}
export function receiptView(receipt: Receipt) {
  return { requestKey: receipt.requestKey, nextRequestKey: receipt.status === "pending" ? receipt.requestKey : randomUUID(), status: receipt.status, message: receipt.error?.message ?? (receipt.status === "pending" ? "操作结果尚待核对。请先查询回执；可重试的操作将显示核对重试按钮。" : receipt.status === "rejected" ? "操作未被接受。" : "已完成"), retryable: receipt.status === "pending" && ["round.send", "round.answer", "round.stop", "accept"].includes(receipt.op) };
}
