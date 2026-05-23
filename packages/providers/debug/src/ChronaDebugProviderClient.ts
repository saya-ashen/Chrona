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

export const CHRONA_DEBUG_PROVIDER_TYPE = "debug";

const PLAN_TOOL = "chrona_plan_generate";
const TASK_COMPLETE_TOOL = "chrona_task_complete";

type DebugRun = {
  runId: string;
  sessionId: string;
  sessionKey?: string;
  input?: StartRunInput;
  status: ProviderRunRef["status"];
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
    runId: input.runId ?? `chrona-debug-run-${crypto.randomUUID()}`,
    sessionId: input.sessionId ?? `chrona-debug-session-${crypto.randomUUID()}`,
    sessionKey: input.sessionKey,
    input: input.startInput,
    status: "running",
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
    title: "SSE Boundary Debug Plan",
    goal: "Exercise deterministic provider streaming, parallel starts, human gates, branch routing, waits, risky-action approvals, joins, and workspace projection boundaries.",
    assumptions: [
      "This plan is synthetic and should be safe to run repeatedly.",
      "All node ids are stable so runtime projections can be compared across runs.",
    ],
    nodes: [
      {
        id: "debug_collect_context",
        type: "task",
        title: "Collect boundary context",
        executor: "ai",
        mode: "auto",
        estimatedMinutes: 2,
        expectedOutput: "Structured context summary with stream, graph, and workspace projection constraints.",
        completionCriteria: "Generation stream and first runtime stream are visible with stable node mapping.",
      },
      {
        id: "debug_load_fixture",
        type: "task",
        title: "Load deterministic fixture",
        executor: "system",
        mode: "auto",
        estimatedMinutes: 1,
        expectedOutput: "Fixture payload containing large text, empty arrays, nested metadata, and nullable values.",
        completionCriteria: "Runtime accepts non-user system output without provider-specific fields leaking into the workspace.",
      },
      {
        id: "debug_user_boundary_input",
        type: "checkpoint",
        title: "Capture boundary choices",
        checkpointType: "input",
        prompt: "Provide boundary-case inputs used to validate checkpoint rendering and resume behavior.",
        required: true,
        inputFields: [
          {
            key: "scenario_label",
            label: "Scenario label",
            inputType: "text",
            required: true,
          },
          {
            key: "include_slow_wait",
            label: "Include slow wait path",
            inputType: "boolean",
            required: false,
          },
          {
            key: "priority",
            label: "Priority",
            inputType: "choice",
            required: true,
            options: ["low", "normal", "urgent"],
          },
        ],
      },
      {
        id: "debug_route_boundary",
        type: "condition",
        title: "Route boundary scenario",
        condition: "Does the checkpoint input request the slow external wait path?",
        evaluationBy: "system",
        branches: [
          { label: "slow wait", nextNodeId: "debug_wait_external_event" },
          { label: "fast path", nextNodeId: "debug_validate_parallel_join" },
        ],
        defaultNextNodeId: "debug_validate_parallel_join",
      },
      {
        id: "debug_wait_external_event",
        type: "wait",
        title: "Wait for external boundary event",
        waitFor: "Synthetic external event or timeout used to test waiting, cancellation, and resume projection.",
        estimatedMinutes: 3,
        timeout: {
          minutes: 5,
          onTimeout: "notify_user",
        },
      },
      {
        id: "debug_validate_parallel_join",
        type: "task",
        title: "Validate parallel branch join",
        executor: "ai",
        mode: "auto",
        estimatedMinutes: 2,
        expectedOutput: "Join report proving context, fixture, and optional wait outputs are available exactly once.",
        completionCriteria: "Workspace shows upstream branches completed or skipped without duplicate execution attempts.",
      },
      {
        id: "debug_approve_risky_projection",
        type: "checkpoint",
        title: "Approve risky projection update",
        checkpointType: "approve",
        prompt: "Approve the synthetic risky action so downstream execution can verify approval-gated tasks.",
        required: true,
      },
      {
        id: "debug_apply_risky_projection",
        type: "task",
        title: "Apply risky projection update",
        executor: "system",
        mode: "auto",
        estimatedMinutes: 1,
        expectedOutput: "Synthetic mutation record with before/after workspace projection metadata.",
        completionCriteria: "Risky task only runs after approval checkpoint completion.",
      },
      {
        id: "debug_manual_review",
        type: "task",
        title: "Manual review boundary state",
        executor: "user",
        mode: "manual",
        estimatedMinutes: 2,
        expectedOutput: "Human-visible review note confirming active node, blocked state, and primary action are obvious.",
        completionCriteria: "Manual node can be completed without provider execution and downstream state resumes.",
      },
      {
        id: "debug_complete_boundary_run",
        type: "task",
        title: "Complete boundary run",
        executor: "ai",
        mode: "auto",
        estimatedMinutes: 1,
        expectedOutput: "Final deterministic debug output with all boundary node statuses summarized.",
        completionCriteria: "Workspace reaches completed status with no unresolved waits, approvals, or branch targets.",
      },
    ],
    edges: [
      { from: "debug_collect_context", to: "debug_user_boundary_input" },
      { from: "debug_load_fixture", to: "debug_user_boundary_input" },
      { from: "debug_user_boundary_input", to: "debug_route_boundary" },
      { from: "debug_route_boundary", to: "debug_wait_external_event", label: "slow wait" },
      { from: "debug_route_boundary", to: "debug_validate_parallel_join", label: "fast path" },
      { from: "debug_wait_external_event", to: "debug_validate_parallel_join" },
      { from: "debug_validate_parallel_join", to: "debug_approve_risky_projection" },
      { from: "debug_approve_risky_projection", to: "debug_apply_risky_projection" },
      { from: "debug_apply_risky_projection", to: "debug_manual_review" },
      { from: "debug_manual_review", to: "debug_complete_boundary_run" },
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

function streamInputForRun(run: DebugRun, input: StreamRunInput): StreamRunInput {
  if ("instructions" in input) return input;
  if (!run.input) return input;
  return { ...run.input, runId: run.runId, signal: input.signal, stream: true };
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
  private readonly runs = new Map<string, DebugRun>();

  constructor(provider = CHRONA_DEBUG_PROVIDER_TYPE) {
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
    const run = createRun({
      sessionId: input.sessionId,
      sessionKey: input.sessionKey,
      startInput: input,
    });
    this.runs.set(run.runId, run);
    return providerRunRef(this.provider, run);
  }

  async *streamRun(input: StreamRunInput): AsyncIterable<ProviderRunEvent> {
    const inputRunId = "runId" in input ? input.runId : undefined;
    const existingRun = inputRunId ? this.runs.get(inputRunId) : null;
    const run = existingRun ?? createRun({
      runId: inputRunId,
      sessionId: "sessionId" in input ? input.sessionId : undefined,
      sessionKey: "sessionKey" in input ? input.sessionKey : undefined,
      startInput: "instructions" in input ? input : undefined,
    });
    this.runs.set(run.runId, run);
    run.status = "running";
    const streamInput = streamInputForRun(run, input);
    const signal = "signal" in input ? input.signal : undefined;
    let sequence = 0;

    yield {
      ...eventBase(this.provider, run, sequence++),
      type: "run_started",
      run: providerRunRef(this.provider, run),
    };
    await pause(signal);

    if (isPlanGeneration(streamInput)) {
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
      const title = currentNodeTitle(streamInput);
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
              value: { provider: this.provider, nodeTitle: title },
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
    run.status = "completed";
    yield {
      ...eventBase(this.provider, run, sequence),
      type: "run_completed",
      run: providerRunRef(this.provider, run, "completed"),
      outputText: isPlanGeneration(streamInput)
        ? "Debug plan generation completed."
        : `Debug runtime run completed for ${currentNodeTitle(streamInput)}.`,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    };
  }

  async getRun(input: GetRunInput): Promise<ProviderRunSnapshot> {
    const run = this.runs.get(input.runId);
    return {
      provider: this.provider,
      runId: input.runId,
      nativeRunId: input.runId,
      providerRunId: input.runId,
      sessionId: run?.sessionId ?? input.sessionId ?? input.sessionKey ?? input.runId,
      status: run?.status ?? "completed",
      outputText: `Debug runtime run ${input.runId} completed during sync.`,
      error: null,
      raw: { debugProvider: true },
    };
  }

  async cancelRun(input: CancelRunInput): Promise<ProviderRunSnapshot> {
    const run = this.runs.get(input.runId);
    if (run) run.status = "cancelled";
    return {
      provider: this.provider,
      runId: input.runId,
      nativeRunId: input.runId,
      providerRunId: input.runId,
      sessionId: run?.sessionId ?? input.sessionId ?? input.runId,
      status: "cancelled",
      error: null,
      raw: { debugProvider: true, cancelled: true },
    };
  }
}
