/**
 * AI Features — Canonical feature implementations.
 */

import { randomUUID } from "node:crypto";

import type {
  AiClientRecord,
  LLMClientConfig,
  SmartSuggestRequest,
  SmartSuggestResponse,
  SmartSuggestion,
  GenerateTaskPlanRequest,
  GenerateTaskPlanResponse,
  AnalyzeConflictsRequest,
  AnalyzeConflictsResponse,
  ConflictInfo,
  ResolutionSuggestion,
  SuggestTimeslotRequest,
  SuggestTimeslotResponse,
  TimeslotOption,
  ChatRequest,
  ChatResponse,
  StructuredDebugInfo,
  DispatchTaskInput,
  DispatchTaskOutput,
} from "../core/types";
import type { StructuredAgentResult } from "../core/structured";
import { parseTaskDispatchDecision } from "../core/dispatch-types";
import { AiClientError } from "../core/types";
import { dispatch, dispatchStructured, extractJSON } from "../core/providers";
import {
  parseDirectStructuredEnvelope,
  requireStructuredResult,
} from "../core/structured";
import { buildGeneratePlanScope } from "../core/streaming";
import type {
  TaskPlanNode,
  TaskPlanEdge,
  TaskPlanEdgeType,
  AIPlanOutput,
  AIPlanEdge,
  AITaskNode,
  AICheckpointNode,
  AIConditionNode,
  AIWaitNode,
} from "@chrona/contracts/ai";
import {
  validateAIPlanOutput,
} from "@chrona/contracts/ai";
import { createLogger } from "@chrona/db/logger";

const logger = createLogger("ai-features.features");

function toStructuredDebugInfo(
  result: ReturnType<typeof requireStructuredResult>,
): StructuredDebugInfo {
  return {
    rawOutput: result.rawOutput,
    error: result.error,
    source: result.source,
    feature: result.feature,
    toolName: result.toolName,
    sessionId: result.sessionId,
    runId: result.runId,
    validationIssues: result.validationIssues,
    bridgeToolCalls: result.bridgeToolCalls,
  };
}

function normalizeAIPriority(
  value: unknown,
): "Low" | "Medium" | "High" | "Urgent" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "low") return "Low";
  if (normalized === "medium") return "Medium";
  if (normalized === "high") return "High";
  if (normalized === "urgent") return "Urgent";
  return null;
}

function deriveExecutionFromAIPlanNode(
  node: AITaskNode | AICheckpointNode | AIConditionNode | AIWaitNode,
): {
  requiresHumanInput: boolean;
  requiresHumanApproval: boolean;
  autoRunnable: boolean;
  blockingReason: TaskPlanNode["blockingReason"];
} {
  switch (node.type) {
    case "task":
      return {
        requiresHumanInput: node.executor === "user" || node.mode === "manual",
        requiresHumanApproval: false,
        autoRunnable: node.executor !== "user" && node.mode !== "manual",
        blockingReason:
          node.executor === "user" || node.mode === "manual" ? "needs_user_input" : null,
      };
    case "checkpoint":
      return {
        requiresHumanInput: true,
        requiresHumanApproval:
          node.checkpointType === "approve" || node.checkpointType === "confirm",
        autoRunnable: false,
        blockingReason:
          node.checkpointType === "approve" || node.checkpointType === "confirm"
            ? "needs_approval"
            : "needs_user_input",
      };
    case "condition":
      return {
        requiresHumanInput: node.evaluationBy === "user",
        requiresHumanApproval: false,
        autoRunnable: node.evaluationBy !== "user",
        blockingReason: node.evaluationBy === "user" ? "needs_user_input" : null,
      };
    case "wait":
      return {
        requiresHumanInput: false,
        requiresHumanApproval: false,
        autoRunnable: true,
        blockingReason: null,
      };
  }
}

