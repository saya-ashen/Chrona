import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ChronaEngine } from "@chrona/engine";
import { createLogger } from "@chrona/logging";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CHRONA_PLAN_GENERATE_INTERNAL_TOOL_NAME,
  CHRONA_PLAN_GENERATE_TOOL_DESCRIPTION,
  CHRONA_PLAN_GENERATE_TOOL_NAME,
  CHRONA_PLAN_GENERATE_TOOL_TITLE,
  chronaPublicToolPayloadSchemas,
  chronaToolInputSchema,
  type ChronaToolName,
  type ChronaToolResult,
} from "@chrona/contracts";


type ExternalChronaToolName = keyof typeof externalTools;

const logger = createLogger("apps.server.mcp");

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
      message: `Unrecognized key${unrecognizedKeys.length === 1 ? "" : "s"}: ${unrecognizedKeys.map((key) => `"${key}"`).join(", ")}`,
    });
  });
}


const externalTools = {
  chrona_execution_read: {
    internalName: "chrona.execution.read",
    title: "Chrona Execution Read",
    description: "Read execution session state and supported next actions.",
    inputSchema: publicToolSchema(chronaPublicToolPayloadSchemas["chrona.execution.read"]),
  },
  chrona_goal_results_read: {
    internalName: "chrona.goal.results.read",
    title: "Chrona Goal Results Read",
    description: "Search current approved Goal assets and immutable accepted-result history for the current Task's Goal. Chrona resolves Goal scope from the session; use returned refs for AI-visible provenance.",
    inputSchema: publicToolSchema(chronaPublicToolPayloadSchemas["chrona.goal.results.read"]),
  },
  chrona_plan_read: {
    internalName: "chrona.plan.read",
    title: "Chrona Plan Read",
    description: "Read accepted plan state through AI-visible refs.",
    inputSchema: publicToolSchema(chronaPublicToolPayloadSchemas["chrona.plan.read"]),
  },
  [CHRONA_PLAN_GENERATE_TOOL_NAME]: {
    internalName: CHRONA_PLAN_GENERATE_INTERNAL_TOOL_NAME,
    title: CHRONA_PLAN_GENERATE_TOOL_TITLE,
    description: CHRONA_PLAN_GENERATE_TOOL_DESCRIPTION,
    inputSchema: publicToolSchema(chronaPublicToolPayloadSchemas["chrona.plan.generate"]),
  },
  chrona_node_read: {
    internalName: "chrona.node.read",
    title: "Chrona Node Read",
    description: "Read current execution node state through AI-visible refs.",
    inputSchema: publicToolSchema(chronaPublicToolPayloadSchemas["chrona.node.read"]),
  },
  chrona_dashboard_brief: {
    internalName: "chrona.dashboard.brief",
    title: "Chrona Dashboard Brief",
    description: "Submit Dashboard AI summary as { summaryText, spec }. Chrona validates and stores the compact dashboard brief spec; use only Stack, Card, Heading, Text, Alert, Badge, Separator, Table.",
    inputSchema: publicToolSchema(chronaPublicToolPayloadSchemas["chrona.dashboard.brief"]),
  },
  chrona_node_complete: {
    internalName: "chrona.node.complete",
    title: "Chrona Node Complete",
    description: "Complete the current task node after required outputs have been submitted.",
    inputSchema: publicToolSchema(chronaPublicToolPayloadSchemas["chrona.node.complete"]),
  },
  chrona_condition_select: {
    internalName: "chrona.node.condition_select",
    title: "Chrona Condition Select",
    description: "Select a condition branch by nodeId and branchRef. Chrona validates the node against the current task.",
    inputSchema: publicToolSchema(chronaPublicToolPayloadSchemas["chrona.node.condition_select"]),
  },
  chrona_node_block: {
    internalName: "chrona.node.block",
    title: "Chrona Node Block",
    description: "Block the current node when it needs user input or an unavailable capability. Provide a reason and an actionForm (instructions plus at least one input field) describing what the user must supply to unblock. Chrona resolves the active node from the session.",
    inputSchema: publicToolSchema(chronaPublicToolPayloadSchemas["chrona.node.block"]),
  },
  chrona_node_fail: {
    internalName: "chrona.node.fail",
    title: "Chrona Node Fail",
    description: "Fail the current node with an unrecoverable error. Chrona resolves the active node from the session.",
    inputSchema: publicToolSchema(chronaPublicToolPayloadSchemas["chrona.node.fail"]),
  },
  chrona_wait_complete: {
    internalName: "chrona.node.wait_complete",
    title: "Chrona Wait Complete",
    description: "Complete the current wait node when the wait condition is explicitly satisfied.",
    inputSchema: publicToolSchema(chronaPublicToolPayloadSchemas["chrona.node.wait_complete"]),
  },
} as const satisfies Record<string, {
  internalName: ChronaToolName;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
}>;

