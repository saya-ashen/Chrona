/** Chrona's scoped HTTP bridge. Files, shell and web remain Provider-native tools. */
type Namespace = { name: string; description: string };
type Exposure = "direct" | "deferred";
type Catalog = { tools: { name: string; description: string; parameters: Record<string, unknown>; exposure?: Exposure; namespace?: Namespace }[] };
type ToolResult = { content: { type: "text"; text: string }[]; details: undefined };
// Structural subset keeps this extension independent of the host Pi package version.
type BridgeApi = { registerTool(tool: {
  name: string; label: string; description: string; parameters: Record<string, unknown>;
  /** Pi ≥1.3: deferred tools wait for tool_search; a namespace groups a module's tools like one MCP server. */
  exposure?: Exposure; namespace?: Namespace;
  execute(id: string, params: unknown, signal?: AbortSignal): Promise<ToolResult>;
}): void };

const TIMEOUT = { type: "integer", minimum: 1, maximum: 600, description: "Seconds this call may take (default 60); set it to what the work needs, e.g. while waiting for module checks" };

export default async function (pi: BridgeApi) {
  const base = process.env.CHRONA_AGENT_URL ?? "", token = process.env.CHRONA_AGENT_TOKEN ?? "";
  // Never send a run capability to a non-loopback host or follow a redirect.
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/api\/steward-agent$/.test(base) || !token) return;
  async function call(path: string, body: unknown, timeoutMs: number, signal?: AbortSignal, waitSeconds?: number): Promise<unknown> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST", redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(waitSeconds ? { "x-chrona-timeout-seconds": String(waitSeconds) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch(() => null) as { error?: { code?: unknown; message?: unknown } } | null;
    if (!response.ok) {
      const error = result?.error;
      const message = typeof error?.code === "string" && typeof error.message === "string"
        ? `${error.code}: ${error.message}` : `Chrona agent endpoint returned HTTP ${response.status}`;
      throw new Error(message.replaceAll(token, "[redacted]"));
    }
    return result;
  }
  const catalog = await call("/catalog", undefined, 5000) as Catalog;
  for (const tool of catalog.tools) {
    const properties = (tool.parameters.properties ?? {}) as Record<string, unknown>;
    pi.registerTool({
      name: tool.name, label: tool.name, description: tool.description, exposure: tool.exposure, namespace: tool.namespace,
      // The caller says how long this call may take (v2-13), e.g. while module checks run; Chrona caps it at 600.
      parameters: { ...tool.parameters, properties: { ...properties, timeoutSeconds: TIMEOUT } },
      async execute(_id, params, signal) {
        const { timeoutSeconds, ...args } = (params ?? {}) as { timeoutSeconds?: unknown };
        const seconds = Number.isInteger(timeoutSeconds) && (timeoutSeconds as number) >= 1 ? Math.min(timeoutSeconds as number, 600) : 60;
        const result = await call(`/tools/${encodeURIComponent(tool.name)}`, args, seconds * 1000 + 5000, signal, seconds) as { ok: boolean; data?: unknown; error?: { code: string; message: string } };
        if (!result.ok) throw new Error(`${result.error?.code ?? "ERROR"}: ${result.error?.message ?? "refused"}`.replaceAll(token, "[redacted]"));
        const text = JSON.stringify(result.data ?? null).replaceAll(token, "[redacted]");
        return { content: [{ type: "text", text: text.length > 30_000 ? `${text.slice(0, 30_000)}\n[Chrona tool result truncated]` : text }], details: undefined };
      },
    });
  }
}
