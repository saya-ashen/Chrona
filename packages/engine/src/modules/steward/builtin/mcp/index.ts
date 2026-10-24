// @ts-expect-error Chrona supplies the SDK at this at run time.
import { chrona } from "chrona";

// Stateless Streamable HTTP with JSON responses: plain JSON-RPC, no MCP SDK needed. Tools are routed calls (v2-8).
type Args = Record<string, unknown>;
type Request = { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; body?: unknown };
const q = (value: unknown) => encodeURIComponent(String(value));
const str = (description?: string) => ({ type: "string", ...(description ? { description } : {}) });
const schema = (properties: Args = {}, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
type McpTool = { name: string; description: string; inputSchema: Args; run(args: Args): Promise<unknown>; destructive?: boolean };
const call = (target: string, args: Args = {}) => chrona.call(target, Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)));
// Today, apps, content and notifications still use the owner API until the web migration (v2-8 §11).
const tools: McpTool[] = [
  { name: "chrona_today", description: "What needs the user now: waiting approvals and questions, running work, today's agenda.", inputSchema: schema(), run: () => owner({ method: "GET", path: "/today" }) },
  { name: "chrona_apps", description: "List apps, their content areas and entry pages.", inputSchema: schema(), run: () => owner({ method: "GET", path: "/apps" }) },
  { name: "chrona_sessions", description: "List conversations, optionally filtered by source and status.", inputSchema: schema({ source: { type: "string", enum: ["web", "qq", "mcp", "rescue", "wake", "module"] }, status: { type: "string", enum: ["active", "ended"] } }),
    run: ({ source, status }) => call("chat.sessions", { source, status }) },
  { name: "chrona_session", description: "Get a conversation.", inputSchema: schema({ sessionId: str() }, ["sessionId"]), run: ({ sessionId }) => call("chat.session", { session: sessionId }) },
  { name: "chrona_session_update", description: "Rename or end a conversation.", inputSchema: schema({ sessionId: str(), title: str(), status: { type: "string", enum: ["ended"] } }, ["sessionId"]),
    run: ({ sessionId, title, status }) => call("chat.session-update", { session: sessionId, title, status }) },
  { name: "chrona_session_new", description: "End the active conversation for a key; the next message starts a new one.", inputSchema: schema({ key: str() }, ["key"]), run: ({ key }) => call("chat.new-session", { key }) },
  { name: "chrona_session_messages", description: "Read a conversation's recent messages.", inputSchema: schema({ sessionId: str(), limit: { type: "integer", minimum: 1, maximum: 200 } }, ["sessionId"]),
    run: ({ sessionId, limit }) => call("chat.messages", { session: sessionId, limit }) },
  { name: "chrona_content_tree", description: "List an app's content files.", inputSchema: schema({ appId: str() }, ["appId"]), run: args => owner({ method: "GET", path: `/apps/${q(args.appId)}/tree` }) },
  { name: "chrona_content_read", description: "Read an app's content file; defaults to its README.md home page.", inputSchema: schema({ appId: str(), path: str("Defaults to README.md") }, ["appId"]),
    run: args => owner({ method: "GET", path: `/apps/${q(args.appId)}/file?path=${q(args.path ?? "README.md")}` }) },
  { name: "chrona_content_write", description: "Save an app's content file, checking its base revision and sending content_edit.", inputSchema: schema({ appId: str(), path: str(), content: str(), baseRevision: { type: ["string", "null"] } }, ["appId", "path", "content", "baseRevision"]),
    run: ({ appId, ...body }) => owner({ method: "PUT", path: `/apps/${q(appId)}/file`, body }) },
  { name: "chrona_chat", description: "Send the user's message to Chrona by session id or key and return its reply. Without either, start a new MCP session.", inputSchema: schema({ text: str(), sessionId: str(), key: str() }, ["text"]),
    run: ({ text, sessionId, key }) => call("chat.ask", { text, session: sessionId, key: sessionId || key ? key : `mcp:${crypto.randomUUID()}` }) },
  { name: "chrona_approvals", description: "List approvals; defaults to open ones waiting for the user.", inputSchema: schema({ status: { type: "string", enum: ["open", "approved", "denied", "expired"] } }),
    run: ({ status }) => call("approvals.list", { status }) },
  { name: "chrona_approval_resolve", description: "Approve or deny an approval as the user. Only call after the user explicitly decided.", destructive: true,
    inputSchema: schema({ approvalId: str(), decision: { type: "string", enum: ["approve", "deny"] }, scope: { type: "string", enum: ["once", "always"] } }, ["approvalId", "decision"]),
    run: ({ approvalId, decision, scope = "once" }) => call("approvals.resolve", { approval: approvalId, decision, scope }) },
  { name: "chrona_modules", description: "List modules (apps Chrona runs without the Provider), their versions and recent runs.", inputSchema: schema(), run: () => call("modules.list") },
  { name: "chrona_notifications", description: "Recent notifications Chrona sent or queued.", inputSchema: schema(), run: () => owner({ method: "GET", path: "/notifications" }) },
  // Module tools change as apps are built, so they are found and called through two fixed tools instead of tools/list.
  { name: "chrona_module_tools", description: "Find module tools (<module>.<tool>) with their input schemas. Matches every word of query against names and descriptions; without query lists all. Always current: newly activated modules show up at once.",
    inputSchema: schema({ query: str("Words to match, e.g. a module name or task") }), run: ({ query }) => call("modules.tools", { query }) },
  { name: "chrona_module_call", description: "Call a module tool found with chrona_module_tools.", inputSchema: schema({ name: str("<module>.<tool>"), arguments: { type: "object", description: "Arguments matching the tool's input schema" } }, ["name"]),
    run: ({ name, arguments: args }) => {
      // Conversations, approvals and app records have their own tools above (approval resolution is marked destructive there).
      if (!/^[a-z][a-z0-9-]{1,40}\.[a-z][a-z0-9-]{1,40}$/.test(String(name)) || /^(chat|approvals|modules)\./.test(String(name))) throw new Error(`not_found: unknown module tool ${String(name)}`);
      return chrona.call(String(name), (args ?? {}) as Args);
    } },
];