function buildTaskPlanNodeFromAIPlanNode(
  node: AITaskNode | AICheckpointNode | AIConditionNode | AIWaitNode,
  index: number,
): TaskPlanNode {
  const execution = deriveExecutionFromAIPlanNode(node);
  const executionMode: TaskPlanNode["executionMode"] =
    execution.requiresHumanInput || execution.requiresHumanApproval
      ? "manual"
      : "automatic";

  let objective: string;
  let description: string | null;
  let estimatedMinutes: number | null;

  switch (node.type) {
    case "task":
      objective = node.expectedOutput ?? node.description ?? node.title;
      description = node.description ?? null;
      estimatedMinutes = typeof node.estimatedMinutes === "number" ? node.estimatedMinutes : 30;
      break;
    case "checkpoint":
      objective = node.prompt;
      description = node.description ?? null;
      estimatedMinutes = 5;
      break;
    case "condition":
      objective = node.condition;
      description = node.description ?? null;
      estimatedMinutes = 5;
      break;
    case "wait":
      objective = `Wait for: ${node.waitFor}`;
      description = node.description ?? null;
      estimatedMinutes = node.timeout?.minutes ?? 30;
      break;
  }

  return {
    id: node.id ?? `node-${index + 1}`,
    type: node.type,
    title: node.title,
    objective,
    description,
    status: "pending",
    phase: null,
    estimatedMinutes,
    priority: "type" in node && node.type === "task"
      ? normalizeAIPriority(node.priority)
      : null,
    executionMode,
    requiresHumanInput: execution.requiresHumanInput,
    requiresHumanApproval: execution.requiresHumanApproval,
    autoRunnable: execution.autoRunnable,
    blockingReason: execution.blockingReason,
    linkedTaskId: null,
    completionSummary: null,
    metadata: {
      ...(node.type === "checkpoint"
        ? {
            checkpointType: node.checkpointType,
            options: node.options,
            inputFields: node.inputFields,
            prompt: node.prompt,
            required: node.required,
            targetNodeId: node.targetNodeId,
          }
        : {}),
      ...(node.type === "condition"
        ? {
            condition: node.condition,
            evaluationBy: node.evaluationBy,
            branches: node.branches,
            defaultNextNodeId: node.defaultNextNodeId,
          }
        : {}),
      ...(node.type === "wait"
        ? { waitFor: node.waitFor, timeout: node.timeout }
        : {}),
      ...(node.type === "task" && node.executor
        ? { executor: node.executor, mode: node.mode }
        : {}),
    },
  };
}

function buildTaskPlanEdgesFromAIPlanEdges(
  aiEdges: AIPlanEdge[],
): TaskPlanEdge[] {
  return aiEdges.map((edge, index) => ({
    id: `edge-${index + 1}`,
    fromNodeId: edge.from,
    toNodeId: edge.to,
    type: "sequential" as TaskPlanEdgeType,
    metadata: edge.label ? { label: edge.label } : null,
  }));
}

function buildConditionEdges(
  nodes: AIPlanOutput["nodes"],
): TaskPlanEdge[] {
  const edges: TaskPlanEdge[] = [];
  let edgeIndex = 0;

  for (const node of nodes) {
    if (node.type !== "condition") continue;

    for (const branch of node.branches) {
      edges.push({
        id: `edge-condition-${++edgeIndex}`,
        fromNodeId: node.id,
        toNodeId: branch.nextNodeId,
        type: "depends_on",
        metadata: { branchLabel: branch.label },
      });
    }

    if (node.defaultNextNodeId) {
      edges.push({
        id: `edge-condition-${++edgeIndex}`,
        fromNodeId: node.id,
        toNodeId: node.defaultNextNodeId,
        type: "depends_on",
        metadata: { branchLabel: "default" },
      });
    }
  }

  return edges;
}

function ensureObject(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiClientError(
      `${context} must be an object`,
      "openclaw",
      "invalid_response",
    );
  }
  return value as Record<string, unknown>;
}

