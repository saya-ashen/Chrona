import { CODING_COMPONENTS } from "./components";
// The coding module owns the conversation. Shared components only render its state/actions.
const state = (path: string) => ({ $state: path });
const bind = (path: string) => ({ $bindState: path });
const item = (path: string) => ({ $item: path });
const node = (type: string, props: Record<string, unknown>, children: string[] = []) => ({ type, props, children });
const visible = (path: string, value: unknown = true) => ({ $state: path, eq: value });
const action = (label: string, operation: string, args: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, clear: Record<string, unknown> = {}) => ({
  ...node("Button", { label, ...extra }), on: { press: { action: "call", params: { tool: "ui-command", args: { action: operation, "request-key": state("/detail/requestKey"), ...args }, result: "/detail" }, onSuccess: { set: clear } } },
});
const target = { "session-id": state("/detail/sessionId"), "work-id": state("/detail/workId") };
const answer = (text: unknown) => ({ ...target, question: item("id"), text });
const clearDraft = { "/form/message": "", "/form/answer": "", "/form/sidebarOpen": false, "/form/tab": "chat" };
export const PAGE = {
  id: "main", title: "编码", layout: "workspace" as const, components: CODING_COMPONENTS,
  data: {
    catalog: { tool: "ui-catalog" },
    detail: { tool: "ui-work", args: { "session-id": state("/catalog/selectedSession"), before: state("/detail/historyPage") }, refresh: 5 },
  },
  spec: { root: "workspace", state: { form: { project: "", path: "", message: "", answer: "", sidebarOpen: true, tab: "chat" }, detail: { requestKey: "", historyPage: "" } }, elements: {
    workspace: { ...node("Workspace", { title: "编码工作台", description: "把想法交代清楚，把成果带回来。", breadcrumb: state("/detail/projectLabel"), sidebarLabel: "项目与对话", mainLabel: "编码对话", mobileSidebarOpen: bind("/form/sidebarOpen") }, ["header", "tabs", "transcript", "results", "composer"]), slots: { sidebar: ["sidebarScroll"] } },
    sidebarScroll: node("ScrollArea", { label: "项目与对话列表" }, ["sidebar"]),
    sidebar: node("Stack", { gap: "lg" }, ["new", "projects", "history"]),
    new: action("新对话", "new", {}, {}, clearDraft),
    projects: node("Collapsible", { title: "项目目录", defaultOpen: true }, ["project", "register", "projectNotice"]),
    project: node("Select", { label: "新对话的项目", name: "project", placeholder: "选择已添加的目录", options: state("/catalog/projectOptions"), value: bind("/form/project") }),
    projectNotice: node("Text", { text: state("/catalog/notice"), variant: "caption" }),
    register: node("Collapsible", { title: "添加已有目录", defaultOpen: false }, ["path", "registerHelp", "registerButton"]),
    path: node("Input", { label: "主机目录绝对路径", name: "path", placeholder: "/home/me/my-project", value: bind("/form/path") }),
    registerHelp: node("Text", { text: "添加服务所在主机上已有的目录。", variant: "caption" }),
    registerButton: action("添加目录", "register-project", { path: state("/form/path") }, { variant: "secondary" }, { "/form/path": "" }),
    history: node("Stack", { gap: "sm" }, ["historyTitle", "emptyHistory", "sessionList"]),
    historyTitle: node("Text", { text: "最近对话", variant: "caption" }),
    emptyHistory: { ...node("Text", { text: "还没有对话。选好项目，就可以开始了。", variant: "muted" }), visible: visible("/catalog/hasSessions", false) },
    sessionList: { ...node("Stack", { gap: "sm" }, ["sessionOption"]), repeat: { statePath: "/catalog/sessions", key: "id" } },
    sessionOption: { ...node("ActionOption", { label: item("title"), description: item("project"), selected: item("selected"), compact: true }), on: { press: { action: "call", params: { tool: "ui-command", args: { action: "select", "request-key": state("/catalog/requestKey"), "session-id": item("id") }, result: "/detail" }, onSuccess: { set: clearDraft } } } },
    header: node("WorkspaceHeader", { title: state("/detail/goal"), status: state("/detail/status"), statusTone: state("/detail/statusTone"), subtitle: state("/detail/stop") }, ["projectPath"]),
    projectPath: { ...node("Text", { text: state("/detail/projectPath"), variant: "caption" }), visible: { $state: "/detail/projectPath" } },
    tabs: node("ViewTabs", { items: [{ value: "chat", label: "交流" }, { value: "result", label: "成果" }], value: bind("/form/tab") }),
    transcript: { ...node("ScrollArea", { label: "对话消息", follow: true }, ["welcome", "earlier", "latest", "messages", "limited", "questions", "resultEntry", "progress"]), visible: visible("/form/tab", "chat") },
    welcome: { ...node("Panel", { tone: "muted" }, ["welcomeTitle", "welcomeText"]), visible: { $state: "/detail/sessionId", not: true } },
    welcomeTitle: node("Heading", { text: "从一个想法开始", level: "h3" }),
    welcomeText: node("Text", { text: "想修改、修复，或了解什么？选好项目，把需求交给 Chrona。", variant: "muted" }),
    earlier: { ...node("Button", { label: "查看更早的消息", variant: "secondary" }), visible: visible("/detail/hasEarlier"), on: { press: { action: "call", params: { tool: "ui-work", args: { "session-id": state("/detail/sessionId"), before: state("/detail/historyBefore") }, result: "/detail", reload: false } } } },
    latest: { ...node("Button", { label: "回到最新消息", variant: "secondary" }), visible: { $state: "/detail/historyPage" }, on: { press: { action: "call", params: { tool: "ui-work", args: { "session-id": state("/detail/sessionId") }, result: "/detail", reload: false } } } },
    messages: { ...node("Stack", { gap: "none" }, ["messageItem"]), repeat: { statePath: "/detail/messages", key: "id" } },
    messageItem: { ...node("Message", { author: item("author"), time: item("timestamp"), tone: { $cond: { $item: "author", eq: "你" }, $then: "user", $else: "default" } }, ["messageBody", "messageStatus"]) },
    messageBody: node("Markdown", { content: item("content") }),
    messageStatus: { ...node("Text", { text: item("status"), variant: "muted" }), visible: item("status") },
    limited: { ...node("Text", { text: "部分进度或回复已过期、缺失或省略。已保存的回复仍可阅读，请结合项目文件核对。", variant: "muted" }), visible: visible("/detail/limited") },
    questions: { ...node("Stack", { gap: "md" }, ["questionList"]), visible: visible("/detail/hasQuestions") },
    questionList: { ...node("Stack", { gap: "md" }, ["questionCard"]), repeat: { statePath: "/detail/questions", key: "id" } },
    questionCard: { ...node("coding:QuestionCard", { title: item("title"), help: item("help"), confirm: { $item: "method", eq: "confirm" }, select: { $item: "method", eq: "select" }, input: { $or: [{ $item: "method", eq: "input" }, { $item: "method", eq: "editor" }] }, choices: item("choices"), answer: bind("/form/answer") }), on: {
      yes: action("", "answer", answer("是"), {}, { "/form/answer": "" }).on.press,
      no: action("", "answer", answer("否"), {}, { "/form/answer": "" }).on.press,
      choose: { action: "call", params: { tool: "ui-command", args: { action: "answer", "request-key": state("/detail/requestKey"), ...target, question: item("questionId"), text: item("label") }, result: "/detail" }, onSuccess: { set: { "/form/answer": "" } } },
      answer: action("", "answer", answer(state("/form/answer")), {}, { "/form/answer": "" }).on.press,
    } },
    resultEntry: { ...node("ActionOption", { label: "查看本轮改动与执行记录", description: "在成果中查看代码差异 ↗" }), visible: { $state: "/detail/results/0/id" }, on: { press: { action: "setState", params: { statePath: "/form/tab", value: "result" } } } },
    progress: { ...node("Collapsible", { title: "查看执行细节", defaultOpen: false }, ["events"]), visible: { $state: "/detail/workId" } },
    events: { ...node("Stack", { gap: "sm" }, ["eventText"]), repeat: { statePath: "/detail/progress", key: "sequence" } },
    eventText: node("CollapsedText", { content: item("text"), limit: 240 }),
    results: { ...node("ScrollArea", { label: "成果与代码差异" }, ["resultIntro", "resultStop", "diff", "records"]), visible: visible("/form/tab", "result") },
    resultStop: { ...action("停止", "stop", target, { variant: "secondary" }), visible: visible("/detail/canStop") },
    resultIntro: node("Panel", { tone: "muted" }, ["resultTitle", "resultHelp"]),
    resultTitle: node("Heading", { text: "项目改动与执行记录", level: "h3" }),
    resultHelp: node("Text", { text: "修改直接保存在项目目录。这里可以查看本轮差异，无需接受成果，也不会自动提交或合并。", variant: "muted" }),
    diff: { ...node("Stack", { gap: "md" }, ["patch"]), visible: { $state: "/detail/workId" } },
    patch: node("CodeDiff", { diff: state("/detail/patch") }),
    records: node("Collapsible", { title: "执行记录", defaultOpen: false }, ["recordList"]),
    recordList: { ...node("Stack", { gap: "sm" }, ["recordText"]), repeat: { statePath: "/detail/results", key: "id" } },
    recordText: node("Text", { text: item("ref"), variant: "muted" }),
    composer: { ...node("Stack", { gap: "none" }, ["composerCreate", "composerInitial", "composerSend"]), visible: visible("/form/tab", "chat") },
    composerCreate: { ...node("coding:ConversationComposer", { disabled: { $cond: { $state: "/catalog/configured", eq: false }, $then: true, $else: false } }, ["message", "retry"]), visible: { $state: "/detail/sessionId", not: true }, slots: { actions: ["stop", "create"] }, on: { submit: action("", "create", { project: state("/form/project"), text: state("/form/message") }, {}, clearDraft).on.press } },
    composerInitial: { ...node("coding:ConversationComposer", { disabled: { $cond: { $state: "/detail/canSend", eq: false }, $then: true, $else: false } }, ["message", "retry"]), visible: { $and: [{ $state: "/detail/sessionId" }, { $state: "/detail/workId", not: true }] }, slots: { actions: ["stop", "sendInitial"] }, on: { submit: action("", "send", { "session-id": state("/detail/sessionId"), text: state("/form/message") }, {}, clearDraft).on.press } },
    composerSend: { ...node("coding:ConversationComposer", { disabled: { $cond: { $state: "/detail/canSend", eq: false }, $then: true, $else: false } }, ["message", "retry"]), visible: { $and: [{ $state: "/detail/sessionId" }, { $state: "/detail/workId" }] }, slots: { actions: ["stop", "send"] }, on: { submit: action("", "send", { ...target, text: state("/form/message") }, {}, clearDraft).on.press } },
    message: node("Textarea", { label: "消息", name: "message", rows: 2, placeholder: "描述你的需求，或继续上一轮对话…", value: bind("/form/message") }),
    stop: { ...action("停止", "stop", target, { variant: "secondary" }), visible: visible("/detail/canStop") },
    create: { ...action("发送", "create", { project: state("/form/project"), text: state("/form/message") }, { disabled: { $cond: { $state: "/catalog/configured", eq: false }, $then: true, $else: false } }, clearDraft), visible: { $state: "/detail/sessionId", not: true } },
    sendInitial: { ...action("发送", "send", { "session-id": state("/detail/sessionId"), text: state("/form/message") }, { disabled: { $cond: { $state: "/detail/canSend", eq: false }, $then: true, $else: false } }, clearDraft), visible: { $and: [{ $state: "/detail/sessionId" }, { $state: "/detail/workId", not: true }] } },
    send: { ...action("发送", "send", { ...target, text: state("/form/message") }, { disabled: { $cond: { $state: "/detail/canSend", eq: false }, $then: true, $else: false } }, clearDraft), visible: { $and: [{ $state: "/detail/sessionId" }, { $state: "/detail/workId" }] } },
    retry: { ...action("核对并重试上次发送", "retry", { "session-id": state("/detail/sessionId") }, { variant: "secondary" }, clearDraft), visible: visible("/detail/canRetry") },
  } },
};
