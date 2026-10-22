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
  const instructions = `Chrona, the user's personal steward. Tools named m_<module>_<tool> come from modules (rules Chrona runs without a model); each acts in its module's affair. Module toolsets:\n${modules.toolsets.map(set => `- ${set.name}: ${set.description}`).join("\n") || "(none)"}`;
  const server = new McpServer({ name: "chrona", version: "1" }, { instructions });
  server.registerTool("chrona_today", { description: "What needs the user now: waiting approvals and questions, running work, today's agenda." }, safe(async () => json(await api.today())));
  server.registerTool("chrona_affairs", { description: "List affairs (things Chrona looks after).", inputSchema: { status: z.enum(s.AFFAIR_STATUSES).optional() } }, safe(async ({ status }) => json(await api.affairs.list(status))));
  server.registerTool("chrona_affair_read", { description: "Read a file of an affair; defaults to its README.md home page.", inputSchema: { affairId: id, path: s.affairPathSchema.default("README.md") } },
    safe(async ({ affairId, path }) => json(await (await api.affairs.files(affairId)).read(path))));
  server.registerTool("chrona_chat", { description: "Send the user's message to Chrona, optionally about one affair, and return its reply. Chrona decides how to handle it.", inputSchema: { text: z.string().min(1).max(8000), affairId: id.optional() } },
    safe(async ({ text, affairId }) => json(s.chatReplySchema.parse(await api.chat.handleMessage({ channel: "in_app", text, affairId })))));
  server.registerTool("chrona_approvals", { description: "List approvals; defaults to open ones waiting for the user.", inputSchema: { status: z.enum(s.APPROVAL_STATUSES).default("open") } }, safe(async ({ status }) => json(await api.approvals.list(status))));
  server.registerTool("chrona_approval_resolve", { description: "Approve or deny an approval as the user. Only call after the user explicitly decided.", inputSchema: { approvalId: id, decision: z.enum(["approve", "deny"]), scope: z.enum(s.APPROVAL_SCOPES).default("once") }, annotations: { destructiveHint: true } },
    safe(async ({ approvalId, decision, scope }) => json((await api.approvals.resolve(approvalId, { decision, scope })).approval)));
  server.registerTool("chrona_modules", { description: "List modules (rules Chrona runs without a model), their versions and recent runs.", inputSchema: { affairId: id.optional() } }, safe(async ({ affairId }) => json(await api.modules.list(affairId))));
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