async function parseStructuredFeatureResult<T>(
  client: AiClientRecord,
  feature: Parameters<typeof dispatchStructured>[1],
  input: Parameters<typeof dispatchStructured>[2],
  scope = "default",
): Promise<{ parsed: T; debug?: StructuredDebugInfo; rawText?: string }> {
  if (client.type === "openclaw") {
    const structuredCall = await dispatchStructured<T>(
      client,
      feature,
      input,
      scope,
    );
    const structured = requireStructuredResult<T>(structuredCall, client.type);
    return {
      parsed: structured.parsed as T,
      debug: toStructuredDebugInfo(structured),
      rawText: structured.rawOutput ?? structuredCall.text,
    };
  }

  const raw = await dispatch(client, feature, input, scope);
  return {
    parsed: extractJSON<T>(raw, client.type),
    rawText: raw,
  };
}

export function normalizeSuggestResponse(input: {
  parsed: unknown;
  source: string;
  structured?: StructuredDebugInfo | StructuredAgentResult | null;
}): SmartSuggestResponse {
  const parsed = ensureObject(input.parsed, "suggest result");
  return {
    suggestions: ((parsed.suggestions as Array<Partial<SmartSuggestion>> | undefined) ?? [])
      .filter((suggestion) => suggestion.title)
      .map((suggestion) => ({
        title: suggestion.title!,
        description: suggestion.description ?? "",
        priority: suggestion.priority ?? "Medium",
        estimatedMinutes: suggestion.estimatedMinutes ?? 30,
        tags: suggestion.tags ?? [],
        suggestedSlot: suggestion.suggestedSlot,
      })),
    source: input.source,
    requestId: randomUUID(),
    structured: input.structured ?? undefined,
  };
}

export async function suggest(
  client: AiClientRecord,
  request: SmartSuggestRequest,
): Promise<SmartSuggestResponse> {
  const result = await parseStructuredFeatureResult<{
    suggestions?: Array<Partial<SmartSuggestion>>;
  }>(client, "suggest", request, request.workspaceId ?? "default");

  return {
    suggestions: (result.parsed.suggestions ?? [])
      .filter((suggestion) => suggestion.title)
      .map((suggestion) => ({
        title: suggestion.title!,
        description: suggestion.description ?? "",
        priority: suggestion.priority ?? "Medium",
        estimatedMinutes: suggestion.estimatedMinutes ?? 30,
        tags: suggestion.tags ?? [],
        suggestedSlot: suggestion.suggestedSlot,
      })),
    source: client.type,
    requestId: randomUUID(),
    structured: result.debug,
  };
}

export function normalizeGeneratePlanResponse(input: {
  parsed: unknown;
  source: string;
  structured?: StructuredDebugInfo | StructuredAgentResult | null;
}): GenerateTaskPlanResponse {
  const defaultResult = {
    nodes: [] as TaskPlanNode[],
    edges: [] as TaskPlanEdge[],
    summary: "",
    source: input.source,
    structured: input.structured ?? undefined,
  };

  if (!input.parsed || typeof input.parsed !== "object") {
    return defaultResult;
  }

  let aiPlan: AIPlanOutput;
  let warnings: string[] = [];

  try {
    const validation = validateAIPlanOutput(input.parsed);
    aiPlan = validation.valid;
    warnings = validation.warnings;
  } catch {
    return defaultResult;
  }

  if (warnings.length > 0) {
    logger.warn("plan.validation_warnings", { warnings, source: input.source });
  }

  const nodes: TaskPlanNode[] = aiPlan.nodes.map((node, index) =>
    buildTaskPlanNodeFromAIPlanNode(node, index),
  );

  const mainEdges = buildTaskPlanEdgesFromAIPlanEdges(aiPlan.edges);
  const conditionEdges = buildConditionEdges(aiPlan.nodes);
  const edges = [...mainEdges, ...conditionEdges];

  return {
    nodes,
    edges,
    summary: aiPlan.summary ?? aiPlan.title ?? `${nodes.length} planned step${nodes.length === 1 ? "" : "s"}`,
    reasoning: aiPlan.title ? `Goal: ${aiPlan.goal}` : undefined,
    source: input.source,
    structured: input.structured ?? undefined,
  };
}