function sessionIdFrom(
  input: Record<string, unknown>,
  extra?: RequestHandlerExtra<ServerRequest, ServerNotification>,
  requestSessionId?: string,
) {
  const meta = input._meta && typeof input._meta === "object" ? input._meta as Record<string, unknown> : undefined;
  const extraMeta = extra?._meta as Record<string, unknown> | undefined;
  assertNoSnakeSessionId(input, "arguments");
  if (meta) assertNoSnakeSessionId(meta, "arguments._meta");
  if (extraMeta) assertNoSnakeSessionId(extraMeta, "extra._meta");
  assertValidSessionId(requestSessionId, "request.session_id");
  assertValidSessionId(input.sessionId, "arguments.sessionId");
  assertValidSessionId(meta?.sessionId, "arguments._meta.sessionId");
  assertValidSessionId(extraMeta?.sessionId, "extra._meta.sessionId");
  assertValidSessionId(extra?.sessionId, "extra.sessionId");
  const sessionId = requestSessionId ?? (typeof input.sessionId === "string"
    ? input.sessionId
    : meta?.sessionId ?? extraMeta?.sessionId ?? extra?.sessionId);
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined;
}

function assertNoSnakeSessionId(input: Record<string, unknown>, source: string) {
  if (Object.prototype.hasOwnProperty.call(input, "session_id")) {
    throw new Error(`${source}.session_id is not supported; expected sessionId`);
  }
}

function assertValidSessionId(value: unknown, source: string) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || value.trim().length === 0 || value === "unknown") {
    throw new Error(`${source} is invalid`);
  }
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

function idempotencyKeyFrom(input: Record<string, unknown>, toolName: ChronaToolName, payload: Record<string, unknown>, extra?: RequestHandlerExtra<ServerRequest, ServerNotification>, requestSessionId?: string) {
  if (!toolName.endsWith(".read")) {
    const meta = metaFrom(input, extra);
    const explicitKey = meta.idempotencyKey ?? meta.requestId ?? meta.callId ?? input.idempotencyKey;
    if (typeof explicitKey === "string" && explicitKey.length > 0) {
      return explicitKey;
    }
    const sessionId = sessionIdFrom(input, extra, requestSessionId);
    if (!sessionId) {
      throw new Error(`${toolName} requires sessionId for idempotency`);
    }
    const hash = createHash("sha256")
      .update(stableJson({ sessionId, toolName, payload }))
      .digest("hex")
      .slice(0, 24);
    return `${toolName}:${hash}`;
  }
  return undefined;
}

function aiVisibleToolResult(toolName: ChronaToolName, result: ChronaToolResult): Record<string, unknown> {
  if (result.status === "accepted") {
    if (toolName === "chrona.goal.results.read") {
      return { status: result.status, message: result.message, result: result.state.result };
    }
    if (toolName.endsWith(".read")) return { status: result.status, message: result.message, state: result.state };
    return { status: result.status, message: result.message, next: "stop" };
  }

  return {
    status: result.status,
    message: result.message,
    reasonCode: result.reasonCode,
    recovery: result.recovery,
    ...(result.evidence ? { evidence: result.evidence } : {}),
  };
}

function aiVisibleToolText(result: ChronaToolResult): string {
  const issues = Array.isArray(result.recovery?.details?.issues)
    ? result.recovery.details.issues
    : [];
  if (issues.length === 0) return result.message;

  const issueText = issues
    .map((issue) => {
      if (!issue || typeof issue !== "object") return null;
      const path = "path" in issue && typeof issue.path === "string" ? issue.path : null;
      const message = "message" in issue && typeof issue.message === "string" ? issue.message : null;
      if (!path && !message) return null;
      return path && message ? `${path}: ${message}` : path ?? message;
    })
    .filter((issue): issue is string => Boolean(issue));
  if (issueText.length === 0) return result.message;

  return `${result.message}\nValidation issues:\n${issueText.map((issue) => `- ${issue}`).join("\n")}`;
}

function toChronaInput(
  toolName: ChronaToolName,
  input: Record<string, unknown>,
  extra?: RequestHandlerExtra<ServerRequest, ServerNotification>,
  requestSessionId?: string,
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
  const validatedPayload = toolName === "chrona.goal.results.read"
    ? chronaPublicToolPayloadSchemas[toolName].parse(payload)
    : toolName.endsWith(".read") || toolName === "chrona.schedule.clear"
      ? {}
      : chronaPublicToolPayloadSchemas[toolName].parse(payload);
  return {
    sessionId: sessionIdFrom(input, extra, requestSessionId),
    actorType: "agent" as const,
    idempotencyKey: idempotencyKeyFrom(input, toolName, payload, extra, requestSessionId),
    expectedRevision,
    evidence,
    payload: validatedPayload,
  };
}

const planGenerationTools = new Set<ChronaToolName>([
  "chrona.plan.generate",
  "chrona.plan.read",
  "chrona.goal.results.read",
]);

