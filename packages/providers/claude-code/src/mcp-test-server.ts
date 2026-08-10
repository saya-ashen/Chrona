import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

export type McpTestToolCall = {
  name: string;
};

export type McpTestServerOptions = {
  toolNames?: readonly string[];
  onToolCall?: (call: McpTestToolCall) => void | Promise<void>;
};

const DEFAULT_TOOL_NAMES = ["fixture_echo"] as const;

/**
 * Minimal Streamable HTTP MCP peer for provider tests.
 *
 * It deliberately owns no control-plane behavior: tests can verify the
 * provider's MCP registration and SDK event contract without importing the
 * application feature that happens to implement Chrona's production tools.
 */
export function createMcpTestServer(options: McpTestServerOptions = {}): (request: Request) => Promise<Response> {
  const toolNames = options.toolNames ?? DEFAULT_TOOL_NAMES;
  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

  return async (request) => {
    if (new URL(request.url).pathname !== "/api/mcp") {
      return new Response("Not Found", { status: 404 });
    }

    const sessionId = request.headers.get("mcp-session-id");
    if (sessionId) {
      const transport = transports.get(sessionId);
      if (!transport) return new Response("Unknown MCP session", { status: 404 });
      return transport.handleRequest(request);
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (id): void => { transports.set(id, transport); },
    });
    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };

    const server = new McpServer({ name: "provider-test-peer", version: "1.0.0" });
    for (const name of toolNames) {
      server.registerTool(name, {}, async () => {
        await options.onToolCall?.({ name });
        return {
          content: [{ type: "text", text: JSON.stringify({ status: "accepted", tool: name }) }],
        };
      });
    }
    await server.connect(transport);
    return transport.handleRequest(request);
  };
}