export async function generatePlan(
  client: AiClientRecord,
  request: GenerateTaskPlanRequest,
): Promise<GenerateTaskPlanResponse> {
  const result = await parseStructuredFeatureResult<{
    title?: string;
    goal?: string;
    summary?: string;
    nodes?: Array<Record<string, unknown>>;
    edges?: Array<Record<string, unknown>>;
    completionPolicy?: Record<string, unknown>;
  }>(client, "generate_plan", request, buildGeneratePlanScope(request));

  return normalizeGeneratePlanResponse({
    parsed: result.parsed,
    source: client.type,
    structured: result.debug,
  });
}

export async function analyzeConflicts(
  client: AiClientRecord,
  request: AnalyzeConflictsRequest,
): Promise<AnalyzeConflictsResponse> {
  const result = await parseStructuredFeatureResult<{
    conflicts?: ConflictInfo[];
    resolutions?: ResolutionSuggestion[];
    summary?: string;
  }>(client, "conflicts", request, request.workspaceId ?? "default");

  return {
    conflicts: result.parsed.conflicts ?? [],
    resolutions: result.parsed.resolutions ?? [],
    summary: result.parsed.summary ?? "",
    source: client.type,
    structured: result.debug,
  };
}

export async function suggestTimeslots(
  client: AiClientRecord,
  request: SuggestTimeslotRequest,
): Promise<SuggestTimeslotResponse> {
  const result = await parseStructuredFeatureResult<{
    slots?: TimeslotOption[];
    reasoning?: string;
  }>(client, "timeslots", request, request.taskTitle);

  return {
    slots: result.parsed.slots ?? [],
    reasoning: result.parsed.reasoning,
    source: client.type,
    structured: result.debug,
  };
}

export async function chat(
  client: AiClientRecord,
  request: ChatRequest,
): Promise<ChatResponse> {
  if (client.type === "openclaw") {
    if (request.jsonMode) {
      const structuredCall = await dispatchStructured<unknown>(
        client,
        "chat",
        request,
        "chat",
      );
      if (structuredCall.structured?.ok) {
        return {
          content: structuredCall.text,
          parsed: structuredCall.structured.parsed,
          source: client.type,
          structured: toStructuredDebugInfo(structuredCall.structured),
        };
      }

      const fallback = parseDirectStructuredEnvelope<unknown>(
        extractJSON<unknown>(structuredCall.text, client.type),
        client.type,
      );
      return {
        content: structuredCall.text,
        parsed: fallback.parsed,
        source: client.type,
        structured: toStructuredDebugInfo(fallback),
      };
    }

    const raw = await dispatch(client, "chat", request, "chat");
    return { content: raw, source: client.type };
  }

  const config = client.config as LLMClientConfig;
  const model = config.model ?? "gpt-4o-mini";
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: request.messages,
    temperature: request.temperature ?? config.temperature ?? 0.7,
  };
  if (request.maxTokens) body.max_tokens = request.maxTokens;
  if (request.jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new AiClientError(
      `LLM returned ${res.status}: ${errText.slice(0, 200)}`,
      "llm",
      "internal",
    );
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new AiClientError(
      "No response body for streaming",
      "llm",
      "internal",
    );
  }

  const decoder = new TextDecoder();
  const contentChunks: string[] = [];
  let sseBuffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) contentChunks.push(content);
      } catch {
        // ignore malformed SSE lines
      }
    }
  }

  const content = contentChunks.join("");
  if (request.jsonMode) {
    const parsed = extractJSON<unknown>(content, client.type);
    return { content, parsed, source: client.type };
  }
  return { content, source: client.type };
}

export async function dispatchTask(
  client: AiClientRecord,
  request: DispatchTaskInput,
): Promise<DispatchTaskOutput> {
  const result = await parseStructuredFeatureResult<unknown>(
    client,
    "dispatch_task",
    request,
    request.workspaceId,
  );

  const parsed = parseTaskDispatchDecision(result.parsed);
  if (!parsed.ok) {
    throw new AiClientError(
      `Invalid dispatch decision: ${parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
      client.type,
      "invalid_response",
    );
  }

  return {
    decision: parsed.value,
    reliability: result.debug?.source === "assistant_text" ? "fallback_text" : "structured_tool_call",
    rawProviderResult: result.rawText,
    structured: result.debug,
  };
}
