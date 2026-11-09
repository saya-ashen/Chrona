import { CODING_WEB_COMPONENTS } from "./components";
const state = (path: string) => ({ $state: path });
const bind = (path: string) => ({ $bindState: path });
const item = (path: string) => ({ $item: path });
const node = (type: string, props: Record<string, unknown>, children: string[] = []) => ({ type, props, children });
const local = { project: "", sessionId: "", title: "", message: "", answer: "", path: "", before: "", listAfter: "", tab: "chat", sidebarOpen: false };
const retained = Object.fromEntries(Object.keys(local).map(key => [key, state(`/local/${key}`)]));
const setLocal = (changes: Record<string, unknown>) => ({ action: "setState", params: { statePath: "/local", value: { ...retained, ...changes } } });
const flag = (condition: unknown) => ({ $cond: condition, $then: true, $else: false });
const pending = { $state: "/command/status", eq: "pending" };
const currentDetail = { $state: "/detail/sessionId", eq: state("/local/sessionId") };
const disabledCondition = { $or: [pending, { $state: "/transportFailed" }, { $state: "/command/nextRequestKey", not: true }] };
const disabled = flag(disabledCondition);
const target = { project: state("/local/project"), "session-id": state("/local/sessionId"), "work-id": state("/detail/workId"), "run-id": state("/detail/runId"), "attempt-id": state("/detail/attemptId") };
const acceptedClear = (field: string, eligible: boolean) => eligible ? ({ $cond: { $and: [{ $state: "/transportFailed", not: true }, { $state: "/command/status", eq: "accepted" }, { $state: `/local/${field}`, eq: state(`/submitted/${field}`) }] }, $then: "", $else: state(`/local/${field}`) }) : state(`/local/${field}`);
const afterCommand = (action: string) => setLocal({
  project: { $cond: { $state: "/transportFailed" }, $then: state("/local/project"), $else: state("/command/project") },
  sessionId: { $cond: { $state: "/transportFailed" }, $then: state("/local/sessionId"), $else: state("/command/sessionId") },
  message: acceptedClear("message", action === "send"), answer: acceptedClear("answer", action === "answer"), before: "", listAfter: "",
});
const command = (action: string, args: Record<string, unknown>) => [
  { action: "setState", params: { statePath: "/transportFailed", value: false } },
  { action: "setState", params: { statePath: "/submitted", value: state("/local") } },
  { action: "call", params: { tool: "ui-command", args: { action, ...(action === "retry" ? {} : { "request-key": state("/command/nextRequestKey") }), ...args }, result: "/command", reload: false }, onError: { set: { "/transportFailed": true } } },
  afterCommand(action),
];
const button = (label: string, action: string, args: Record<string, unknown>, props: Record<string, unknown> = {}) => ({ ...node("Button", { label, disabled, ...props }), on: { press: command(action, args) } });
const answer = (text: unknown) => ({ ...target, question: item("id"), text });
const sendArgs = { project: state("/local/project"), "session-id": state("/local/sessionId"), "work-id": { $cond: { $state: "/detail/workId" }, $then: state("/detail/workId"), $else: "" }, text: state("/local/message") };
const cannotSend = flag({ $or: [disabledCondition, { $state: "/detail/canSend", eq: false }, { $state: "/detail/sessionId", neq: state("/local/sessionId") }] });
export const PAGE = {
  id: "main", title: "编码", layout: "workspace" as const, components: CODING_WEB_COMPONENTS,
  data: {
    command: { tool: "ui-request" },
    catalog: { tool: "ui-catalog", args: { project: state("/local/project"), after: state("/local/listAfter") }, refresh: 5 },
    detail: { tool: "ui-work", args: { "session-id": state("/local/sessionId"), before: state("/local/before") }, refresh: 5 },
  },
  spec: { root: "workspace", state: { local, detail: { workId: null, goal: "选择项目，开始对话", status: "尚未开始", statusTone: "neutral", stop: "", messages: [], questions: [], results: [], progress: [] } }, elements: {
    workspace: { ...node("Workspace", { title: "编码工作台", description: "把想法交代清楚，把成果带回来。", sidebarLabel: "项目与对话", mainLabel: "编码对话", mobileSidebarOpen: bind("/local/sidebarOpen") }, ["header", "receipt", "recovery", "welcome", "tabs", "transcript", "results", "composer"]), slots: { sidebar: ["sidebarScroll"] } },
    sidebarScroll: node("ScrollArea", { label: "项目与对话" }, ["sidebar"]),
    sidebar: node("Stack", { gap: "md" }, ["projects", "projectList", "sessions", "sessionList", "moreSessions", "firstSessions", "newConversation", "register", "notice"]),
    projects: node("Heading", { text: "项目", level: "h3" }),
    projectList: { ...node("Stack", { gap: "none" }, ["projectOption"]), repeat: { statePath: "/catalog/projects", key: "projectRef" } },
    projectOption: { ...node("ActionOption", { label: item("label"), description: item("path"), selected: flag({ $item: "projectRef", eq: state("/local/project") }), compact: true, disabled }), on: { press: setLocal({ project: item("projectRef"), sessionId: "", before: "", listAfter: "", sidebarOpen: false }) } },
    sessions: node("Heading", { text: "对话", level: "h3" }),
    sessionList: { ...node("Stack", { gap: "none" }, ["sessionOption"]), repeat: { statePath: "/catalog/sessions", key: "id" } },
    sessionOption: { ...node("ActionOption", { label: item("title"), selected: flag({ $item: "id", eq: state("/local/sessionId") }), compact: true, disabled }), on: { press: setLocal({ project: item("projectRef"), sessionId: item("id"), before: "", tab: "chat", sidebarOpen: false }) } },
    moreSessions: { ...node("Button", { label: "下一页对话", variant: "secondary", disabled }), visible: { $state: "/catalog/after" }, on: { press: setLocal({ listAfter: state("/catalog/after") }) } },
    firstSessions: { ...node("Button", { label: "回到第一页", variant: "secondary", disabled }), visible: { $state: "/local/listAfter" }, on: { press: setLocal({ listAfter: "" }) } },
    newConversation: { ...node("Panel", { tone: "muted" }, ["title", "create", "default"]), visible: { $state: "/local/project" } },
    title: node("Input", { label: "新对话标题", name: "title", value: bind("/local/title") }),
    create: button("新建对话", "create", { project: state("/local/project"), title: state("/local/title") }),
    default: button("设为默认项目", "default-project", { project: state("/local/project"), "session-id": state("/local/sessionId") }, { variant: "secondary" }),
    register: node("Collapsible", { title: "＋ 添加项目", defaultOpen: false }, ["path", "registerButton"]),
    path: node("Input", { label: "已有目录的绝对路径", name: "path", placeholder: "/home/me/my-project", value: bind("/local/path") }),
    registerButton: button("添加项目", "register-project", { project: state("/local/project"), "session-id": state("/local/sessionId"), path: state("/local/path") }),
    notice: node("Text", { text: state("/catalog/notice"), variant: "caption" }),
    header: node("WorkspaceHeader", { title: state("/detail/goal"), status: state("/detail/status"), statusTone: state("/detail/statusTone"), subtitle: state("/detail/stop") }),
    receipt: { ...node("Text", { text: state("/command/message"), variant: "muted" }), visible: { $state: "/command/message" } },
    recovery: { ...node("Panel", { tone: "question" }, ["inspect", "retry"]), visible: { $or: [pending, { $state: "/transportFailed" }] } },
    inspect: { ...node("Button", { label: "查询操作回执", variant: "secondary" }), on: { press: [
      { action: "setState", params: { statePath: "/transportFailed", value: false } },
      { action: "call", params: { tool: "ui-receipt", args: { "request-key": state("/command/nextRequestKey"), project: state("/local/project"), "session-id": state("/local/sessionId") }, result: "/command", reload: false }, onError: { set: { "/transportFailed": true } } },
      afterCommand("inspect"),
    ] } },
    retry: { ...button("核对并重试", "retry", { project: state("/local/project"), "session-id": state("/local/sessionId"), original: state("/command/requestKey") }, { disabled: false, variant: "secondary" }), visible: { $state: "/command/retryable" } },
    tabs: node("ViewTabs", { items: [{ value: "chat", label: "交流" }, { value: "result", label: "成果" }], value: bind("/local/tab") }),
    transcript: { ...node("ScrollArea", { label: "对话消息", follow: true }, ["earlier", "latest", "messages", "limited", "questions", "progress"]), visible: { $and: [{ $state: "/local/tab", eq: "chat" }, currentDetail] } },
    welcome: { ...node("Panel", { tone: "muted" }, ["welcomeText"]), visible: { $state: "/local/sessionId", not: true } },
    welcomeText: node("Text", { text: "添加或选择项目，新建对话后描述你的需求。你也可以打开已有对话继续交流。" }),
    earlier: { ...node("Button", { label: "查看更早的消息", variant: "secondary" }), visible: { $state: "/detail/hasEarlier" }, on: { press: setLocal({ before: state("/detail/historyBefore") }) } },
    latest: { ...node("Button", { label: "回到最新消息", variant: "secondary" }), visible: { $state: "/local/before" }, on: { press: setLocal({ before: "" }) } },
    messages: { ...node("Stack", { gap: "none" }, ["messageItem"]), repeat: { statePath: "/detail/messages", key: "id" } },
    messageItem: node("Message", { author: item("author"), time: item("timestamp"), tone: { $cond: { $item: "author", eq: "你" }, $then: "user", $else: "default" } }, ["messageBody", "messageStatus"]),
    messageBody: node("Markdown", { content: item("content") }),
    messageStatus: { ...node("Text", { text: item("status"), variant: "caption" }), visible: item("status") },
    limited: { ...node("Text", { text: "部分进度或回复缺失、已过期或已省略，请结合项目文件核对。", variant: "muted" }), visible: { $state: "/detail/limited" } },
    questions: { ...node("Stack", { gap: "md" }, ["questionCard"]), repeat: { statePath: "/detail/questions", key: "id" } },
    questionCard: { ...node("coding-web:QuestionCard", { title: item("title"), help: item("help"), confirm: flag({ $item: "method", eq: "confirm" }), select: flag({ $item: "method", eq: "select" }), input: flag({ $or: [{ $item: "method", eq: "input" }, { $item: "method", eq: "editor" }] }), disabled, choices: item("choices"), answer: bind("/local/answer") }), on: {
      yes: command("answer", answer("是")), no: command("answer", answer("否")), answer: command("answer", answer(state("/local/answer"))), choose: command("answer", { ...target, question: item("questionId"), text: item("label") }),
    } },
    progress: node("Collapsible", { title: "执行进度", defaultOpen: false }, ["events"]),
    events: { ...node("Stack", { gap: "sm" }, ["eventText"]), repeat: { statePath: "/detail/progress", key: "sequence" } },
    eventText: node("CollapsedText", { content: item("text"), limit: 240 }),
    results: { ...node("ScrollArea", { label: "成果与执行记录" }, ["resultHelp", "recordList", "openedResult"]), visible: { $and: [{ $state: "/local/tab", eq: "result" }, currentDetail] } },
    resultHelp: node("Text", { text: "修改直接保存在项目目录。这里显示保存的成果引用和检查结果。", variant: "muted" }),
    recordList: { ...node("Stack", { gap: "md" }, ["record"]), repeat: { statePath: "/detail/results", key: "id" } },
    record: node("Panel", { tone: "default" }, ["recordRef", "checks", "readResult"]),
    readResult: { ...node("Button", { label: "查看成果", variant: "secondary" }), on: { press: { action: "call", params: { tool: "ui-result", args: { "session-id": state("/local/sessionId"), "work-id": state("/detail/workId"), "result-id": item("id") }, result: "/openedResult", reload: false } } } },
    openedResult: { ...node("Stack", { gap: "md" }, ["resultMessage", "resultLimited", "resultPatch", "resultFiles"]), visible: { $and: [{ $state: "/openedResult/sessionId", eq: state("/local/sessionId") }, { $state: "/openedResult/workId", eq: state("/detail/workId") }] } },
    resultMessage: node("Markdown", { content: state("/openedResult/message") }),
    resultLimited: { ...node("Text", { text: "此成果包含缺失或省略内容，请结合项目文件核对。", variant: "muted" }), visible: { $state: "/openedResult/limited" } },
    resultPatch: node("CodeDiff", { diff: state("/openedResult/patch") }),
    resultFiles: { ...node("Stack", { gap: "sm" }, ["resultFile"]), repeat: { statePath: "/openedResult/files", key: "path" } },
    resultFile: node("Collapsible", { title: item("path"), defaultOpen: false }, ["resultFileText", "resultFileOmission"]),
    resultFileText: node("Preformatted", { text: item("text") }),
    resultFileOmission: { ...node("Text", { text: item("omitted"), variant: "muted" }), visible: item("omitted") },
    recordRef: node("Text", { text: item("ref") }),
    checks: node("Preformatted", { text: item("checks") }),
    composer: { ...node("coding-web:ConversationComposer", { disabled: cannotSend }, ["message", "clearDraft"]), visible: { $and: [{ $state: "/local/sessionId" }, { $state: "/local/tab", eq: "chat" }, currentDetail] }, slots: { actions: ["stop", "send"] }, on: { submit: command("send", sendArgs) } },
    message: node("Textarea", { label: "消息", name: "message", rows: 2, value: bind("/local/message"), placeholder: "描述你的需求，或继续上一轮对话…" }),
    clearDraft: { ...node("Button", { label: "清空草稿", variant: "secondary" }), on: { press: setLocal({ message: "", answer: "" }) } },
    stop: { ...button("停止", "stop", target, { variant: "secondary" }), visible: { $state: "/detail/canStop" } },
    send: button("发送", "send", sendArgs, { disabled: cannotSend }),
  } },
};
