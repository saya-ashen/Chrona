// @ts-expect-error Chrona supplies the SDK at this at run time.
import { chrona } from "chrona";

// Stateless Streamable HTTP with JSON responses: plain JSON-RPC, no MCP SDK needed.
type Args = Record<string, unknown>;
type Request = { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; body?: unknown };
const q = (value: unknown) => encodeURIComponent(String(value));
const query = (args: Args, keys: string[]) => {
  const pairs = keys.filter(key => args[key] !== undefined).map(key => `${key}=${q(args[key])}`);
  return pairs.length ? `?${pairs.join("&")}` : "";
};
const str = (description?: string) => ({ type: "string", ...(description ? { description } : {}) });
const schema = (properties: Args = {}, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const tools: { name: string; description: string; inputSchema: Args; request(args: Args): Request; destructive?: boolean }[] = [
  { name: "chrona_today", description: "What needs the user now: waiting approvals and questions, running work, today's agenda.", inputSchema: schema(), request: () => ({ method: "GET", path: "/today" }) },
  { name: "chrona_apps", description: "List apps, their content areas and entry pages.", inputSchema: schema(), request: () => ({ method: "GET", path: "/apps" }) },
  { name: "chrona_sessions", description: "List conversations, optionally filtered by source and status.", inputSchema: schema({ source: { type: "string", enum: ["web", "qq", "mcp", "rescue", "wake", "module"] }, status: { type: "string", enum: ["active", "ended"] } }),
    request: args => ({ method: "GET", path: `/sessions${query(args, ["source", "status"])}` }) },
  { name: "chrona_session", description: "Get a conversation.", inputSchema: schema({ sessionId: str() }, ["sessionId"]), request: args => ({ method: "GET", path: `/sessions/${q(args.sessionId)}` }) },
  { name: "chrona_session_update", description: "Rename or end a conversation.", inputSchema: schema({ sessionId: str(), title: str(), status: { type: "string", enum: ["ended"] } }, ["sessionId"]),
    request: ({ sessionId, ...body }) => ({ method: "PATCH", path: `/sessions/${q(sessionId)}`, body }) },
  { name: "chrona_session_new", description: "End the active conversation for a key; the next message starts a new one.", inputSchema: schema({ key: str() }, ["key"]), request: body => ({ method: "POST", path: "/sessions/new", body }) },
  { name: "chrona_session_messages", description: "Read a conversation's recent messages.", inputSchema: schema({ sessionId: str(), limit: { type: "integer", minimum: 1, maximum: 200 } }, ["sessionId"]),
    request: args => ({ method: "GET", path: `/sessions/${q(args.sessionId)}/messages${query(args, ["limit"])}` }) },
  { name: "chrona_content_tree", description: "List an app's content files.", inputSchema: schema({ appId: str() }, ["appId"]), request: args => ({ method: "GET", path: `/apps/${q(args.appId)}/tree` }) },
  { name: "chrona_content_read", description: "Read an app's content file; defaults to its README.md home page.", inputSchema: schema({ appId: str(), path: str("Defaults to README.md") }, ["appId"]),
    request: args => ({ method: "GET", path: `/apps/${q(args.appId)}/file?path=${q(args.path ?? "README.md")}` }) },
  { name: "chrona_content_write", description: "Save an app's content file, checking its base revision and sending content_edit.", inputSchema: schema({ appId: str(), path: str(), content: str(), baseRevision: { type: ["string", "null"] } }, ["appId", "path", "content", "baseRevision"]),
    request: ({ appId, ...body }) => ({ method: "PUT", path: `/apps/${q(appId)}/file`, body }) },
  { name: "chrona_chat", description: "Send the user's message to Chrona by session id or key and return its reply. Without either, start a new MCP session.", inputSchema: schema({ text: str(), sessionId: str(), key: str() }, ["text"]),
    request: body => ({ method: "POST", path: "/chat", body: body.sessionId || body.key ? body : { ...body, key: `mcp:${crypto.randomUUID()}` } }) },
  { name: "chrona_approvals", description: "List approvals; defaults to open ones waiting for the user.", inputSchema: schema({ status: { type: "string", enum: ["open", "approved", "denied", "expired"] } }),
    request: args => ({ method: "GET", path: `/approvals?status=${q(args.status ?? "open")}` }) },
  { name: "chrona_approval_resolve", description: "Approve or deny an approval as the user. Only call after the user explicitly decided.", destructive: true,
    inputSchema: schema({ approvalId: str(), decision: { type: "string", enum: ["approve", "deny"] }, scope: { type: "string", enum: ["once", "always"] } }, ["approvalId", "decision"]),
    request: ({ approvalId, decision, scope = "once" }) => ({ method: "POST", path: `/approvals/${q(approvalId)}/resolve`, body: { decision, scope } }) },
  { name: "chrona_modules", description: "List modules (apps Chrona runs without the Provider), their versions and recent runs.", inputSchema: schema(), request: () => ({ method: "GET", path: "/modules" }) },
  { name: "chrona_notifications", description: "Recent notifications Chrona sent or queued.", inputSchema: schema(), request: () => ({ method: "GET", path: "/notifications" }) },
];

async function owner(request: Request) {
  const reply = await chrona.owner(request);
  const failure = reply.body as { code?: string; message?: string } | null;
  if (reply.status >= 400) throw new Error(failure?.code ? `${failure.code}${failure.message ? `: ${failure.message}` : ""}` : `failed (${reply.status})`);
  return reply.body;
}
async function moduleTools() {
  return await owner({ method: "GET", path: "/modules/tools" }) as { tools: { name: string; description: string; inputSchema: Args }[]; toolsets: { name: string; description: string }[] };
}
const text = (value: unknown, isError = false) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 1) }], ...(isError ? { isError } : {}) });

async function handle(method: string, params: Args) {
  if (method === "initialize") {
    const modules = await moduleTools();
    // Module toolsets play the part of MCP servers inside this one; clients with tool search find their tools by these lines.
    const instructions = `Chrona, the user's personal steward. Tools named m_<module>_<tool> come from modules (apps Chrona runs without the Provider). Module toolsets:\n${modules.toolsets.map(set => `- ${set.name}: ${set.description}`).join("\n") || "(none)"}`;
    return { protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "chrona", version: "1" }, instructions };
  }
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: [
    ...tools.map(({ name, description, inputSchema, destructive }) => ({ name, description, inputSchema, ...(destructive ? { annotations: { destructiveHint: true } } : {}) })),
    ...(await moduleTools()).tools,
  ] };
  if (method === "tools/call") {
    const name = String(params.name ?? ""), args = (params.arguments ?? {}) as Args;
    const tool = tools.find(tool => tool.name === name);
    try {
      if (tool) return text(await owner(tool.request(args)));
      if (name.startsWith("m_")) return text(await owner({ method: "POST", path: `/modules/tools/${q(name)}`, body: args }));
      return text(`not_found: unknown tool ${name}`, true);
    } catch (error) { return text(error instanceof Error ? error.message : "failed", true); }
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
