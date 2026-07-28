import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import {
  createAgentSession,
  discoverAuthStorage,
  ModelRegistry,
  SessionManager,
  Settings,
  z,
  type AuthStorage,
  type AgentSession,
  type AgentSessionEvent,
  type CustomTool,
  type ProviderConfigInput,
} from "@oh-my-pi/pi-coding-agent";
import {
  acceptedPlanGenerateToolResult,
  CHRONA_PLAN_GENERATE_TOOL_DESCRIPTION,
  CHRONA_PLAN_GENERATE_TOOL_NAME,
  planGenerateToolPayloadSchema,
} from "@chrona/contracts/ai";
import {
  agentControlActionPayloadSchemas,
  type AgentControlActionBody,
} from "@chrona/contracts/api";
import type {
  AgentProviderClient,
  CancelRunInput,
  CreateSessionInput,
  GetRunInput,
  HealthCheckInput,
  ProviderCapabilities,
  ProviderConfigurationCapabilities,
  ProviderRuntimeDiagnostics,
  ProviderConversationCapabilities,
  ProviderConversationState,
  ProviderConversationHandoffInput,
  ProviderConversationHandoffResult,
  ProviderConversationTurnInput,
  ProviderConversationTurnResult,
  ProviderRunEvent,
  ProviderRunInput,
  ProviderRunRef,
  ProviderRunSnapshot,
  ProviderRunStatus,
  ProviderSessionRef,
  StartRunInput,
  StreamRunInput,
} from "@chrona/providers-foundation";
import type { OmpProviderConfig } from "./types";

const PROVIDER = "omp";
const SDK_RUN_PREFIX = "omp-sdk";

type Timer = Parameters<typeof clearTimeout>[0];
type QueueItem = ProviderRunEvent | { type: "end" };

type SdkRunHandle = {
  ref: ProviderRunRef;
  input: StartRunInput;
  abort: AbortController;
  session?: AgentSession;
  sessionId: string;
  status: ProviderRunStatus;
  outputText: string;
  error?: string;
  sequence: number;
  queue: QueueItem[];
  waiters: Array<() => void>;
  done: boolean;
  timer?: Timer;
  startedAt: string;
  unsubscribe?: () => void;
  inputAbortListener?: () => void;
  terminalActionAccepted?: boolean;
  terminalAction?: { name: string; input: Record<string, unknown> };
};

export type OmpSdkProviderOptions = {
  config?: OmpProviderConfig;
};

class AsyncEventQueue {
  constructor(private readonly handle: SdkRunHandle) {}

  push(event: QueueItem) {
    if (this.handle.done && event.type !== "end") return;
    this.handle.queue.push(event);
    const waiters = this.handle.waiters.splice(0);
    for (const wake of waiters) wake();
  }

  async next(signal?: AbortSignal): Promise<QueueItem> {
    for (;;) {
      const item = this.handle.queue.shift();
      if (item) return item;
      if (this.handle.done) return { type: "end" };
      await new Promise<void>((resolve) => {
        const abort = () => resolve();
        this.handle.waiters.push(resolve);
        signal?.addEventListener("abort", abort, { once: true });
      });
      if (signal?.aborted) return { type: "end" };
    }
  }
}

function now() {
  return new Date().toISOString();
}

