import {
  BoundedTerminalRunSnapshots,
  readProviderReplayTape,
  terminalSnapshotFromEvents,
  type AgentProviderClient,
  type CancelRunInput,
  type CreateSessionInput,
  type FindRunByClientOperationInput,
  type GetRunInput,
  type HealthCheckInput,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderRunEvent,
  type ProviderRunRef,
  type ProviderRunSnapshot,
  type ProviderToolResultInput,
  type ProviderToolResultOutcome,
  type StartRunInput,
  type StreamRunInput,
} from "@chrona/providers-foundation";
export const CHRONA_DEBUG_PROVIDER_TYPE = "debug";
export const DEBUG_PROVIDER_PROFILES = [
  "deterministic",
  "tool-submit",
  "hermes-like",
] as const;

export type DebugProviderProfile = typeof DEBUG_PROVIDER_PROFILES[number];

export type ChronaDebugProviderConfig = {
  provider?: string;
  profile?: DebugProviderProfile;
};

const DEFAULT_DEBUG_PROVIDER_PROFILE: DebugProviderProfile = "deterministic";

type DebugRun = {
  runId: string;
  sessionId: string;
  sessionKey?: string;
  input?: StartRunInput;
  status: ProviderRunRef["status"];
  outputText?: string;
  error?: string;
  pendingToolResults: Map<string, ProviderToolResultInput | null>;
  phase: "initial" | "awaiting_tool_result" | "after_tool_result";
  pendingCallId?: string;
  pendingToolName?: string;
  sequence: number;
};

function now() {
  return new Date().toISOString();
}

function createRun(input: {
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  startInput?: StartRunInput;
}): DebugRun {
  return {
    runId: input.runId ?? `debug-run-${crypto.randomUUID()}`,
    sessionId: input.sessionId ?? `debug-session-${crypto.randomUUID()}`,
    sessionKey: input.sessionKey,
    input: input.startInput,
    status: "running",
    pendingToolResults: new Map(),
    phase: "initial",
    sequence: 0,
  };
}

function providerRunRef(
  provider: string,
  run: DebugRun,
  status: ProviderRunRef["status"] = "running",
): ProviderRunRef {
  return {
    provider,
    runId: run.runId,
    nativeRunId: run.runId,
    providerRunId: run.runId,
    sessionId: run.sessionId,
    status,
    startedAt: now(),
    providerResumeRef: run.runId,
    stream: { supported: true, reconnectable: true },
  };
}

export function normalizeDebugProviderProfile(input: unknown): DebugProviderProfile {
  return DEBUG_PROVIDER_PROFILES.includes(input as DebugProviderProfile)
    ? input as DebugProviderProfile
    : DEFAULT_DEBUG_PROVIDER_PROFILE;
}


const MAX_SCHEMA_DEPTH = 4;
const MAX_SCHEMA_ELEMENTS = 16;
const MAX_ARRAY_ITEMS = 4;
const MAX_OBJECT_PROPERTIES = 12;
const NO_SCHEMA_VALUE = Symbol("no-schema-value");

type JsonSchema = Record<string, unknown>;

type SynthesisState = {
  remaining: number;
};

function asJsonSchema(value: unknown): JsonSchema | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonSchema
    : null;
}

function schemaSample(schema: JsonSchema): unknown | typeof NO_SCHEMA_VALUE {
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];
  if (Object.hasOwn(schema, "default")) return schema.default;
  if (Object.hasOwn(schema, "const")) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  return NO_SCHEMA_VALUE;
}

function schemaCost(schema: JsonSchema, depth = 0): number {
  if (depth >= MAX_SCHEMA_DEPTH || schemaSample(schema) !== NO_SCHEMA_VALUE) return 1;
  const branches = [
    ...(Array.isArray(schema.oneOf) ? schema.oneOf : []),
    ...(Array.isArray(schema.anyOf) ? schema.anyOf : []),
  ];
  if (branches.length > 0) {
    const costs = branches
      .map(asJsonSchema)
      .filter((branch): branch is JsonSchema => branch !== null)
      .map((branch) => schemaCost(branch, depth + 1));
    return costs.length > 0 ? Math.min(...costs) : Number.POSITIVE_INFINITY;
  }
  if (schema.type === "array") return 1 + Math.min(MAX_ARRAY_ITEMS, Math.max(0, Number(schema.minItems) || 0));
  if (schema.type === "object" || schema.properties || schema.required) {
    const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : [];
    return 1 + Math.min(MAX_OBJECT_PROPERTIES, required.length);
  }
  return 1;
}

