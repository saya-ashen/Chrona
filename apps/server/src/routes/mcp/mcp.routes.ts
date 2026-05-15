import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ChronaEngine } from "@chrona/engine";
import { createLogger } from "@chrona/shared/logger";
import { createHash } from "node:crypto";
import { z } from "zod";
import { chronaToolInputSchema, type ChronaToolName } from "@chrona/contracts/api";
import { planBlueprintSchema } from "@chrona/contracts";

type ExternalChronaToolName = keyof typeof externalTools;

const logger = createLogger("apps.server.mcp");

const optionalString = z.string().min(1).optional();
const requiredString = (description: string) => z.string().min(1).describe(description);

const baseReadSchema = z.object({}).passthrough();
const nodeResultSchema = z.object({
  status: z.enum(["complete", "blocked", "failed"]).describe("Current node result status."),
  nodeId: optionalString.describe("Optional execution node id to complete when the session has multiple active records."),
  summary: optionalString.describe("Short completion summary when status is complete."),
  output: z.unknown().optional().describe("Structured result produced by the current node when status is complete."),
  reason: optionalString.describe("Why the current node is blocked when status is blocked."),
  error: optionalString.describe("Why the current node failed when status is failed."),
}).passthrough();

const externalTools = {
  chrona_plan_generate: {
    internalName: "chrona.plan.generate",
    title: "Chrona Plan Generate",
    description: "Persist a complete Hermes-generated plan graph for the session task.",
    inputSchema: planBlueprintSchema.passthrough(),
  },
  chrona_execution_read: {
    internalName: "chrona.execution.read",
    title: "Chrona Execution Read",
    description: "Read execution session state and supported next actions.",
    inputSchema: baseReadSchema,
  },
  chrona_node_result: {
    internalName: "chrona.node.result",
    title: "Chrona Node Result",
    description: "Report the current execution node result. Chrona resolves the active node from the session.",
    inputSchema: nodeResultSchema,
  },
} as const satisfies Record<string, {
  internalName: ChronaToolName;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
}>;

function sessionIdFrom(input: Record<string, unknown>, extra?: RequestHandlerExtra<ServerRequest, ServerNotification>) {
  const meta = input._meta && typeof input._meta === "object" ? input._meta as Record<string, unknown> : undefined;
  const extraMeta = extra?._meta as Record<string, unknown> | undefined;
  const sessionId = typeof input.sessionId === "string"
    ? input.sessionId
    : meta?.sessionId ?? extraMeta?.sessionId ?? extra?.sessionId;
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined;
}

function metaFrom(input: Record<string, unknown>, extra?: RequestHandlerExtra<ServerRequest, ServerNotification>) {
  const inputMeta = input._meta && typeof input._meta === "object"
    ? input._meta as Record<string, unknown>
    : {};
  const extraMeta = extra?._meta && typeof extra._meta === "object"
    ? extra._meta as Record<string, unknown>
    : {};
  return { ...extraMeta, ...inputMeta };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}

function idempotencyKeyFrom(input: Record<string, unknown>, toolName: ChronaToolName, payload: Record<string, unknown>, extra?: RequestHandlerExtra<ServerRequest, ServerNotification>) {
  if (!toolName.endsWith(".read")) {
    const meta = metaFrom(input, extra);
    const explicitKey = meta.idempotencyKey ?? meta.requestId ?? meta.callId ?? input.idempotencyKey;
    if (typeof explicitKey === "string" && explicitKey.length > 0) {
      return explicitKey;
    }
    const sessionId = sessionIdFrom(input, extra) ?? "no-session";
    const hash = createHash("sha256")
      .update(stableJson({ sessionId, toolName, payload }))
      .digest("hex")
      .slice(0, 24);
    return `${toolName}:${hash}`;
  }
  return undefined;
}

function toChronaInput(
  toolName: ChronaToolName,
  input: Record<string, unknown>,
  extra?: RequestHandlerExtra<ServerRequest, ServerNotification>,
) {
  const payload = { ...input };
  for (const key of ["workspaceId", "taskId", "sessionId", "idempotencyKey", "expectedRevision", "evidence", "actorType", "actorId", "_meta"]) {
    delete payload[key];
  }
  const meta = metaFrom(input, extra);
  const expectedRevision = typeof meta.expectedRevision === "number" ? meta.expectedRevision : undefined;
  const evidence = meta.evidence && typeof meta.evidence === "object"
    ? meta.evidence as Record<string, unknown>
    : undefined;
  return {
    sessionId: sessionIdFrom(input, extra),
    actorType: "agent" as const,
    idempotencyKey: idempotencyKeyFrom(input, toolName, payload, extra),
    expectedRevision,
    evidence,
    payload: toolName.endsWith(".read") || toolName === "chrona.schedule.clear" ? {} : payload,
  };
}

async function callChronaTool(
  engine: ChronaEngine,
  toolName: ChronaToolName,
  input: Record<string, unknown>,
  extra?: RequestHandlerExtra<ServerRequest, ServerNotification>,
): Promise<CallToolResult> {
  const chronaInput = toChronaInput(toolName, input, extra);
  logger.info("tool.call.received", {
    toolName,
    externalSessionId: sessionIdFrom(input, extra) ?? null,
    inputSessionId: typeof input.sessionId === "string" ? input.sessionId : null,
    inputMetaSessionId: input._meta && typeof input._meta === "object"
      ? (input._meta as Record<string, unknown>).sessionId ?? null
      : null,
    extraSessionId: extra?.sessionId ?? null,
    extraMetaSessionId: extra?._meta && typeof extra._meta === "object"
      ? (extra._meta as Record<string, unknown>).sessionId ?? null
      : null,
    payloadKeys: Object.keys(input).filter((key) => key !== "_meta"),
  });
  const resolvedInput = "resolveInputContext" in engine.agentTools
    ? await engine.agentTools.resolveInputContext(chronaInput)
    : chronaToolInputSchema.parse(chronaInput);
  logger.info("tool.call.resolved", {
    toolName,
    sessionId: resolvedInput.sessionId ?? null,
    taskId: resolvedInput.taskId ?? null,
    workspaceId: resolvedInput.workspaceId ?? null,
    hasIdempotencyKey: Boolean(resolvedInput.idempotencyKey),
  });
  const result = await engine.agentTools.execute({
    toolName,
    input: resolvedInput,
  });
  logger.info("tool.call.result", {
    toolName,
    sessionId: resolvedInput.sessionId ?? null,
    taskId: resolvedInput.taskId ?? null,
    status: result.status,
    reasonCode: "reasonCode" in result ? result.reasonCode : undefined,
    message: result.message,
  });
  return {
    content: [{ type: "text", text: result.message }],
    structuredContent: result,
    isError: result.status === "rejected",
  };
}

function createChronaMcpServer(engine: ChronaEngine) {
  const server = new McpServer({ name: "chrona", version: "0.1.0" });

  for (const [externalName, tool] of Object.entries(externalTools) as [ExternalChronaToolName, typeof externalTools[ExternalChronaToolName]][]) {
    const toolName = tool.internalName;
    server.registerTool(
      externalName,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: toolName.endsWith(".read"),
          destructiveHint: false,
          idempotentHint: !toolName.endsWith(".read"),
          openWorldHint: false,
        },
      },
      (
        input: unknown,
        extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
      ) => callChronaTool(engine, toolName, input as Record<string, unknown>, extra),
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