const executionTools = new Set<ChronaToolName>([
  "chrona.execution.read",
  "chrona.plan.read",
  "chrona.goal.results.read",
  "chrona.node.read",
  "chrona.node.complete",
  "chrona.node.condition_select",
  "chrona.node.block",
  "chrona.node.fail",
  "chrona.node.wait_complete",
]);

const dashboardBriefTools = new Set<ChronaToolName>([
  "chrona.dashboard.brief",
]);

function toolSessionPurpose(sessionId?: string | null): "plan_generation" | "execution" | "dashboard_brief" | "unknown" {
  if (!sessionId) return "unknown";
  if (sessionId.includes(":dashboard.brief:")) return "dashboard_brief";
  if (
    sessionId.endsWith(":pg") ||
    sessionId.endsWith(":plan-graph") ||
    sessionId.endsWith(":plan-generation")
  ) {
    return "plan_generation";
  }
  if (
    sessionId.includes(":work-block:") ||
    sessionId.includes(":execute:") ||
    sessionId.endsWith(":execute") ||
    sessionId.includes(":plan-")
  ) {
    return "execution";
  }
  return "unknown";
}

function isToolAllowedForSession(toolName: ChronaToolName, sessionId?: string | null): boolean {
  const purpose = toolSessionPurpose(sessionId);
  if (purpose === "plan_generation") return planGenerationTools.has(toolName);
  if (purpose === "execution") return executionTools.has(toolName);
  if (purpose === "dashboard_brief") return dashboardBriefTools.has(toolName);
  return toolName.endsWith(".read");
}

function toolNotAllowedResult(toolName: ChronaToolName, sessionId?: string | null): CallToolResult {
  const purpose = toolSessionPurpose(sessionId);
  const message = `${toolName} is not allowed for ${purpose} session.`;
  return {
    content: [{ type: "text", text: message }],
    structuredContent: {
      status: "rejected",
      message,
      reasonCode: "UNAUTHORIZED",
      recovery: { action: purpose === "plan_generation" ? "stop" : "use_allowed_tool" },
    },
    isError: true,
  };
}

async function callChronaTool(
  engine: ChronaEngine,
  toolName: ChronaToolName,
  input: Record<string, unknown>,
  extra?: RequestHandlerExtra<ServerRequest, ServerNotification>,
  requestSessionId?: string,
): Promise<CallToolResult> {
  const chronaInput = toChronaInput(toolName, input, extra, requestSessionId);
  logger.info("tool.call.received", {
    toolName,
    externalSessionId: sessionIdFrom(input, extra, requestSessionId) ?? null,
    inputSessionId: typeof input.sessionId === "string" ? input.sessionId : null,
    inputMetaSessionId: input._meta && typeof input._meta === "object"
      ? (input._meta as Record<string, unknown>).sessionId ?? null
      : null,
    extraSessionId: extra?.sessionId ?? null,
    extraMetaSessionId: extra?._meta && typeof extra._meta === "object"
      ? (extra._meta as Record<string, unknown>).sessionId ?? null
      : null,
    requestSessionId: requestSessionId ?? null,
    payloadKeys: Object.keys(input).filter((key) => key !== "_meta"),
  });
  const resolvedInput = "resolveInputContext" in engine.agentTools
    ? await engine.agentTools.resolveInputContext(chronaInput)
    : chronaToolInputSchema.parse(chronaInput);
  if (!isToolAllowedForSession(toolName, resolvedInput.sessionId)) {
    logger.warn("tool.call.rejected_by_session_policy", {
      toolName,
      sessionId: resolvedInput.sessionId ?? null,
      purpose: toolSessionPurpose(resolvedInput.sessionId),
    });
    return toolNotAllowedResult(toolName, resolvedInput.sessionId);
  }
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
    content: [{ type: "text", text: aiVisibleToolText(result) }],
    structuredContent: aiVisibleToolResult(toolName, result),
    isError: result.status === "rejected",
  };
}

function createChronaMcpServer(engine: ChronaEngine, requestSessionId?: string) {
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
      ) => callChronaTool(engine, toolName, input as Record<string, unknown>, extra, requestSessionId),
    );
  }

  return server;
}

export const __mcpRouteTestHooks = {
  externalTools,
  callChronaTool,
  createChronaMcpServer,
  sessionIdFrom,
  toChronaInput,
};

export function createMcpRoutes(engine: ChronaEngine) {
  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

  return new Hono().all("/mcp", async (c) => {
    const mcpSessionId = c.req.header("mcp-session-id");
    const existingTransport = mcpSessionId ? transports.get(mcpSessionId) : undefined;
    if (existingTransport) {
      return existingTransport.handleRequest(c.req.raw);
    }

    const requestSessionId = c.req.query("session_id") ?? c.req.query("sessionId") ?? undefined;
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (sessionId) => {
        transports.set(sessionId, transport);
      },
      onsessionclosed: (sessionId) => {
        if (sessionId) transports.delete(sessionId);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };
    const server = createChronaMcpServer(engine, requestSessionId);
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
}