async function owner(request: Request) {
  const reply = await chrona.owner(request);
  const failure = reply.body as { code?: string; message?: string } | null;
  if (reply.status >= 400) throw new Error(failure?.code ? `${failure.code}${failure.message ? `: ${failure.message}` : ""}` : `failed (${reply.status})`);
  return reply.body;
}
const text = (value: unknown, isError = false) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 1) }], ...(isError ? { isError } : {}) });

async function handle(method: string, params: Args) {
  if (method === "initialize") {
    const apps = [...new Set((await call("modules.tools") as { target: string }[]).map(tool => tool.target.split(".")[0]))];
    // The app list tells clients what chrona_module_tools can find.
    const instructions = `Chrona, the user's personal steward. Modules (apps Chrona runs without the Provider) offer tools named <module>.<tool>: find them with chrona_module_tools and call them with chrona_module_call. Apps with tools: ${apps.join(", ") || "none yet"}.`;
    return { protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "chrona", version: "1" }, instructions };
  }
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: [
    ...tools.map(({ name, description, inputSchema, destructive }) => ({ name, description, inputSchema, ...(destructive ? { annotations: { destructiveHint: true } } : {}) })),
  ] };
  if (method === "tools/call") {
    const name = String(params.name ?? ""), args = (params.arguments ?? {}) as Args;
    const tool = tools.find(tool => tool.name === name);
    if (!tool) return text(`not_found: unknown tool ${name}`, true);
    try {
      return text(await tool.run(args));
    } catch (error) {
      const { code, message } = error as { code?: string; message?: string };
      return text(code ? `${code}: ${message ?? ""}` : message ?? "failed", true);
    }
  }
  throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
}

chrona.serve(async (request: globalThis.Request) => {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  let message: Args;
  try { message = await request.json(); } catch { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 }); }
  if (!message || typeof message !== "object" || typeof message.method !== "string") return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } }, { status: 400 });
  // Notifications (no id) need no answer.
  if (message.id === undefined) return new Response(null, { status: 202 });
  try { return Response.json({ jsonrpc: "2.0", id: message.id, result: await handle(message.method, (message.params ?? {}) as Args) }); }
  catch (error) {
    const { code = -32603, message: text = "Internal error" } = error as { code?: number; message?: string };
    return Response.json({ jsonrpc: "2.0", id: message.id, error: { code, message: text } });
  }
});
