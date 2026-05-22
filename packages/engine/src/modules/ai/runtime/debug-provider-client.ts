import type {
  AgentProviderClient,
  CancelRunInput,
  CreateSessionInput,
  GetRunInput,
  HealthCheckInput,
  ProviderCapabilities,
  ProviderHealth,
  ProviderRunEvent,
  ProviderRunRef,
  ProviderRunSnapshot,
  StartRunInput,
  StreamRunInput,
} from "@chrona/providers-foundation";

export const CHRONA_DEBUG_PROVIDER_URL = "chrona-debug://provider";

const PLAN_TOOL = "chrona_plan_generate";
const TASK_COMPLETE_TOOL = "chrona_task_complete";

type DebugRun = {
  runId: string;
  sessionId: string;
  sessionKey?: string;
};

export function isChronaDebugProviderUrl(value: unknown) {
  return (
    typeof value === "string" && value.trim() === CHRONA_DEBUG_PROVIDER_URL
  );
}

export function isChronaDebugProviderConfig(config: { baseUrl?: string }) {
  return isChronaDebugProviderUrl(config.baseUrl);
}

function now() {
  return new Date().toISOString();
}

function createRun(input: {
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
}): DebugRun {
  console.log("Creating debug run with input:", input);
  return {
    runId: input.runId ?? `chrona-debug-run-${crypto.randomUUID()}`,
    sessionId: input.sessionId ?? `chrona-debug-session-${crypto.randomUUID()}`,
    sessionKey: input.sessionKey,
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
    stream: { supported: true, reconnectable: true },
  };
}

function debugPlanBlueprint() {
  return {
    title: "SSE Debug Plan",
    goal: "Generate deterministic provider, execution, runtime sync, and workspace projection events for manual SSE debugging.",
    nodes: [
      {
        id: "debug_prepare",
        type: "task",
        title: "Debug prepare output",
        executor: "ai",
        mode: "auto",
        expectedOutput: "Provider emits generation and first execution output.",
        completionCriteria: [
          "Generation stream and first runtime stream are visible.",
        ],
      },
      {
        id: "debug_execute",
        type: "task",
        title: "Debug execution output",
        executor: "ai",
        mode: "auto",
        expectedOutput: "Provider emits middle-node execution output.",
        completionCriteria: ["Runtime sync completes the second node."],
      },
      {
        id: "debug_verify",
        type: "task",
        title: "Debug completion output",
        executor: "ai",
        mode: "auto",
        expectedOutput:
          "Provider emits final execution output and task completion follows.",
        completionCriteria: ["Workspace reaches completed status."],
      },
    ],
    edges: [
      { from: "debug_prepare", to: "debug_execute" },
      { from: "debug_execute", to: "debug_verify" },
    ],
  };
}

function inputRecord(input: StreamRunInput): Record<string, unknown> | null {
  const candidate = "input" in input ? input.input : null;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : null;
}

function currentNodeTitle(input: StreamRunInput) {
  const record = inputRecord(input);
  const node = record?.node;
  if (!node || typeof node !== "object" || Array.isArray(node))
    return "debug node";
  const title = (node as Record<string, unknown>).title;
  return typeof title === "string" && title.trim()
    ? title.trim()
    : "debug node";
}