function smallestSchemaBranch(schema: JsonSchema): JsonSchema | null {
  const branches = [
    ...(Array.isArray(schema.oneOf) ? schema.oneOf : []),
    ...(Array.isArray(schema.anyOf) ? schema.anyOf : []),
  ];
  return branches
    .map(asJsonSchema)
    .filter((branch): branch is JsonSchema => branch !== null)
    .reduce<JsonSchema | null>((best, branch) => !best || schemaCost(branch) < schemaCost(best) ? branch : best, null);
}

function boundedJsonValue(value: unknown, depth: number, state: SynthesisState): unknown {
  if (state.remaining <= 0 || depth >= MAX_SCHEMA_DEPTH) return null;
  state.remaining -= 1;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => boundedJsonValue(item, depth + 1, state));
  }
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_OBJECT_PROPERTIES)
      .map(([key, item]) => [key, boundedJsonValue(item, depth + 1, state)]),
  );
}

function synthesizeJsonSchema(schemaValue: unknown, depth = 0, state: SynthesisState = { remaining: MAX_SCHEMA_ELEMENTS }): unknown {
  const schema = asJsonSchema(schemaValue);
  if (!schema || state.remaining <= 0 || depth >= MAX_SCHEMA_DEPTH) return null;

  const sample = schemaSample(schema);
  if (sample !== NO_SCHEMA_VALUE) return boundedJsonValue(sample, depth, state);

  const branch = smallestSchemaBranch(schema);
  if (branch) return synthesizeJsonSchema(branch, depth + 1, state);

  state.remaining -= 1;
  const type = Array.isArray(schema.type)
    ? schema.type.find((candidate): candidate is string => typeof candidate === "string" && candidate !== "null") ?? schema.type[0]
    : schema.type;
  if (type === "string") {
    const minLength = typeof schema.minLength === "number" && Number.isFinite(schema.minLength)
      ? Math.max(0, Math.floor(schema.minLength))
      : 0;
    return "x".repeat(Math.min(256, minLength));
  }
  if (type === "number" || type === "integer") return 0;
  if (type === "boolean") return false;
  if (type === "null") return null;
  if (type === "array") {
    const minItems = typeof schema.minItems === "number" && Number.isFinite(schema.minItems)
      ? Math.max(0, Math.floor(schema.minItems))
      : 0;
    return Array.from({ length: Math.min(MAX_ARRAY_ITEMS, minItems) }, () => synthesizeJsonSchema(schema.items, depth + 1, state));
  }
  if (type === "object" || schema.properties || schema.required) {
    const properties = asJsonSchema(schema.properties) ?? {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === "string")
      : [];
    const keys = [...new Set([...required, ...Object.keys(properties)])].slice(0, MAX_OBJECT_PROPERTIES);
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (state.remaining <= 0) break;
      result[key] = synthesizeJsonSchema(properties[key], depth + 1, state);
    }
    return result;
  }
  return null;
}


function eventBase(provider: string, run: DebugRun, sequence: number) {
  return {
    provider,
    runId: run.runId,
    nativeRunId: run.runId,
    sessionId: run.sessionId,
    sequence,
    timestamp: now(),
  };
}

async function pause(signal?: AbortSignal) {
  if (signal?.aborted)
    throw signal.reason ?? new Error("Debug provider stream aborted");
  await new Promise((resolve) => setTimeout(resolve, 120));
}

export class ChronaDebugProviderClient implements AgentProviderClient {
  readonly provider: string;
  readonly profile: DebugProviderProfile;
  private readonly runs = new Map<string, DebugRun>();
  private readonly terminalSnapshots = new BoundedTerminalRunSnapshots();
  private readonly runsByClientOperation = new Map<string, DebugRun>();
  private replayTape?: Awaited<ReturnType<typeof readProviderReplayTape>>;

  constructor(config: ChronaDebugProviderConfig | string = {}) {
    const resolvedConfig = typeof config === "string" ? { provider: config } : config;
    this.provider = resolvedConfig.provider ?? CHRONA_DEBUG_PROVIDER_TYPE;
    this.profile = normalizeDebugProviderProfile(
      resolvedConfig.profile ?? process.env.CHRONA_DEBUG_PROFILE,
    );
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    return {
      supportsSessions: true,
      supportsStreaming: true,
      supportsRunLookup: true,
      supportsCancellation: true,
      supportsToolCalls: true,
      supportsPreviousResponse: false,
      actionInvocation: "engine_managed",
      startIdempotency: "client_operation_id",
      lookupByClientOperationId: true,
      recovery: {
        sessionResume: true,
        historyReplay: true,
        activeRunLookup: true,
        streamReconnect: true,
        crossProcessDurable: false,
        providerResumeRef: true,
        runEventReplay: true,
        mode: "local_stream_only",
      },
      reason: `Local debug provider (${this.profile})`,
    };
  }

