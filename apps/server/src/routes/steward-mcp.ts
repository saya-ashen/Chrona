import { Hono } from "hono";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import * as s from "@chrona/contracts/steward";
import { StewardError, type StewardPorts, type StewardService } from "@chrona/engine";
import { isLocalOwnerAuthorized } from "../middleware/auth";

type Api = ReturnType<StewardService["forWorkspace"]>;
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 1) }] });
/** Only Chrona's public error codes reach the client; host errors (e.g. ENOENT with paths) do not. */
const safe = <A,>(handler: (args: A) => Promise<ReturnType<typeof json>>) => async (args: A) => {
  try { return await handler(args); }
  catch (error) {
    const text = error instanceof StewardError ? `${error.code}: ${error.message}` : error instanceof z.ZodError ? "invalid: request does not match the schema" : (error as NodeJS.ErrnoException).code === "ENOENT" ? "not_found" : "failed";
    return { content: [{ type: "text" as const, text }], isError: true };
  }
};
const id = z.string().min(1).max(128);

/** Owner tools for the user's own agents (Pi, Claude Code): the same actions as the web UI, nothing more. */
async function ownerServer(api: Api) {
  const modules = await api.modules.tools();
  // Module toolsets play the part of MCP servers inside this one; clients with tool search find their tools by these lines.
  const instructions = `Chrona, the user's personal steward. Tools named m_<module>_<tool> come from modules (apps Chrona runs without the Provider). Module toolsets:\n${modules.toolsets.map(set => `- ${set.name}: ${set.description}`).join("\n") || "(none)"}`;
  const server = new McpServer({ name: "chrona", version: "1" }, { instructions });
  server.registerTool("chrona_today", { description: "What needs the user now: waiting approvals and questions, running work, today's agenda." }, safe(async () => json(await api.today())));
  server.registerTool("chrona_apps", { description: "List apps, their content areas and entry pages." }, safe(async () => json(await api.apps.list())));
  server.registerTool("chrona_sessions", { description: "List conversations, optionally filtered by source and status.", inputSchema: { source: z.enum(s.SESSION_SOURCES).optional(), status: z.enum(s.SESSION_STATUSES).optional() } }, safe(async input => json(await api.sessions.list(input))));
  server.registerTool("chrona_session", { description: "Get a conversation.", inputSchema: { sessionId: id } }, safe(async ({ sessionId }) => json(await api.sessions.get(sessionId))));
  server.registerTool("chrona_session_update", { description: "Rename or end a conversation.", inputSchema: { sessionId: id, ...s.updateSessionSchema.shape } }, safe(async ({ sessionId, ...input }) => json(await api.sessions.update(sessionId, input))));
  server.registerTool("chrona_session_new", { description: "End the active conversation for a key; the next message starts a new one.", inputSchema: s.newSessionSchema.shape }, safe(async input => json(await api.sessions.new(input))));
  server.registerTool("chrona_session_messages", { description: "Read a conversation's recent messages.", inputSchema: { sessionId: id, limit: z.number().int().min(1).max(200).optional() } }, safe(async ({ sessionId, limit }) => json(await api.sessions.messages(sessionId, limit))));
  server.registerTool("chrona_content_tree", { description: "List an app's content files.", inputSchema: { appId: id } }, safe(async ({ appId }) => json(await api.content.tree(appId))));
  server.registerTool("chrona_content_read", { description: "Read an app's content file; defaults to its README.md home page.", inputSchema: { appId: id, path: s.relativePathSchema.default("README.md") } },
    safe(async ({ appId, path }) => json(await api.content.read(appId, path))));
  server.registerTool("chrona_content_write", { description: "Save an app's content file, checking its base revision and sending content_edit.", inputSchema: { appId: id, ...s.saveFileSchema.shape } },
    safe(async ({ appId, ...input }) => json(await api.content.save(appId, input))));
  server.registerTool("chrona_chat", { description: "Send the user's message to Chrona by session id or key and return its reply. Without either, start a new MCP session.", inputSchema: s.chatInputSchema.shape },
    safe(async input => json(s.chatReplySchema.parse(await api.chat.handleMessage({ channel: "in_app", ...input, ...(!input.sessionId && !input.key ? { key: `mcp:${crypto.randomUUID()}` } : {}) })))));
  server.registerTool("chrona_approvals", { description: "List approvals; defaults to open ones waiting for the user.", inputSchema: { status: z.enum(s.APPROVAL_STATUSES).default("open") } }, safe(async ({ status }) => json(await api.approvals.list(status))));
  server.registerTool("chrona_approval_resolve", { description: "Approve or deny an approval as the user. Only call after the user explicitly decided.", inputSchema: { approvalId: id, decision: z.enum(["approve", "deny"]), scope: z.enum(s.APPROVAL_SCOPES).default("once") }, annotations: { destructiveHint: true } },
    safe(async ({ approvalId, decision, scope }) => json((await api.approvals.resolve(approvalId, { decision, scope })).approval)));
  server.registerTool("chrona_modules", { description: "List modules (apps Chrona runs without the Provider), their versions and recent runs." }, safe(async () => json(await api.modules.list())));
  server.registerTool("chrona_notifications", { description: "Recent notifications Chrona sent or queued." }, safe(async () => json(await api.notifications.list())));
  for (const tool of modules.tools) server.registerTool(tool.name, { description: tool.description, inputSchema: tool.shape }, safe(async args => json(await api.modules.callTool(tool.name, args))));
  return server;
}

export function createStewardMcpRoutes(ports: StewardPorts, service: StewardService, wake: () => void) {
  return new Hono().all("/", async c => {
    if (!isLocalOwnerAuthorized(c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
    const requested = c.req.query("workspaceId")?.trim();
    const workspaces = await ports.db.workspace.findMany({ where: requested ? { id: requested } : {}, select: { id: true }, take: 2 });
    // Without an explicit id, only a single-workspace install is unambiguous.
    if (workspaces.length !== 1) return c.json({ code: requested ? "NOT_FOUND" : "WORKSPACE_REQUIRED" }, requested ? 404 : 400);
    const server = await ownerServer(service.forWorkspace(workspaces[0]!.id));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try { return await transport.handleRequest(c.req.raw); }
    finally { await server.close(); if (c.req.method === "POST") wake(); }
  });
}
