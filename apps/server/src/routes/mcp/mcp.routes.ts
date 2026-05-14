import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ChronaEngine } from "@chrona/engine";
import {
  chronaToolInputSchema,
  chronaToolInputSchemaFor,
  type ChronaToolName,
} from "@chrona/contracts/api";

function titleForTool(name: string) {
  return name
    .replace(/^chrona\./, "Chrona ")
    .replace(/[.-]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function createChronaMcpServer(engine: ChronaEngine) {
  const server = new McpServer({ name: "chrona", version: "0.1.0" });

  for (const tool of engine.agentTools.registry().tools) {
    const toolName = tool.name as ChronaToolName;
    server.registerTool(
      toolName,
      {
        title: titleForTool(toolName),
        description: tool.description,
        inputSchema: chronaToolInputSchemaFor(toolName),
        annotations: {
          readOnlyHint: !tool.mutates,
          destructiveHint: false,
          idempotentHint: tool.mutates,
          openWorldHint: false,
        },
      },
      async (input) => {
        const resolvedInput = "resolveInputContext" in engine.agentTools
          ? await engine.agentTools.resolveInputContext(input)
          : chronaToolInputSchema.parse(input);
        const result = await engine.agentTools.execute({
          toolName,
          input: resolvedInput,
        });
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: result,
          isError: result.status === "rejected",
        };
      },
    );
  }

  return server;
}

export function createMcpRoutes(engine: ChronaEngine) {
  return new Hono().all("/mcp", async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    const server = createChronaMcpServer(engine);
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
}