  async checkHealth(_input: HealthCheckInput = {}): Promise<ProviderHealth> {
    return {
      provider: this.provider,
      ok: true,
      checkedAt: now(),
      latencyMs: 0,
      status: "ok",
      reason: `Debug provider is local (${this.profile})`,
    };
  }

  async createSession(input: CreateSessionInput = {}) {
    const sessionId = input.sessionKey ?? `debug-session-${crypto.randomUUID()}`;
    return {
      provider: this.provider,
      sessionId,
      nativeSessionId: sessionId,
      providerSessionId: sessionId,
      state: "virtual",
      sessionKey: input.sessionKey,
      createdAt: now(),
    };
  }

  async startRun(input: StartRunInput): Promise<ProviderRunRef> {
    const attached = this.runsByClientOperation.get(input.clientOperationId);
    if (attached) return providerRunRef(this.provider, attached, attached.status);

    const replayTape = await this.loadReplayTape();
    if (replayTape?.start) {
      const replayRun = replayTape.start.run;
      const run = createRun({
        runId: replayRun.runId,
        sessionId: replayRun.sessionId,
        sessionKey: input.sessionKey,
        startInput: input,
      });
      this.runs.set(run.runId, run);
      this.runsByClientOperation.set(input.clientOperationId, run);
      return {
        ...replayRun,
        provider: this.provider,
        sessionId: replayRun.sessionId,
        providerResumeRef: replayRun.providerResumeRef ?? replayRun.runId,
      };
    }
    const run = createRun({
      sessionId: input.sessionId,
      sessionKey: input.sessionKey,
      startInput: input,
    });
    this.runs.set(run.runId, run);
    this.runsByClientOperation.set(input.clientOperationId, run);
    return providerRunRef(this.provider, run);
  }

  async findRunByClientOperationId(input: FindRunByClientOperationInput): Promise<ProviderRunRef | null> {
    const run = this.runsByClientOperation.get(input.clientOperationId);
    return run ? providerRunRef(this.provider, run, run.status) : null;
  }

  async submitToolResult(input: ProviderToolResultInput): Promise<ProviderToolResultOutcome> {
    const run = this.runs.get(input.runId);
    if (!run) return { code: "not_pending" };
    if (!run.pendingToolResults.has(input.callId)) return { code: "not_pending" };
    run.pendingToolResults.set(input.callId, input);
    return { code: "accepted" };
  }