function isPlanGeneration(input: StreamRunInput) {
  return "instructions" in input && input.instructions.includes(PLAN_TOOL);
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

  constructor(provider = "chrona-debug") {
    this.provider = provider;
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    return {
      supportsSessions: true,
      supportsStreaming: true,
      supportsRunLookup: true,
      supportsCancellation: true,
      supportsToolCalls: true,
      supportsPreviousResponse: false,
      reason: "Chrona local deterministic debug provider",
    };
  }

  async checkHealth(_input: HealthCheckInput = {}): Promise<ProviderHealth> {
    return {
      provider: this.provider,
      ok: true,
      checkedAt: now(),
      latencyMs: 0,
      status: "ok",
      reason: "Chrona debug provider is local and deterministic",
    };
  }

  async createSession(input: CreateSessionInput = {}) {
    const sessionId =
      input.sessionKey ?? `chrona-debug-session-${crypto.randomUUID()}`;
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
    return providerRunRef(
      this.provider,
      createRun({ sessionId: input.sessionId, sessionKey: input.sessionKey }),
    );
  }

  async *streamRun(input: StreamRunInput): AsyncIterable<ProviderRunEvent> {
    const run = createRun({
      runId: "runId" in input ? input.runId : undefined,
      sessionId: "sessionId" in input ? input.sessionId : undefined,
      sessionKey: "sessionKey" in input ? input.sessionKey : undefined,
    });
    const signal = "signal" in input ? input.signal : undefined;
    let sequence = 0;

    yield {
      ...eventBase(this.provider, run, sequence++),
      type: "run_started",
      run: providerRunRef(this.provider, run),
    };
    await pause(signal);

    if (isPlanGeneration(input)) {
      yield {
        ...eventBase(this.provider, run, sequence++),
        type: "reasoning_delta",
        text: "Debug provider: building deterministic SSE test plan.",
      };
      await pause(signal);
      yield {
        ...eventBase(this.provider, run, sequence++),
        type: "text_delta",
        text: "Debug plan generation output: prepare -> execute -> verify.\n",
      };
      await pause(signal);
      yield {
        ...eventBase(this.provider, run, sequence++),
        type: "tool_call",
        tool: PLAN_TOOL,
        callId: "chrona-debug-plan-call",
        input: debugPlanBlueprint(),
        status: "completed",
      };
      await pause(signal);
      yield {
        ...eventBase(this.provider, run, sequence++),
        type: "tool_result",
        tool: PLAN_TOOL,
        callId: "chrona-debug-plan-call",
        result: { ok: true, message: "Debug plan emitted." },
      };
    } else {
      const title = currentNodeTitle(input);
      const callId = `chrona-debug-complete-${sequence}`;
      yield {
        ...eventBase(this.provider, run, sequence++),
        type: "reasoning_delta",
        text: `Debug provider: executing ${title}.`,
      };
      await pause(signal);
      yield {
        ...eventBase(this.provider, run, sequence++),
        type: "text_delta",
        text: `Debug execution output for ${title}.\n`,
      };
      await pause(signal);
      yield {
        ...eventBase(this.provider, run, sequence++),
        type: "tool_call",
        tool: TASK_COMPLETE_TOOL,
        callId,
        input: {
          summary: `Debug provider completed ${title}.`,
          outputs: [
            {
              kind: "json",
              value: { provider: "chrona-debug", nodeTitle: title },
            },
          ],
        },
        status: "completed",
      };
      await pause(signal);
      yield {
        ...eventBase(this.provider, run, sequence++),
        type: "tool_result",
        tool: TASK_COMPLETE_TOOL,
        callId,
        result: { ok: true, message: `Debug provider completed ${title}.` },
      };
    }

    await pause(signal);
    yield {
      ...eventBase(this.provider, run, sequence),
      type: "run_completed",
      run: providerRunRef(this.provider, run, "completed"),
      outputText: isPlanGeneration(input)
        ? "Debug plan generation completed."
        : `Debug runtime run completed for ${currentNodeTitle(input)}.`,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    };
  }

  async getRun(input: GetRunInput): Promise<ProviderRunSnapshot> {
    return {
      provider: this.provider,
      runId: input.runId,
      nativeRunId: input.runId,
      providerRunId: input.runId,
      sessionId: input.sessionId ?? input.sessionKey ?? input.runId,
      status: "completed",
      outputText: `Debug runtime run ${input.runId} completed during sync.`,
      error: null,
      raw: { debugProvider: true },
    };
  }

  async cancelRun(input: CancelRunInput): Promise<ProviderRunSnapshot> {
    return {
      provider: this.provider,
      runId: input.runId,
      nativeRunId: input.runId,
      providerRunId: input.runId,
      sessionId: input.sessionId ?? input.runId,
      status: "cancelled",
      error: null,
      raw: { debugProvider: true, cancelled: true },
    };
  }
}
