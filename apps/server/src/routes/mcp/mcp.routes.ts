import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ChronaEngine } from "@chrona/engine";
import { createLogger } from "@chrona/shared/logger";
import { createHash } from "node:crypto";
import { z } from "zod";
import { planBlueprintSchema } from "@chrona/contracts";
import { chronaToolInputSchema, type ChronaToolName } from "@chrona/contracts/api";

type ExternalChronaToolName = keyof typeof externalTools;

const logger = createLogger("apps.server.mcp");

const optionalString = z.string().min(1).optional();

const baseReadSchema = z.object({}).passthrough();
const outputsSchema = z.array(z.unknown()).optional();
const taskCompleteSchema = z.object({
  summary: z.string().min(1).describe("Short completion summary for the current task node."),
  outputs: outputsSchema.describe("Optional structured outputs produced by the current node."),
}).strict();
const conditionSelectSchema = z.object({
  branchRef: z.string().min(1).describe("AI-visible branch ref from chrona_node_read or runtime input."),
  summary: z.string().min(1).describe("Short reason for selecting this branch."),
  outputs: outputsSchema,
}).strict();
const blockSchema = z.object({
  reason: z.string().min(1),
  requiredInput: optionalString,
  retryable: z.boolean().optional(),
}).strict();
const failSchema = z.object({
  error: z.string().min(1),
  retryable: z.boolean().optional(),
  diagnostics: z.unknown().optional(),
}).strict();
const waitCompleteSchema = z.object({
  summary: z.string().min(1),
  outputs: outputsSchema,
}).strict();

const hiddenContextKeys = new Set([
  "workspaceId",
  "taskId",
  "sessionId",
  "actorType",
  "actorId",
  "idempotencyKey",
  "expectedState",
  "expectedRevision",
  "evidence",
  "_meta",
]);

function publicToolSchema(schema: z.ZodObject) {
  const visibleKeys = new Set(Object.keys(schema.shape));
  return schema.passthrough().superRefine((value, ctx) => {
    const unrecognizedKeys = Object.keys(value).filter((key) =>
      !visibleKeys.has(key) && !hiddenContextKeys.has(key)
    );

    if (unrecognizedKeys.length === 0) return;

    ctx.addIssue({
      code: z.ZodIssueCode.unrecognized_keys,
      keys: unrecognizedKeys,
      message: `Unrecognized key${unrecognizedKeys.length === 1 ? "" : "s"}: ${unrecognizedKeys.map((key) => `\"${key}\"`).join(", ")}`,
    });
  });
}

const externalTools = {
  chrona_execution_read: {
    internalName: "chrona.execution.read",
    title: "Chrona Execution Read",
    description: "Read execution session state and supported next actions.",
    inputSchema: publicToolSchema(baseReadSchema),
  },
  chrona_plan_read: {
    internalName: "chrona.plan.read",
    title: "Chrona Plan Read",
    description: "Read accepted plan state through AI-visible refs.",
    inputSchema: publicToolSchema(baseReadSchema),
  },
  chrona_plan_generate: {
    internalName: "chrona.plan.generate",
    title: "Chrona Plan Generate",
    description: "Generate a draft plan for the session task from a complete plan blueprint.",
    inputSchema: publicToolSchema(planBlueprintSchema),
  },
  chrona_node_read: {
    internalName: "chrona.node.read",
    title: "Chrona Node Read",
    description: "Read current execution node state through AI-visible refs.",
    inputSchema: publicToolSchema(baseReadSchema),
  },
  chrona_task_complete: {
    internalName: "chrona.node.task_complete",
    title: "Chrona Task Complete",
    description: "Complete the current task node. Chrona resolves the active node from the session.",
    inputSchema: publicToolSchema(taskCompleteSchema),
  },
  chrona_condition_select: {
    internalName: "chrona.node.condition_select",
    title: "Chrona Condition Select",
    description: "Select the current condition branch by branchRef. Does not accept backend node IDs.",
    inputSchema: publicToolSchema(conditionSelectSchema),
  },
  chrona_node_block: {
    internalName: "chrona.node.block",
    title: "Chrona Node Block",
    description: "Block the current node with a reason. Chrona resolves the active node from the session.",
    inputSchema: publicToolSchema(blockSchema),
  },
  chrona_node_fail: {
    internalName: "chrona.node.fail",
    title: "Chrona Node Fail",
    description: "Fail the current node with an unrecoverable error. Chrona resolves the active node from the session.",
    inputSchema: publicToolSchema(failSchema),
  },
  chrona_wait_complete: {
    internalName: "chrona.node.wait_complete",
    title: "Chrona Wait Complete",
    description: "Complete the current wait node when the wait condition is explicitly satisfied.",
    inputSchema: publicToolSchema(waitCompleteSchema),
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
  for (const key of hiddenContextKeys) {
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
