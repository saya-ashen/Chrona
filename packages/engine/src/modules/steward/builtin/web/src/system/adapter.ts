type Args = Record<string, unknown>;
export type SystemHost = {
  web: (path: string, options?: { method: string; body?: unknown }) => Promise<unknown>;
  tool: (target: string, args: Args) => Promise<unknown>;
  login: (key: string) => Promise<void>;
};

/** Created only by mountSystem; registered pages receive their original module-scoped deps. */
export function systemCall(host: SystemHost) {
  return async (target: string, args: Args): Promise<unknown> => {
    const id = encodeURIComponent(String(args.id ?? ""));
    switch (target) {
      case "$web.today": return host.web("/today");
      case "$web.runs": return host.web("/runs");
      case "$web.modules": return host.web("/modules");
      case "$web.resolve": return host.web(`/approvals/${id}/resolve`, { method: "POST", body: { decision: args.decision, scope: args.scope ?? "once" } });
      case "$web.answer": return host.web(`/interactions/${id}/answer`, { method: "POST", body: args.answer });
      case "$web.cancel": return host.web(`/runs/${id}/cancel`, { method: "POST", body: {} });
      case "$web.feedback": return host.tool("notify.feedback", { id: args.id, feedback: args.feedback });
      case "$web.login": return host.login(String(args.key ?? "").trim());
      default: throw new Error(`未知系统操作：${target}`);
    }
  };
}
