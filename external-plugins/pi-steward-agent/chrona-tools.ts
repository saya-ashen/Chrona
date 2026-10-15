/** Chrona's scoped HTTP bridge. Files, shell and web remain Provider-native tools. */
type Catalog = { tools: { name: string; description: string; parameters: Record<string, unknown> }[] };
type ToolResult = { content: { type: "text"; text: string }[]; details: undefined };
// Structural subset keeps this extension independent of the host Pi package version.
type BridgeApi = { registerTool(tool: {
  name: string; label: string; description: string; parameters: Record<string, unknown>;
  execute(id: string, params: unknown, signal?: AbortSignal): Promise<ToolResult>;
}): void };

export default async function (pi: BridgeApi) {
  const base = process.env.CHRONA_AGENT_URL ?? "", token = process.env.CHRONA_AGENT_TOKEN ?? "";
  // Never send a run capability to a non-loopback host or follow a redirect.
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/api\/steward-agent$/.test(base) || !token) return;
  async function call(path: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST", redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Chrona agent endpoint returned HTTP ${response.status}`);
    return response.json();
  }
  const catalog = await call("/catalog", undefined, 5000) as Catalog;
  for (const tool of catalog.tools) {
    pi.registerTool({
      name: tool.name, label: tool.name, description: tool.description, parameters: tool.parameters,
      async execute(_id, params, signal) {
        const result = await call(`/tools/${encodeURIComponent(tool.name)}`, params ?? {}, 60_000, signal) as { ok: boolean; data?: unknown; error?: { code: string; message: string } };
        if (!result.ok) throw new Error(`${result.error?.code ?? "ERROR"}: ${result.error?.message ?? "refused"}`.replaceAll(token, "[redacted]"));
        const text = JSON.stringify(result.data ?? null).replaceAll(token, "[redacted]");
        return { content: [{ type: "text", text: text.length > 30_000 ? `${text.slice(0, 30_000)}\n[Chrona tool result truncated]` : text }], details: undefined };
      },
    });
  }
}
