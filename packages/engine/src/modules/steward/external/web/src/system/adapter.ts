import type { Execution } from "./chat-execution";
type Args = Record<string, unknown>;
export type ReplyEvent = { type: string; session?: string; message?: string; text?: string; attachments?: string; execution?: Execution; progress?: string };
export type Subscribe = (listener: (event: ReplyEvent) => void) => () => void;
export type SystemHost = {
  web: (path: string, options?: { method?: string; body?: unknown; raw?: boolean }) => Promise<unknown>;
  subscribe?: Subscribe;
  tool: (target: string, args: Args) => Promise<unknown>;
  /** Paths are relative to /api/auth; credentials must never enter the Web module proxy. */
  auth?: (path: string, options?: { method?: string; body?: unknown; accessKey?: string }) => Promise<unknown>;
  login?: (password: string) => Promise<void>;
};

/** Created only by mountSystem; registered pages receive their original module-scoped deps. */
export function systemCall(host: SystemHost) {
  const post = (path: string, body: unknown) => host.web(path, { method: "POST", body });
  const id = (args: Args) => encodeURIComponent(String(args.id ?? ""));
  const auth = (path: string, options?: Parameters<NonNullable<SystemHost["auth"]>>[1]) => {
    if (!host.auth) throw new Error("当前页面无法访问登录服务，请刷新页面。");
    return host.auth(path, options);
  };
  const actions: Record<string, (args: Args) => Promise<unknown>> = {
    overview: args => host.web(`/modules/${id(args)}/overview`).catch((error: Error) => { if (/not found/i.test(error.message)) return { app: null }; throw error; }),
    tools: args => host.web(`/tools?query=${encodeURIComponent(String(args.query ?? ""))}${args.audience === "user" ? "&audience=user" : ""}`),
    pages: () => host.web("/pages"),
    credentials: () => host.web("/credentials"),
    "module-rollback": args => post(`/modules/${id(args)}/rollback`, { hash: args.hash }),
    "detail-activity": args => host.web(`/activity?module=${encodeURIComponent(String(args.module))}`).then(result => (result as { items: unknown[] }).items),
    diagnostics: args => host.web(`/modules/${id(args)}/diagnostics`).then(result => { const view = (result as unknown[])[0]; if (!view) throw new Error("没有诊断记录"); return { view }; }).catch((error: Error) => ({ failure: error.message })),
    "module-disable": args => post(`/modules/${id(args)}/disable`, {}),
    "module-enable": args => post(`/modules/${id(args)}/enable`, {}),
    "module-remove": args => post(`/modules/${id(args)}/remove`, {}),
    settings: () => host.web("/settings"),
    "preference-forget": args => post(`/preferences/${id(args)}/forget`, {}),
    "settings-update": args => post("/settings", args.settings),
    "secret-save": args => post(`/secrets/${id(args)}`, { value: args.value }),
    "secret-remove": args => post(`/secrets/${id(args)}/remove`, args.field ? { field: args.field } : {}),
    authorize: args => post(`/secrets/${id(args)}/authorize`, args.value),
    call: args => post("/call", { target: args.target, args: args.args }),
    sessions: () => host.web("/sessions"),
    messages: args => host.web(`/sessions/${id(args)}/messages`),
    execution: args => host.web(`/sessions/${id(args)}/execution`),
    continue: args => post(`/sessions/${id(args)}/continue`, { runId: args.runId, requestKey: args.requestKey }),
    reconcile: args => post(`/sessions/${id(args)}/reconcile`, { requestKey: args.requestKey }),
    chat: args => post("/chat", { text: args.text, ...(args.session ? { session: args.session } : {}), ...(args.requestKey ? { requestKey: args.requestKey } : {}) }),
    file: args => host.web(`/file?message=${encodeURIComponent(String(args.message))}&ref=${encodeURIComponent(String(args.ref))}`, { raw: true }),
    transcript: args => host.web(`/sessions/${id(args)}/transcript`),
    memory: args => host.web(args.query ? `/memory?query=${encodeURIComponent(String(args.query))}` : "/memory"),
    forget: args => post("/memory/forget", { id: args.id }),
    today: () => host.web("/today"),
    runs: () => host.web("/runs"),
    modules: () => host.web("/modules"),
    "system-apps": () => host.web("/system-apps"),
    activity: args => host.web(`/activity?${new URLSearchParams(Object.entries({ module: args.module, before: args.before }).filter(([, value]) => value).map(([key, value]) => [key, String(value)]))}`),
    resolve: args => post(`/approvals/${id(args)}/resolve`, { decision: args.decision }),
    answer: args => post(`/interactions/${id(args)}/answer`, args.answer),
    cancel: args => post(`/runs/${id(args)}/cancel`, {}),
    feedback: args => host.tool("notify.feedback", { id: args.id, feedback: args.feedback }),
    "auth-status": args => auth("/status", typeof args.accessKey === "string" ? { accessKey: args.accessKey } : undefined),
    "auth-setup": args => auth("/setup", { method: "POST", body: { password: args.password } }),
    "auth-password": args => auth("/password", { method: "POST", body: { currentPassword: args.currentPassword, password: args.password } }),
    login: args => host.auth ? auth("/login", { method: "POST", body: { password: args.password } }) : host.login ? host.login(String(args.password ?? "")) : Promise.reject(new Error("当前页面无法访问登录服务，请刷新页面。")),
  };
  return async (target: string, args: Args): Promise<unknown> => {
    const name = target.slice(5), action = target.startsWith("$web.") && Object.hasOwn(actions, name) ? actions[name] : undefined;
    if (!action) throw new Error(`未知系统操作：${target}`);
    return action(args);
  };
}
