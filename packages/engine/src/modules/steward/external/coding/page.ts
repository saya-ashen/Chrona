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
const clearDraft = { "/form/message": "", "/form/answer": "", "/form/sidebarOpen": false };
export const PAGE = {
  id: "main", title: "编码",
  data: {
    catalog: { tool: "ui-catalog" },
    detail: { tool: "ui-work", args: { "session-id": state("/catalog/selectedSession"), before: state("/detail/historyPage") }, refresh: 5 },
  },
  spec: { root: "workspace", state: { form: { project: "", path: "", message: "", answer: "", sidebarOpen: true }, detail: { requestKey: "", historyPage: "" } }, elements: {
    workspace: { ...node("Workspace", { sidebarLabel: "项目与对话", mainLabel: "编码对话", sidebarOpen: bind("/form/sidebarOpen") }, ["header", "transcript", "composer"]), slots: { sidebar: ["sidebarScroll"] } },
    sidebarScroll: node("ScrollArea", { label: "项目与对话列表" }, ["sidebar"]),
    sidebar: node("Stack", { gap: "lg" }, ["new", "projects", "history"]),
    new: action("新对话", "new", {}, { variant: "secondary" }, clearDraft),
    projects: node("Collapsible", { title: "项目目录", defaultOpen: true }, ["project", "projectNotice", "register"]),
    project: node("Select", { label: "选择项目", name: "project", placeholder: "选择已添加的目录", options: state("/catalog/projectOptions"), value: bind("/form/project") }),
    projectNotice: node("Text", { text: state("/catalog/notice"), variant: "muted" }),
    register: node("Collapsible", { title: "添加已有目录", defaultOpen: false }, ["path", "registerHelp", "registerButton"]),
    path: node("Input", { label: "主机目录绝对路径", name: "path", placeholder: "/home/me/my-project", value: bind("/form/path") }),
    registerHelp: node("Text", { text: "选择服务所在主机上已有的目录，添加后即可使用。", variant: "muted" }),
    registerButton: action("添加目录", "register-project", { path: state("/form/path") }, { variant: "secondary" }, { "/form/path": "" }),
    history: node("Stack", { gap: "sm" }, ["historyTitle", "emptyHistory", "sessionList"]),
    historyTitle: node("Heading", { text: "对话", level: "h3" }),
    emptyHistory: { ...node("Text", { text: "还没有对话。选择项目，描述你要完成的事。", variant: "muted" }), visible: visible("/catalog/hasSessions", false) },
    sessionList: { ...node("Stack", { gap: "sm" }, ["sessionOption"]), repeat: { statePath: "/catalog/sessions", key: "id" } },
    sessionOption: { ...node("ActionOption", { label: item("title"), description: item("project"), selected: item("selected") }), on: { press: { action: "call", params: { tool: "ui-command", args: { action: "select", "request-key": state("/catalog/requestKey"), "session-id": item("id") }, result: "/detail" }, onSuccess: { set: clearDraft } } } },
    header: node("Stack", { gap: "sm" }, ["title", "status", "stopText", "stop"]),
    title: node("Heading", { text: state("/detail/goal"), level: "h3" }),
    status: node("Badge", { text: state("/detail/status"), variant: "secondary" }),
    stopText: node("Text", { text: state("/detail/stop"), variant: "muted" }),
    stop: { ...action("停止", "stop", target, { variant: "danger" }), visible: visible("/detail/canStop") },
    transcript: node("ScrollArea", { label: "对话消息", follow: true }, ["welcome", "earlier", "latest", "messages", "limited", "questions", "progress", "diff", "records"]),
    welcome: { ...node("Text", { text: "告诉我你想修改、修复或了解什么。发送后会直接编辑所选项目目录。", variant: "muted" }), visible: { $state: "/detail/sessionId", not: true } },
    earlier: { ...node("Button", { label: "查看更早的消息", variant: "secondary" }), visible: visible("/detail/hasEarlier"), on: { press: { action: "call", params: { tool: "ui-work", args: { "session-id": state("/detail/sessionId"), before: state("/detail/historyBefore") }, result: "/detail", reload: false } } } },
    latest: { ...node("Button", { label: "回到最新消息", variant: "secondary" }), visible: { $state: "/detail/historyPage" }, on: { press: { action: "call", params: { tool: "ui-work", args: { "session-id": state("/detail/sessionId") }, result: "/detail", reload: false } } } },
    messages: { ...node("Stack", { gap: "none" }, ["messageItem"]), repeat: { statePath: "/detail/messages", key: "id" } },
    messageItem: { ...node("Message", { author: item("author"), time: item("timestamp"), tone: { $cond: { $item: "author", eq: "你" }, $then: "user", $else: "default" } }, ["messageBody", "messageStatus"]) },
    messageBody: node("Markdown", { content: item("content") }),
    messageStatus: { ...node("Text", { text: item("status"), variant: "muted" }), visible: item("status") },
    limited: { ...node("Text", { text: "部分进度或回复已过期、缺失或省略。已保存的回复仍可阅读，请结合项目文件核对。", variant: "muted" }), visible: visible("/detail/limited") },
    questions: { ...node("Stack", { gap: "md" }, ["questionList"]), visible: visible("/detail/hasQuestions") },
    questionList: { ...node("Stack", { gap: "md" }, ["questionCard"]), repeat: { statePath: "/detail/questions", key: "id" } },
    questionCard: node("Card", { title: item("title") }, ["confirm", "selectAnswer", "inputAnswer", "submitAnswer"]),
    confirm: { ...node("Stack", { direction: "horizontal", gap: "sm" }, ["yes", "no"]), visible: { $item: "method", eq: "confirm" } },
    yes: action("是", "answer", answer("是"), {}, { "/form/answer": "" }),
    no: action("否", "answer", answer("否"), { variant: "secondary" }, { "/form/answer": "" }),
    selectAnswer: { ...node("Select", { label: "选择答复", name: "answer-option", placeholder: "请选择", options: item("options"), value: bind("/form/answer") }), visible: { $item: "method", eq: "select" } },
    inputAnswer: { ...node("Textarea", { label: "你的答复", name: "answer", value: bind("/form/answer") }), visible: { $or: [{ $item: "method", eq: "input" }, { $item: "method", eq: "editor" }] } },
    submitAnswer: { ...action("提交答复", "answer", answer(state("/form/answer")), {}, { "/form/answer": "" }), visible: { $item: "method", neq: "confirm" } },
    progress: node("Collapsible", { title: "进度与工具详情", defaultOpen: false }, ["events"]),
    events: { ...node("Stack", { gap: "sm" }, ["eventText"]), repeat: { statePath: "/detail/progress", key: "sequence" } },
    eventText: node("CollapsedText", { content: item("text"), limit: 240 }),
    diff: { ...node("Collapsible", { title: "本轮代码差异", defaultOpen: false }, ["patch"]), visible: { $state: "/detail/workId" } },
    patch: node("CodeDiff", { diff: state("/detail/patch") }),
    records: node("Collapsible", { title: "执行记录", defaultOpen: false }, ["recordList"]),
    recordList: { ...node("Stack", { gap: "sm" }, ["recordText"]), repeat: { statePath: "/detail/results", key: "id" } },
    recordText: node("Text", { text: item("ref"), variant: "muted" }),
    composer: node("Stack", { gap: "sm" }, ["message", "create", "sendInitial", "send", "retry"]),
    message: node("Textarea", { label: "消息", name: "message", placeholder: "描述你的需求，或继续上一轮对话", value: bind("/form/message") }),
    create: { ...action("发送", "create", { project: state("/form/project"), text: state("/form/message") }, { disabled: { $cond: { $state: "/catalog/configured", eq: false }, $then: true, $else: false } }, clearDraft), visible: { $state: "/detail/sessionId", not: true } },
    sendInitial: { ...action("发送", "send", { "session-id": state("/detail/sessionId"), text: state("/form/message") }, { disabled: { $cond: { $state: "/detail/canSend", eq: false }, $then: true, $else: false } }, clearDraft), visible: { $and: [{ $state: "/detail/sessionId" }, { $state: "/detail/workId", not: true }] } },
    send: { ...action("发送", "send", { ...target, text: state("/form/message") }, { disabled: { $cond: { $state: "/detail/canSend", eq: false }, $then: true, $else: false } }, clearDraft), visible: { $and: [{ $state: "/detail/sessionId" }, { $state: "/detail/workId" }] } },
    retry: { ...action("核对并重试上次发送", "retry", { "session-id": state("/detail/sessionId") }, { variant: "secondary" }, clearDraft), visible: visible("/detail/canRetry") },
  } },
};