function nonEmpty(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

interface SdkEnvironment {
  agentDir?: string;
  apiKeyEnvName?: string;
  baseUrlEnvName?: string;
}

interface SdkModelSetup {
  authStorage?: AuthStorage;
  modelRegistry?: ModelRegistry;
  modelPattern?: string;
}

interface ModelSelectorParts {
  provider?: string;
  modelId?: string;
}

const DIRECT_CONFIG_SOURCE_ID = "chrona-omp-direct-config";
const DIRECT_CONFIG_PROVIDER = "chrona";

function sdkEnvName(name: string, runId: string) {
  const suffix = runId.replace(/[^a-zA-Z0-9_]/g, "_").toUpperCase();
  return `${name}_${suffix}`;
}

function splitModelSelector(model?: string): ModelSelectorParts {
  const value = nonEmpty(model);
  if (!value) return {};
  const separator = value.indexOf("/");
  if (separator <= 0) return { modelId: value };
  return {
    provider: value.slice(0, separator),
    modelId: value.slice(separator + 1),
  };
}

function directConfigProvider(config: OmpProviderConfig, selector: ModelSelectorParts): string {
  return nonEmpty(config.provider) ?? selector.provider ?? DIRECT_CONFIG_PROVIDER;
}

function directConfigApi(config: OmpProviderConfig): NonNullable<ProviderConfigInput["api"]> {
  return (nonEmpty(config.api) ?? "openai-responses") as NonNullable<ProviderConfigInput["api"]>;
}

function hasDirectProviderConfig(config: OmpProviderConfig): boolean {
  return Boolean(nonEmpty(config.apiKey) || nonEmpty(config.baseUrl));
}

async function loadSdkSettings(environment: SdkEnvironment, cwd: string) {
  return Settings.loadIsolated({ cwd, agentDir: environment.agentDir });
}

async function createSdkModelSetup(config: OmpProviderConfig, environment: SdkEnvironment): Promise<SdkModelSetup> {
  const model = nonEmpty(config.model);
  if (!hasDirectProviderConfig(config)) return { modelPattern: model };

  const authStorage = await discoverAuthStorage(environment.agentDir);
  const modelRegistry = new ModelRegistry(authStorage);
  const selector = splitModelSelector(model);
  const provider = directConfigProvider(config, selector);
  const api = directConfigApi(config);
  const baseUrl = environment.baseUrlEnvName ? nonEmpty(process.env[environment.baseUrlEnvName]) : undefined;
  const apiKey = environment.apiKeyEnvName;
  const apiOverride = nonEmpty(config.api) ? { api } : {};

  if (selector.provider || nonEmpty(config.provider)) {
    modelRegistry.registerProvider(provider, { baseUrl, apiKey, ...apiOverride }, DIRECT_CONFIG_SOURCE_ID);
    return { authStorage, modelRegistry, modelPattern: model };
  }

  if (selector.modelId) {
    modelRegistry.registerProvider(
      provider,
      {
        baseUrl,
        apiKey,
        api,
        models: [
          {
            id: selector.modelId,
            name: selector.modelId,
            api,
            baseUrl,
            reasoning: true,
            input: ["text"],
            supportsTools: true,
            contextWindow: 200_000,
            maxTokens: 64_000,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
      DIRECT_CONFIG_SOURCE_ID,
    );
    return { authStorage, modelRegistry, modelPattern: `${provider}/${selector.modelId}` };
  }

  modelRegistry.registerProvider(provider, { baseUrl, apiKey, ...apiOverride }, DIRECT_CONFIG_SOURCE_ID);
  return { authStorage, modelRegistry, modelPattern: model };
}

function renderProviderInput(input: ProviderRunInput): string {
  if (typeof input === "string") return input;
  if (Array.isArray(input)) {
    for (const item of input) {
      if (
        item &&
        typeof item === "object" &&
        "type" in item &&
        item.type === "text" &&
        typeof item.text === "string"
      ) {
        return item.text;
      }
    }
  }
  if (
    typeof input === "object" &&
    "type" in input &&
    input.type === "text" &&
    typeof input.text === "string"
  ) {
    return input.text;
  }
  return JSON.stringify(input, null, 2);
}

function terminalToolInstruction(input: StartRunInput): string | undefined {
  if (!input.terminalToolName) return undefined;
  if (input.terminalToolName === CHRONA_PLAN_GENERATE_TOOL_NAME) {
    return [
      `When the plan is ready, call the custom tool \`${CHRONA_PLAN_GENERATE_TOOL_NAME}\` with the complete PlanBlueprint object.`,
      "Do not answer only in text; the plan is not submitted until that custom tool call succeeds.",
      "After the tool returns success, stop immediately.",
    ].join("\n");
  }
  return [
    `When finished, call the custom tool \`${input.terminalToolName}\` with the final structured payload required by the current Chrona instructions.`,
    "Do not treat this instruction itself as evidence that the tool has run.",
  ].join("\n");
}

function inputToPrompt(input: StartRunInput): string {
  return [
    input.instructions,
    terminalToolInstruction(input),
    renderProviderInput(input.input),
    input.structuredOutputSchema
      ? `Structured output schema:\n${JSON.stringify(input.structuredOutputSchema.schema, null, 2)}`
      : undefined,
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n\n");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseStructuredPayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function runRef(handle: SdkRunHandle, status = handle.status): ProviderRunRef {
  return {
    ...handle.ref,
    sessionId: handle.sessionId,
    status,
  };
}

function eventBase(handle: SdkRunHandle, rawEventType?: string) {
  return {
    provider: PROVIDER,
    runId: handle.ref.runId,
    nativeRunId: handle.ref.nativeRunId,
    sessionId: handle.sessionId,
    sequence: handle.sequence++,
    timestamp: now(),
    rawEventType,
  };
}

const looseObjectSchema = z.object({}).catchall(z.unknown());


type NodeRuntimeToolName =
  | "chrona_node_complete"
  | "chrona_condition_select"
  | "chrona_wait_complete"
  | "chrona_node_request_input"
  | "chrona_node_block"
  | "chrona_node_fail";

function isTerminalRuntimeTool(toolName: string): boolean {
  return toolName === "chrona_node_complete" || toolName === "chrona_condition_select" || toolName === "chrona_wait_complete" || toolName === "chrona_node_request_input" || toolName === "chrona_node_block" || toolName === "chrona_node_fail";
}

const NODE_RUNTIME_TOOL_SET_BY_TERMINAL: Record<string, readonly NodeRuntimeToolName[]> = {
  chrona_node_complete: ["chrona_node_complete", "chrona_node_request_input", "chrona_node_block", "chrona_node_fail"],
  chrona_condition_select: ["chrona_condition_select", "chrona_node_block", "chrona_node_fail"],
  chrona_wait_complete: ["chrona_wait_complete", "chrona_node_block", "chrona_node_fail"],
  chrona_node_request_input: ["chrona_node_request_input", "chrona_node_block", "chrona_node_fail"],
  chrona_node_block: ["chrona_node_block", "chrona_node_fail"],
  chrona_node_fail: ["chrona_node_block", "chrona_node_fail"],
};

type NodeRuntimeToolDefinition = {
  kind: AgentControlActionBody["kind"];
  description: string;
  parameters: CustomTool["parameters"];
};

const NODE_RUNTIME_TOOL_DEFINITIONS: Partial<Record<string, NodeRuntimeToolDefinition>> = {
  chrona_node_complete: {
    kind: "complete",
    description: "Complete the current Chrona task node with semantic result contributions and declared deliverables after its objective is satisfied.",
    parameters: agentControlActionPayloadSchemas.complete,
  },
  chrona_condition_select: {
    kind: "condition_select",
    description: "Select exactly one branchRef for the current Chrona condition node.",
    parameters: agentControlActionPayloadSchemas.condition_select,
  },
  chrona_wait_complete: {
    kind: "wait_complete",
    description: "Mark the current Chrona wait node complete when the wait condition is satisfied by evidence.",
    parameters: agentControlActionPayloadSchemas.wait_complete,
  },
  chrona_node_request_input: {
    kind: "request_input",
    description: "Pause the current Chrona node for normal structured user input. Use semantic text, choice, or boolean fields; choice.selection selects single or multiple values.",
    parameters: agentControlActionPayloadSchemas.request_input,
  },
  chrona_node_block: {
    kind: "block",
    description: "Block the current Chrona node only when an exceptional external blocker such as missing access or unavailable capability prevents safe completion.",
    parameters: agentControlActionPayloadSchemas.block,
  },
  chrona_node_fail: {
    kind: "fail",
    description: "Fail the current Chrona node for an unrecoverable error.",
    parameters: agentControlActionPayloadSchemas.fail,
  },
};

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return end === value.length ? value : value.slice(0, end);
}

function sdkToolNamesForTerminal(terminalToolName: string | undefined): string[] {
  if (!terminalToolName) return [];
  if (terminalToolName === CHRONA_PLAN_GENERATE_TOOL_NAME) return [CHRONA_PLAN_GENERATE_TOOL_NAME];
  return [...(NODE_RUNTIME_TOOL_SET_BY_TERMINAL[terminalToolName] ?? [terminalToolName as NodeRuntimeToolName])];
}

async function postControlAction(input: {
  control: NonNullable<StartRunInput["control"]>;
  body: AgentControlActionBody;
  signal?: AbortSignal;
}) {
  const response = await fetch(`${stripTrailingSlashes(input.control.baseUrl)}/agent/control`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.control.runToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ body: input.body }),
    signal: input.signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Chrona control request failed (${response.status}): ${text || response.statusText}`);
  }
  return text ? JSON.parse(text) as unknown : { ok: true };
}

function acceptedNodeToolResult(details: Record<string, unknown> = { accepted: true }) {
  return {
    content: [{ type: "text" as const, text: "accepted" }],
    details,
  };
}

function createTerminalTool(toolName: string, control?: StartRunInput["control"], onTerminalAccepted?: () => void): CustomTool {
  if (toolName === CHRONA_PLAN_GENERATE_TOOL_NAME) {
    return {
      name: toolName,
      label: toolName,
      strict: true,
      description: CHRONA_PLAN_GENERATE_TOOL_DESCRIPTION,
      parameters: planGenerateToolPayloadSchema,
      async execute() {
        return acceptedPlanGenerateToolResult();
      }
    };
  }

  const definition = NODE_RUNTIME_TOOL_DEFINITIONS[toolName];
  return {
    name: toolName,
    label: toolName,
    strict: Boolean(definition),
    description: definition?.description ?? "Submit the final structured payload required by the current Chrona instructions.",
    parameters: definition?.parameters ?? looseObjectSchema,
    async execute(_toolCallId, params, _onUpdate, ctx, signal) {
      if (!definition || !control) return acceptedNodeToolResult();
      const body = { kind: definition.kind, payload: params } as AgentControlActionBody;
      const result = await postControlAction({ control, body, signal });
      if (isTerminalRuntimeTool(toolName)) { onTerminalAccepted?.(); queueMicrotask(() => ctx.abort()); }
      return acceptedNodeToolResult({ accepted: true, control: result });
    }
  };
}
function sdkToolOptionsForTerminal(terminalToolName: string | undefined, control?: StartRunInput["control"], onTerminalAccepted?: () => void): { customTools: CustomTool[] } {
  return {
    customTools: sdkToolNamesForTerminal(terminalToolName).map((toolName) => createTerminalTool(toolName, control, onTerminalAccepted)),
  };
}

function toolCallPreview(
  event: Extract<AgentSessionEvent, { type: "tool_execution_start" }>,
): string | undefined {
  return event.intent?.trim() || undefined;
}

function textContentPreview(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("content" in value) || !Array.isArray(value.content)) {
    return undefined;
  }
  const text = value.content.flatMap((item) =>
    item && typeof item === "object" && "text" in item && typeof item.text === "string"
      ? [item.text]
      : []
  ).join("\n").trim();
  if (!text) return undefined;
  return text.length > 2_000 ? `${text.slice(0, 1_997)}...` : text;
}

function sdkLifecycleSummary(event: AgentSessionEvent): string | undefined {
  switch (event.type) {
    case "turn_start":
      return "Agent turn started.";
    case "turn_end":
      return "Agent turn completed.";
    case "auto_compaction_start":
      return `Context compaction started (${event.action}).`;
    case "auto_compaction_end":
      return event.aborted ? "Context compaction was aborted." : `Context compaction completed (${event.action}).`;
    case "auto_retry_start":
      return `Retry ${event.attempt}/${event.maxAttempts} scheduled after provider error.`;
    case "auto_retry_end":
      return event.success ? `Retry ${event.attempt} succeeded.` : `Retry ${event.attempt} failed.`;
    case "retry_fallback_applied":
      return `Model fallback applied: ${event.from} → ${event.to}.`;
    case "retry_fallback_succeeded":
      return `Model fallback succeeded with ${event.model}.`;
    case "notice":
      return event.message;
    case "todo_reminder":
      return `Agent todo reminder (${event.todos.length} open items).`;
    case "todo_auto_clear":
      return "Agent todo list completed.";
    case "thinking_level_changed":
      return `Thinking level changed to ${event.resolved ?? event.thinkingLevel ?? "default"}.`;
    default:
      return undefined;
  }
}

function agentEndFailure(event: Extract<AgentSessionEvent, { type: "agent_end" }>): string | null {
  const message = event.messages.findLast((entry) => entry.role === "assistant");
  if (!message) return "Oh My Pi SDK ended without an assistant result";
  if (message.stopReason !== "error" && message.stopReason !== "aborted") return null;
  return message.errorMessage?.trim()
    || (message.stopReason === "aborted" ? "Oh My Pi SDK run was aborted" : "Oh My Pi SDK run failed");
}

function agentEndOutcome(event: Extract<AgentSessionEvent, { type: "agent_end" }>, terminalActionAccepted: boolean): { status: "completed" } | { status: "failed"; error: string } {
  if (terminalActionAccepted) return { status: "completed" };
  const error = agentEndFailure(event);
  return error ? { status: "failed", error } : { status: "completed" };
}
function terminalNodeToolFromSnapshot(input: { raw?: unknown }) {
  const terminal = asRecord(asRecord(input.raw).terminalTool);
  const name = terminal.name;
  if (typeof name !== "string" || !isTerminalRuntimeTool(name)) return null;
  return {
    name,
    input: asRecord(terminal.input),
  };
}


function assertExpectedModel(expectedModel: string | undefined, actualModel: string | null) {
  if (!expectedModel || actualModel === expectedModel) return;
  throw new Error(
    `OMP model routing conflict: expected '${expectedModel}', resolved '${actualModel ?? "none"}'`,
  );
}

function sdkReadOnlyToolOptions(toolPolicy: StartRunInput["toolPolicy"]) {
  return toolPolicy === "read_only"
    ? { toolNames: [] as string[], enableMCP: false, enableLsp: false }
    : {};
}

export const __ompSdkProviderTestHooks = {
  sdkToolNamesForTerminal,
  sdkToolOptionsForTerminal,
  sdkReadOnlyToolOptions,
  sdkToolErrorMessage,
  isTerminalRuntimeTool,
  agentEndFailure,
  agentEndOutcome,
  toolCallPreview,
  textContentPreview,
  terminalNodeToolFromSnapshot,
  sdkLifecycleSummary,
  assertExpectedModel,
  loadSdkSettings,
};

function applySdkEnvironment(config: OmpProviderConfig, runId = "health"): SdkEnvironment {
  const env = { ...(config.env ?? {}) };
  const homeDirectory = nonEmpty(config.homeDirectory);
  const configDirectory = nonEmpty(config.configDirectory);
  const codingAgentDirectory = nonEmpty(config.codingAgentDirectory);
  const apiKey = nonEmpty(config.apiKey);
  const baseUrl = nonEmpty(config.baseUrl);
  const apiKeyEnvName = apiKey ? sdkEnvName("CHRONA_OMP_API_KEY", runId) : undefined;
  const baseUrlEnvName = baseUrl ? sdkEnvName("CHRONA_OMP_BASE_URL", runId) : undefined;
  if (homeDirectory) env.HOME = homeDirectory;
  if (configDirectory) env.PI_CONFIG_DIR = configDirectory;
  if (codingAgentDirectory) env.PI_CODING_AGENT_DIR = codingAgentDirectory;
  if (apiKey && apiKeyEnvName) env[apiKeyEnvName] = apiKey;
  if (baseUrl && baseUrlEnvName) env[baseUrlEnvName] = baseUrl;
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") process.env[key] = value;
  }
  return {
    agentDir: codingAgentDirectory ?? configDirectory,
    apiKeyEnvName,
    baseUrlEnvName,
  };
}

function sdkToolErrorMessage(result: unknown): string {
  if (!result || typeof result !== "object" || !("content" in result) || !Array.isArray(result.content)) {
    return "Oh My Pi SDK tool call failed";
  }
  const messages = result.content.flatMap((item) => {
    if (!item || typeof item !== "object" || !("text" in item) || typeof item.text !== "string") return [];
    const text = item.text.replace(/\s+/g, " ").trim();
    return text ? [text] : [];
  });
  return messages.join(" ").slice(0, 500) || "Oh My Pi SDK tool call failed";
}

export class OmpSdkProviderClient implements AgentProviderClient {
  readonly provider = PROVIDER;
  private readonly config: OmpProviderConfig;
  private readonly runs = new Map<string, SdkRunHandle>();

  constructor(opts: OmpSdkProviderOptions = {}) {
    this.config = opts.config ?? {};
  }

  getConfigurationCapabilities(): ProviderConfigurationCapabilities {
    return {
      model: { supported: true, taskOverride: true },
      context: {
        supported: true,
        taskOverride: true,
        strategies: ["provider_default", "auto_compact", "bounded_tool_results", "artifact_backed"],
      },
      tooling: {
        mcp: { supported: true, enabled: true },
        lsp: { supported: true, enabled: true },
        subagents: { supported: true, enabled: true },
        enabledTools: [],
      },
    };
  }

  async getRuntimeDiagnostics(): Promise<ProviderRuntimeDiagnostics> {
    const environment = applySdkEnvironment(this.config, "diagnostics");
    const cwd = nonEmpty(this.config.cwd) ?? process.cwd();
    const configuredAgentDirectory = nonEmpty(this.config.codingAgentDirectory)
      ?? nonEmpty(this.config.configDirectory);
    const setup = await createSdkModelSetup(this.config, environment);
    const settings = await loadSdkSettings(environment, cwd);
    const terminalTools = sdkToolOptionsForTerminal("chrona_node_complete");
    const { session, mcpManager } = await createAgentSession({
      cwd,
      agentDir: configuredAgentDirectory,
      modelPattern: setup.modelPattern,
      ...(setup.authStorage ? { authStorage: setup.authStorage } : {}),
      ...(setup.modelRegistry ? { modelRegistry: setup.modelRegistry } : {}),
      ...terminalTools,
      settings,
      sessionManager: SessionManager.inMemory(cwd),
      skipPythonPreflight: true,
      hasUI: false,
    });
    try {
      const enabledTools = session.getActiveToolNames().sort();
      const configurationCapabilities: ProviderConfigurationCapabilities = {
        ...this.getConfigurationCapabilities(),
        tooling: {
          mcp: { supported: true, enabled: Boolean(mcpManager) },
          lsp: { supported: true, enabled: enabledTools.includes("lsp") },
          subagents: { supported: true, enabled: enabledTools.includes("task") },
          enabledTools,
        },
      };
      const configuredConfigDirectory = nonEmpty(this.config.configDirectory);
      const effectiveAgentDirectory = session.settings.getAgentDir();
      const effectiveModel = session.model;
      return {
        provider: PROVIDER,
        model: effectiveModel ? `${effectiveModel.provider}/${effectiveModel.id}` : null,
        contextWindow: effectiveModel?.contextWindow ?? null,
        contextStrategy: "auto_compact",
        workingDirectory: session.settings.getCwd(),
        configDirectory: configuredConfigDirectory
          ? resolve(configuredConfigDirectory)
          : resolve(effectiveAgentDirectory, ".."),
        agentDirectory: effectiveAgentDirectory,
        configurationCapabilities,
        sources: {
          model: nonEmpty(this.config.model) ? "provider_override" : "provider_default",
          context: "provider_default",
          configDirectory: configuredConfigDirectory ? "provider_override" : "provider_default",
          agentDirectory: configuredAgentDirectory ? "provider_override" : "provider_default",
          tools: "runtime",
        },
      };
    } finally {
      await session.dispose();
    }
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsSessions: true,
      supportsStreaming: true,
      supportsRunLookup: true,
      supportsCancellation: true,
      supportsToolCalls: true,
      supportsPreviousResponse: false,
      recovery: {
        sessionResume: true,
        historyReplay: true,
        activeRunLookup: false,
        streamReconnect: false,
        mode: "session_history",
      },
      reason: "Oh My Pi SDK custom tools run in-process for structured Chrona callbacks.",
    };
  }

  async checkHealth(_input?: HealthCheckInput) {
    const started = Date.now();
    try {
      applySdkEnvironment(this.config);
      return {
        provider: PROVIDER,
        ok: true,
        checkedAt: now(),
        latencyMs: Date.now() - started,
        message: "Oh My Pi SDK package loaded",
      };
    } catch (error) {
      return {
        provider: PROVIDER,
        ok: false,
        checkedAt: now(),
        latencyMs: Date.now() - started,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getConversationCapabilities(): ProviderConversationCapabilities {
    return {
      resume: true,
      fork: true,
      compact: true,
      handoff: "native",
      contextUsage: "detailed",
    };
  }

  async inspectConversation(
    sessionRef: string,
  ): Promise<ProviderConversationState> {
    try {
      const manager = await SessionManager.open(sessionRef, undefined, undefined, {
        initialCwd: nonEmpty(this.config.cwd) ?? process.cwd(),
        suppressBreadcrumb: true,
      });
      const { session } = await this.createConversationSession(manager);
      const usage = session.getContextUsage();
      await session.dispose();
      return {
        available: true,
        sessionRef,
        compacted: manager.getEntries().some((entry) => entry.type === "compaction"),
        contextTokens: usage?.tokens,
        contextWindow: usage?.contextWindow,
      };
    } catch {
      return { available: false, sessionRef, compacted: false };
    }
  }

  async handoffConversation(
    input: ProviderConversationHandoffInput,
  ): Promise<ProviderConversationHandoffResult> {
    const cwd = nonEmpty(this.config.cwd) ?? process.cwd();
    const manager = await SessionManager.open(
      input.sessionRef,
      undefined,
      undefined,
      {
        initialCwd: cwd,
        suppressBreadcrumb: true,
      },
    );
    const { session } = await this.createConversationSession(manager);
    try {
      const result = await session.handoff(input.instructions, {
        signal: input.signal,
      });
      const sessionRef = manager.getSessionFile();
      if (!result || !sessionRef) {
        throw new Error("OMP handoff did not create a new session");
      }
      return {
        sessionRef,
        handoffText: result.document,
      };
    } finally {
      await session.dispose();
    }
  }

  async runConversationTurn(
    input: ProviderConversationTurnInput,
  ): Promise<ProviderConversationTurnResult> {
    const cwd = nonEmpty(this.config.cwd) ?? process.cwd();
    const manager = input.mode === "fork"
      ? await SessionManager.forkFrom(input.sessionRef, cwd)
      : await SessionManager.open(input.sessionRef, undefined, undefined, {
          initialCwd: cwd,
          suppressBreadcrumb: true,
        });
    const { session } = await this.createConversationSession(manager);
    const chunks: string[] = [];
    let compacted = manager.getEntries().some((entry) => entry.type === "compaction");
    const unsubscribe = session.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        chunks.push(event.assistantMessageEvent.delta);
      }
      if (event.type === "auto_compaction_end" && !event.aborted) compacted = true;
    });
    const abort = () => session.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      await session.prompt(input.prompt, { expandPromptTemplates: false });
      const usage = session.getContextUsage();
      return {
        sessionRef: manager.getSessionFile() ?? input.sessionRef,
        outputText: chunks.join("") || session.getLastAssistantText() || "",
        usage: usage
          ? {
              inputTokens: usage.tokens,
              totalTokens: usage.tokens,
              contextWindow: usage.contextWindow,
            }
          : null,
        compacted,
      };
    } finally {
      input.signal?.removeEventListener("abort", abort);
      unsubscribe();
      await session.dispose();
    }
  }

  private async createConversationSession(sessionManager: SessionManager) {
    const environment = applySdkEnvironment(this.config);
    const cwd = nonEmpty(this.config.cwd) ?? process.cwd();
    const agentDir = nonEmpty(this.config.codingAgentDirectory) ?? nonEmpty(this.config.configDirectory);
    const setup = await createSdkModelSetup(this.config, environment);
    const settings = await loadSdkSettings(environment, cwd);
    return createAgentSession({
      cwd,
      agentDir,
      modelPattern: setup.modelPattern,
      ...(setup.authStorage ? { authStorage: setup.authStorage } : {}),
      ...(setup.modelRegistry ? { modelRegistry: setup.modelRegistry } : {}),
      settings,
      sessionManager,
      skipPythonPreflight: true,
      hasUI: false,
      enableMCP: false,
      enableLsp: false,
      toolNames: [],
    });
  }

  async createSession(input?: CreateSessionInput): Promise<ProviderSessionRef> {
    const sessionId = input?.sessionKey ?? `${SDK_RUN_PREFIX}-session-${randomUUID()}`;
    return {
      provider: PROVIDER,
      sessionId,
      providerSessionId: sessionId,
      sessionKey: input?.sessionKey,
      createdAt: now(),
      raw: { mode: "sdk" },
    };
  }

  async startRun(input: StartRunInput): Promise<ProviderRunRef> {
    const sessionId = input.sessionId;
    const runId = `${SDK_RUN_PREFIX}-${randomUUID()}`;
    const startedAt = now();
    const handle: SdkRunHandle = {
      ref: {
        provider: PROVIDER,
        runId,
        sessionId,
        providerRunId: runId,
        status: "running",
        startedAt,
        stream: { supported: true, reconnectable: false },
        raw: { mode: "sdk" },
      },
      input,
      abort: new AbortController(),
      sessionId,
      status: "running",
      outputText: "",
      sequence: 0,
      queue: [],
      waiters: [],
      done: false,
      startedAt,
    };
    this.runs.set(runId, handle);

    const queue = new AsyncEventQueue(handle);
    queue.push({ ...eventBase(handle, "run_started"), type: "run_started", run: runRef(handle) });
    this.startSdkTurn(handle, queue).catch((error) => {
      this.fail(handle, queue, error);
    });
    return handle.ref;
  }

  async *streamRun(input: StreamRunInput): AsyncIterable<ProviderRunEvent> {
    const runId = "runId" in input ? input.runId : undefined;
    const handle = runId ? this.runs.get(runId) : undefined;
    if (!handle) throw new Error(`streamRun: unknown OMP SDK runId "${runId ?? ""}"`);
    const queue = new AsyncEventQueue(handle);
    for (;;) {
      const item = await queue.next(input.signal);
      if (item.type === "end") return;
      yield item;
    }
  }

  async getRun(input: GetRunInput): Promise<ProviderRunSnapshot> {
    const handle = this.runs.get(input.runId);
    if (!handle) throw new Error(`getRun: unknown OMP SDK runId "${input.runId}"`);
    return {
      provider: PROVIDER,
      runId: handle.ref.runId,
      sessionId: handle.sessionId,
      nativeRunId: handle.ref.nativeRunId,
      providerRunId: handle.ref.providerRunId,
      status: handle.status,
      rawStatus: handle.status,
      outputText: handle.outputText,
      output: { text: handle.outputText },
      structuredPayload: parseStructuredPayload(handle.outputText),
      usage: null,
      error: handle.error ?? null,
      raw: { mode: "sdk" },
    };
  }

  async cancelRun(input: CancelRunInput): Promise<ProviderRunSnapshot> {
    const handle = this.runs.get(input.runId);
    if (!handle) throw new Error(`cancelRun: unknown OMP SDK runId "${input.runId}"`);
    const queue = new AsyncEventQueue(handle);
    handle.status = "cancelled";
    handle.abort.abort();
    handle.session?.abort();
    queue.push({ ...eventBase(handle, "cancelled"), type: "run_cancelled", run: runRef(handle, "cancelled") });
    this.finish(handle, queue);
    return this.getRun({ runId: input.runId, sessionId: input.sessionId });
  }

  private async startSdkTurn(handle: SdkRunHandle, queue: AsyncEventQueue) {
    const environment = applySdkEnvironment(this.config, handle.ref.runId);
    const cwd = nonEmpty(this.config.cwd) ?? process.cwd();
    const agentDir = nonEmpty(this.config.codingAgentDirectory) ?? nonEmpty(this.config.configDirectory);
    const terminalToolName = nonEmpty(handle.input.terminalToolName);
    const prompt = inputToPrompt(handle.input);
    const runConfig: OmpProviderConfig = {
      ...this.config,
      ...(nonEmpty(handle.input.runtimeConfiguration?.model)
        ? { model: nonEmpty(handle.input.runtimeConfiguration?.model) }
        : {}),
    };
    const setup = await createSdkModelSetup(runConfig, environment);
    const settings = await loadSdkSettings(environment, cwd);
    const resumeSessionRef = nonEmpty(handle.input.resumeSessionRef);
    const sessionManager = resumeSessionRef
      ? await SessionManager.open(resumeSessionRef, undefined, undefined, {
          initialCwd: cwd,
          suppressBreadcrumb: true,
        })
      : SessionManager.create(cwd);
    const readOnlyToolOptions = sdkReadOnlyToolOptions(handle.input.toolPolicy);
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      modelPattern: setup.modelPattern,
      ...(setup.authStorage ? { authStorage: setup.authStorage } : {}),
      ...(setup.modelRegistry ? { modelRegistry: setup.modelRegistry } : {}),
      settings,
      ...sdkToolOptionsForTerminal(terminalToolName, handle.input.control, () => { handle.terminalActionAccepted = true; }),
      ...readOnlyToolOptions,
      sessionManager,
      skipPythonPreflight: true,
      hasUI: false,
    });
    const expectedModel = nonEmpty(handle.input.runtimeConfiguration?.model);
    const actualModel = session.model ? `${session.model.provider}/${session.model.id}` : null;
    try {
      assertExpectedModel(expectedModel, actualModel);
    } catch (error) {
      await session.dispose();
      throw error;
    }
    handle.session = session;
    const persistedSessionRef = session.sessionManager.getSessionFile();
    if (persistedSessionRef) {
      handle.sessionId = persistedSessionRef;
      handle.ref = {
        ...handle.ref,
        sessionId: persistedSessionRef,
        providerRunId: handle.ref.providerRunId ?? handle.ref.runId,
      };
    }
    handle.unsubscribe = session.subscribe((event) => this.onSessionEvent(handle, queue, event));
    if (handle.input.signal) {
      const abort = () => {
        if (handle.status !== "running") return;
        handle.status = "cancelled";
        handle.abort.abort();
        session.abort();
        queue.push({ ...eventBase(handle, "cancelled"), type: "run_cancelled", run: runRef(handle, "cancelled") });
        this.finish(handle, queue);
      };
      handle.inputAbortListener = abort;
      handle.input.signal.addEventListener("abort", abort, { once: true });
    }
    if (this.config.timeoutMs) {
      handle.timer = setTimeout(() => {
        if (handle.status !== "running") return;
        handle.error = `Oh My Pi SDK run timed out after ${this.config.timeoutMs}ms`;
        handle.status = "failed";
        session.abort();
        queue.push({ ...eventBase(handle, "timeout"), type: "run_failed", run: runRef(handle, "failed"), error: handle.error });
        this.finish(handle, queue);
      }, this.config.timeoutMs);
    }

    const ran = await session.prompt(prompt, { expandPromptTemplates: false });
    if (!ran && handle.status === "running") {
      handle.status = "completed";
      queue.push({
        ...eventBase(handle, "completed"),
        type: "run_completed",
        run: runRef(handle, "completed"),
        outputText: handle.outputText,
        output: { text: handle.outputText },
        structuredPayload: parseStructuredPayload(handle.outputText),
        usage: null,
        raw: { promptRan: false },
      });
      this.finish(handle, queue);
    }
  }


  private onSessionEvent(handle: SdkRunHandle, queue: AsyncEventQueue, event: AgentSessionEvent) {
    if (handle.done) return;
    switch (event.type) {
      case "message_update": {
        const update = event.assistantMessageEvent;
        if (update.type === "text_delta") {
          handle.outputText += update.delta;
          queue.push({ ...eventBase(handle, update.type), type: "text_delta", text: update.delta });
        } else if (update.type === "thinking_delta") {
          queue.push({ ...eventBase(handle, update.type), type: "reasoning_delta", text: update.delta, raw: update });
        } else if (update.type === "error") {
          this.fail(handle, queue, update.reason);
        }
        break;
      }
      case "tool_execution_start":
        if (isTerminalRuntimeTool(event.toolName)) {
          handle.terminalAction = {
            name: event.toolName,
            input: asRecord(event.args),
          };
        }
        queue.push({
          ...eventBase(handle, event.type),
          type: "tool_call",
          tool: event.toolName,
          callId: event.toolCallId,
          input: asRecord(event.args),
          status: "pending",
          preview: toolCallPreview(event),
        });
        break;
      case "tool_execution_update":
        queue.push({
          ...eventBase(handle, event.type),
          type: "tool_progress",
          toolName: event.toolName,
          callId: event.toolCallId,
          preview: textContentPreview(event.partialResult),
        });
        break;
      case "tool_execution_end":
        queue.push({
          ...eventBase(handle, event.type),
          type: "tool_completed",
          toolName: event.toolName,
          error: event.isError
            ? { message: sdkToolErrorMessage(event.result), raw: event.result }
            : undefined,
          raw: event.result,
        });
        queue.push({
          ...eventBase(handle, `${event.type}:result`),
          type: "tool_result",
          tool: event.toolName,
          callId: event.toolCallId,
          result: event.result,
        });
        break;
      case "turn_start":
      case "turn_end":
      case "auto_compaction_start":
      case "auto_compaction_end":
      case "auto_retry_start":
      case "auto_retry_end":
      case "retry_fallback_applied":
      case "retry_fallback_succeeded":
      case "notice":
      case "todo_reminder":
      case "todo_auto_clear":
      case "thinking_level_changed": {
        const message = sdkLifecycleSummary(event);
        if (message) queue.push({ ...eventBase(handle, event.type), type: "raw_event", raw: { message } });
        break;
      }
      case "agent_end": {
        if (handle.status !== "running") break;
        const outcome = agentEndOutcome(event, handle.terminalActionAccepted === true);
        if (outcome.status === "failed") {
          handle.error = outcome.error;
          handle.status = "failed";
          queue.push({
            ...eventBase(handle, event.type),
            type: "run_failed",
            run: runRef(handle, "failed"),
            error: outcome.error,
            raw: event,
          });
          this.finish(handle, queue);
          break;
        }
        handle.status = "completed";
        queue.push({
          ...eventBase(handle, event.type),
          type: "run_completed",
          run: runRef(handle, "completed"),
          outputText: handle.outputText,
          output: { text: handle.outputText },
          structuredPayload: parseStructuredPayload(handle.outputText),
          usage: null,
          raw: handle.terminalAction ? { ...asRecord(event), terminalTool: handle.terminalAction } : event,
        });
        this.finish(handle, queue);
        break;
      }
      default:
        break;
    }
  }

  private fail(handle: SdkRunHandle, queue: AsyncEventQueue, error: unknown) {
    if (handle.done) return;
    handle.status = handle.abort.signal.aborted ? "cancelled" : "failed";
    if (handle.status === "cancelled") {
      queue.push({ ...eventBase(handle, "cancelled"), type: "run_cancelled", run: runRef(handle, "cancelled") });
    } else {
      handle.error = error instanceof Error ? error.message : String(error);
      queue.push({ ...eventBase(handle, "error"), type: "run_failed", run: runRef(handle, "failed"), error: handle.error });
    }
    this.finish(handle, queue);
  }

  private finish(handle: SdkRunHandle, queue: AsyncEventQueue) {
    if (handle.done) return;
    handle.done = true;
    clearTimeout(handle.timer);
    if (handle.input.signal && handle.inputAbortListener) {
      handle.input.signal.removeEventListener("abort", handle.inputAbortListener);
    }
    handle.unsubscribe?.();
    handle.session?.dispose();
    queue.push({ type: "end" });
  }
}
