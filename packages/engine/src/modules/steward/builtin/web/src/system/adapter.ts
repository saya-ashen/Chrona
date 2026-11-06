type Args = Record<string, unknown>;
export type ReplyEvent = { type: string; session?: string; message?: string; text?: string; attachments?: string };
export type Subscribe = (listener: (event: ReplyEvent) => void) => () => void;
export type SystemHost = {
  web: (path: string, options?: { method?: string; body?: unknown; raw?: boolean }) => Promise<unknown>;
  subscribe?: Subscribe;
  tool: (target: string, args: Args) => Promise<unknown>;
  login: (key: string) => Promise<void>;
};

/** Created only by mountSystem; registered pages receive their original module-scoped deps. */
export function systemCall(host: SystemHost) {
  const post = (path: string, body: unknown) => host.web(path, { method: "POST", body });
  const id = (args: Args) => encodeURIComponent(String(args.id ?? ""));
  const actions: Record<string, (args: Args) => Promise<unknown>> = {
    overview: args => host.web(`/modules/${id(args)}/overview`).catch((error: Error) => { if (/not found/i.test(error.message)) return { app: null }; throw error; }),
    tools: args => host.web(`/tools?query=${encodeURIComponent(String(args.query))}`),
    pages: () => host.web("/pages"),
    catalog: () => host.web("/catalog"),
    credentials: () => host.web("/credentials"),
    install: args => post("/install", args),
    "module-rollback": args => post(`/modules/${id(args)}/rollback`, { hash: args.hash }),
    "detail-activity": args => host.web(`/activity?module=${encodeURIComponent(String(args.module))}`).then(result => (result as { items: unknown[] }).items).catch(() => []),
    diagnostics: args => host.web(`/modules/${id(args)}/diagnostics`).then(result => { const view = (result as unknown[])[0]; if (!view) throw new Error("没有诊断记录"); return { view }; }).catch((error: Error) => ({ failure: error.message })),
    "settings-save": args => post(`/modules/${id(args)}/settings`, { values: args.values }),
    "module-disable": args => post(`/modules/${id(args)}/disable`, {}),
    "module-enable": args => post(`/modules/${id(args)}/enable`, {}),
    "module-remove": args => post(`/modules/${id(args)}/remove`, {}),
    settings: () => host.web("/settings"),
    "schedule-update": args => post(`/schedules/${id(args)}`, { status: args.status }),
    "preference-forget": args => post(`/preferences/${id(args)}/forget`, {}),
    "settings-update": args => post("/settings", args.settings),
    "secret-save": args => post(`/secrets/${id(args)}`, { value: args.value }),
    "secret-remove": args => post(`/secrets/${id(args)}/remove`, args.field ? { field: args.field } : {}),
    authorize: args => post(`/secrets/${id(args)}/authorize`, args.value),
    revoke: args => post(`/grants/${id(args)}/revoke`, {}),
    call: args => post("/call", { target: args.target, args: args.args }),
    sessions: () => host.web("/sessions"),
    messages: args => host.web(`/sessions/${id(args)}/messages`),
    chat: args => post("/chat", { text: args.text, ...(args.session ? { session: args.session } : {}) }),
    "revise-build": args => post(`/sessions/${id(args)}/revise-build`, { requirements: args.requirements }),
    "stop-build": args => post(`/sessions/${id(args)}/stop-build`, {}),
    file: args => host.web(`/file?message=${encodeURIComponent(String(args.message))}&ref=${encodeURIComponent(String(args.ref))}`, { raw: true }),
    transcript: args => host.web(`/sessions/${id(args)}/transcript`),
    memory: args => host.web(args.query ? `/memory?query=${encodeURIComponent(String(args.query))}` : "/memory"),
    forget: args => post("/memory/forget", { id: args.id }),
    today: () => host.web("/today"),
    runs: () => host.web("/runs"),
    modules: () => host.web("/modules"),
    "system-apps": () => host.web("/system-apps"),
    activity: args => host.web(`/activity?${new URLSearchParams(Object.entries({ module: args.module, before: args.before }).filter(([, value]) => value).map(([key, value]) => [key, String(value)]))}`),
    resolve: args => post(`/approvals/${id(args)}/resolve`, { decision: args.decision, scope: args.scope ?? "once" }),
    answer: args => post(`/interactions/${id(args)}/answer`, args.answer),
    cancel: args => post(`/runs/${id(args)}/cancel`, {}),
    feedback: args => host.tool("notify.feedback", { id: args.id, feedback: args.feedback }),
    login: args => host.login(String(args.key ?? "").trim()),
  };
  return async (target: string, args: Args): Promise<unknown> => {
    const name = target.slice(5), action = target.startsWith("$web.") && Object.hasOwn(actions, name) ? actions[name] : undefined;
    if (!action) throw new Error(`未知系统操作：${target}`);
    return action(args);
  };
}