  async *streamRun(input: StreamRunInput): AsyncIterable<ProviderRunEvent> {
    const replayTape = await this.loadReplayTape();
    if (replayTape) {
      const signal = "signal" in input ? input.signal : undefined;
      for (const event of replayTape.events) {
        signal?.throwIfAborted();
        yield { ...event, provider: this.provider };
        await pause(signal);
      }
      return;
    }

    const inputRunId = "runId" in input ? input.runId : undefined;
    const run = (inputRunId ? this.runs.get(inputRunId) : undefined) ?? createRun({
      runId: inputRunId,
      sessionId: "sessionId" in input ? input.sessionId : undefined,
      sessionKey: "sessionKey" in input ? input.sessionKey : undefined,
      startInput: "instructions" in input ? input : undefined,
    });
    this.runs.set(run.runId, run);
    run.status = "running";
    const startInput = "instructions" in input ? input : run.input;
    const signal = "signal" in input ? input.signal : undefined;
    let sequence = run.sequence;

    if (run.phase === "initial") {
      yield {
        ...eventBase(this.provider, run, sequence++),
        type: "run_started",
        run: providerRunRef(this.provider, run),
      };
      await pause(signal);

      if (this.profile === "tool-submit" && startInput?.tools?.length) {
        const tool = startInput.tools[0];
        const callId = `debug-pending-${sequence}`;
        run.pendingToolResults.set(callId, null);
        run.pendingCallId = callId;
        run.pendingToolName = tool.name;
        run.phase = "awaiting_tool_result";
        const synthesizedInput = synthesizeJsonSchema(tool.inputSchema);
        yield {
          ...eventBase(this.provider, run, sequence++),
          type: "tool_call",
          tool: tool.name,
          callId,
          input: asJsonSchema(synthesizedInput) ?? {},
          status: "pending",
        };
        run.sequence = sequence;
        return;
      }
    }

    if (run.phase === "awaiting_tool_result") {
      const callId = run.pendingCallId;
      const toolName = run.pendingToolName;
      const submitted = callId ? run.pendingToolResults.get(callId) : undefined;
      if (!callId || !toolName || !submitted) return;
      run.pendingToolResults.delete(callId);
      run.pendingCallId = undefined;
      run.pendingToolName = undefined;
      run.phase = "after_tool_result";
      yield {
        ...eventBase(this.provider, run, sequence++),
        type: "tool_result",
        tool: toolName,
        callId,
        result: submitted.error ? { error: submitted.error } : submitted.result,
      };
      await pause(signal);
    }

    yield {
      ...eventBase(this.provider, run, sequence++),
      type: "reasoning_delta",
      text: `Debug provider ${this.provider} is processing this session.`,
    };
    await pause(signal);
    yield {
      ...eventBase(this.provider, run, sequence++),
      type: "text_delta",
      text: `Debug provider ${this.provider} completed its response.\n`,
    };
    await pause(signal);

    const terminalToolName = startInput?.terminalToolName;
    if (terminalToolName) {
      const terminalTool = startInput.tools?.find((tool) => tool.name === terminalToolName);
      const callId = `debug-terminal-${sequence}`;
      const synthesizedInput = synthesizeJsonSchema(terminalTool?.inputSchema);
      const toolInput = asJsonSchema(synthesizedInput) ?? {};
      yield {
        ...eventBase(this.provider, run, sequence++),
        type: "tool_call",
        tool: terminalToolName,
        callId,
        input: toolInput,
        status: "completed",
      };
      await pause(signal);
      yield {
        ...eventBase(this.provider, run, sequence++),
        type: "tool_result",
        tool: terminalToolName,
        callId,
        result: toolInput,
      };
      await pause(signal);
    }

    const outputText = `Debug provider ${this.provider} completed the session.`;
    const structuredPayload = !terminalToolName && startInput?.structuredOutputSchema
      ? { parsed: synthesizeJsonSchema(startInput.structuredOutputSchema.schema) }
      : undefined;
    this.finishRun(run, { status: "completed", outputText });
    yield {
      ...eventBase(this.provider, run, sequence),
      type: "run_completed",
      run: providerRunRef(this.provider, run, "completed"),
      outputText,
      output: { text: outputText },
      structuredPayload,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      raw: { debugProvider: true, profile: this.profile },
    };
  }

  async getRun(input: GetRunInput): Promise<ProviderRunSnapshot> {
    const replayTape = await this.loadReplayTape();
    const replaySnapshot = replayTape?.snapshot ?? terminalSnapshotFromEvents(replayTape?.events ?? []);
    if (replaySnapshot) {
      return {
        ...replaySnapshot,
        provider: this.provider,
        runId: input.runId,
        providerRunId: replaySnapshot.providerRunId ?? replaySnapshot.runId,
      };
    }
    const run = this.runs.get(input.runId);
    if (run) return this.snapshot(run);
    const snapshot = this.terminalSnapshots.get(input.runId);
    if (snapshot) return snapshot;
    throw new Error(`getRun: unknown debug runId "${input.runId}"`);
  }

  async cancelRun(input: CancelRunInput): Promise<ProviderRunSnapshot> {
    const run = this.runs.get(input.runId);
    if (run) {
      this.finishRun(run, { status: "cancelled" });
      return this.snapshot(run);
    }
    const snapshot = this.terminalSnapshots.get(input.runId);
    if (snapshot) return snapshot;
    throw new Error(`cancelRun: unknown debug runId "${input.runId}"`);
  }

  private snapshot(run: DebugRun): ProviderRunSnapshot {
    return {
      provider: this.provider,
      runId: run.runId,
      nativeRunId: run.runId,
      providerRunId: run.runId,
      sessionId: run.sessionId,
      providerResumeRef: run.runId,
      status: run.status ?? "completed",
      outputText: run.outputText,
      error: run.error ?? null,
      raw: { debugProvider: true, profile: this.profile },
    };
  }

  private finishRun(run: DebugRun, update: { status: NonNullable<ProviderRunRef["status"]>; outputText?: string; error?: string }): void {
    run.status = update.status;
    run.outputText = update.outputText;
    run.error = update.error;
    this.runs.delete(run.runId);
    this.terminalSnapshots.set(this.snapshot(run));
  }

  private async loadReplayTape() {
    if (this.replayTape) {
      return this.replayTape;
    }
    const path = process.env.CHRONA_DEBUG_REPLAY_FILE?.trim();
    if (!path) {
      return undefined;
    }
    this.replayTape = await readProviderReplayTape(path);
    return this.replayTape;
  }
}
