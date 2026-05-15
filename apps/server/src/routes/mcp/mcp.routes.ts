import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ChronaEngine } from "@chrona/engine";
import { createHash } from "node:crypto";
import { z } from "zod";
import { chronaToolInputSchema, type ChronaToolName } from "@chrona/contracts/api";
import { planBlueprintSchema } from "@chrona/contracts";

type ExternalChronaToolName = keyof typeof externalTools;

const optionalString = z.string().min(1).optional();
const requiredString = (description: string) => z.string().min(1).describe(description);

const baseReadSchema = z.object({}).passthrough();
const baseMutationSchema = baseReadSchema;

const taskCreateSchema = z.object({
  title: requiredString("Task title."),
  description: optionalString.describe("Task description."),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).optional().describe("Task priority."),
  executionRuntime: optionalString.describe("Runtime used when executing this task."),
  executionConfig: z.record(z.string(), z.unknown()).optional().describe("Runtime-specific execution config."),
  parentTaskId: z.string().nullable().optional().describe("Optional parent task id."),
}).passthrough();

const taskUpdateSchema = baseMutationSchema.extend({
  title: optionalString.describe("New task title."),
  description: optionalString.describe("New task description."),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).optional().describe("New task priority."),
  status: optionalString.describe("New task lifecycle status."),
  executionRuntime: optionalString.describe("New execution runtime."),
  executionConfig: z.record(z.string(), z.unknown()).optional().describe("New runtime-specific execution config."),
});

const planMutateSchema = baseMutationSchema.extend({
  expectedGraphId: optionalString.describe("Known current plan graph id."),
  reason: requiredString("Reason for changing the plan graph."),
  scope: z.enum(["future_only", "from_node", "entire_graph"]).optional().describe("Mutation scope."),
  operations: z.array(z.record(z.string(), z.unknown())).min(1).describe("Plan graph mutation operations."),
});

const scheduleProposalSchema = baseMutationSchema.extend({
  source: optionalString.describe("Proposal source."),
  proposedBy: optionalString.describe("Actor proposing this schedule."),
  summary: optionalString.describe("Short proposal summary."),
  dueAt: z.string().nullable().optional().describe("Proposed due time as ISO string, or null."),
  scheduledStartAt: z.string().nullable().optional().describe("Proposed start time as ISO string, or null."),
  scheduledEndAt: z.string().nullable().optional().describe("Proposed end time as ISO string, or null."),
});

const scheduleSetSchema = baseMutationSchema.extend({
  scheduledStartAt: requiredString("Scheduled start time as ISO string."),
  scheduledEndAt: requiredString("Scheduled end time as ISO string."),
  dueAt: z.string().nullable().optional().describe("Due time as ISO string, or null."),
  scheduleSource: z.enum(["human", "ai", "system"]).optional().describe("Source of the accepted schedule."),
});

const executionDispatchSchema = baseMutationSchema.extend({
  action: z.enum([
    "start_manual",
    "start_scheduled",
    "resume_with_input",
    "resume_with_approval",
    "resume_after_unblock",
    "complete_manual_node",
    "retry_node",
    "cancel_session",
  ]).describe("Execution lifecycle action to dispatch."),
  prompt: optionalString.describe("Optional prompt for start or retry actions."),
  workBlockId: optionalString.describe("Work block id for scheduled/manual start."),
  nodeId: optionalString.describe("Execution node id for node-scoped actions."),
  inputText: optionalString.describe("Human or agent input for resume_with_input."),
  decision: z.enum(["approve", "reject", "request_changes"]).optional().describe("Approval decision for resume_with_approval."),
  feedback: optionalString.describe("Optional approval feedback."),
  editedContent: optionalString.describe("Optional edited approval content."),
  note: optionalString.describe("Optional note for resume_after_unblock."),
  summary: optionalString.describe("Optional manual node completion summary."),
  output: z.unknown().optional().describe("Optional manual node output."),
  reason: optionalString.describe("Optional cancellation reason."),
});

const externalTools = {
  chrona_task_read: {
    internalName: "chrona.task.read",
    title: "Chrona Task Read",
    description: "Read a task's current Chrona lifecycle state.",
    inputSchema: baseReadSchema,
  },
  chrona_task_create: {
    internalName: "chrona.task.create",
    title: "Chrona Task Create",
    description: "Create a Chrona task in a workspace.",
    inputSchema: taskCreateSchema,
  },
  chrona_task_update: {
    internalName: "chrona.task.update",
    title: "Chrona Task Update",
    description: "Update task fields through Chrona validation.",
    inputSchema: taskUpdateSchema,
  },
  chrona_plan_read: {
    internalName: "chrona.plan.read",
    title: "Chrona Plan Read",
    description: "Read the accepted plan graph state for a task.",
    inputSchema: baseReadSchema,
  },
  chrona_plan_generate: {
    internalName: "chrona.plan.generate",
    title: "Chrona Plan Generate",
    description: "Persist a complete Hermes-generated plan graph for the session task.",
    inputSchema: planBlueprintSchema.passthrough(),
  },
  chrona_plan_mutate: {
    internalName: "chrona.plan.mutate",
    title: "Chrona Plan Mutate",
    description: "Apply plan graph mutations with stale-write protection.",
    inputSchema: planMutateSchema,
  },
  chrona_schedule_read: {
    internalName: "chrona.schedule.read",
    title: "Chrona Schedule Read",
    description: "Read task schedule and pending proposal state.",
    inputSchema: baseReadSchema,
  },
  chrona_schedule_propose: {
    internalName: "chrona.schedule.propose",
    title: "Chrona Schedule Propose",
    description: "Propose schedule timing for a task.",
    inputSchema: scheduleProposalSchema,
  },
  chrona_schedule_set: {
    internalName: "chrona.schedule.set",
    title: "Chrona Schedule Set",
    description: "Set the accepted schedule for a task.",
    inputSchema: scheduleSetSchema,
  },
  chrona_schedule_clear: {
    internalName: "chrona.schedule.clear",
    title: "Chrona Schedule Clear",
    description: "Clear the accepted schedule for a task.",
    inputSchema: baseMutationSchema,
  },
  chrona_execution_read: {
    internalName: "chrona.execution.read",
    title: "Chrona Execution Read",
    description: "Read execution session state and supported next actions.",
    inputSchema: baseReadSchema,
  },
  chrona_execution_dispatch: {
    internalName: "chrona.execution.dispatch",
    title: "Chrona Execution Dispatch",
    description: "Dispatch an execution lifecycle action for a task.",
    inputSchema: executionDispatchSchema,
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
  const resolvedInput = "resolveInputContext" in engine.agentTools
    ? await engine.agentTools.resolveInputContext(chronaInput)
    : chronaToolInputSchema.parse(chronaInput);
  const result = await engine.agentTools.execute({
    toolName,
    input: resolvedInput,
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
