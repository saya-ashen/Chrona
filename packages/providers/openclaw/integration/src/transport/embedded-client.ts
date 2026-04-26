import type {
  OpenClawRuntimeClient,
  OpenClawWaitForRunInput,
} from "../runtime/runtime-client";
import type {
  OpenClawApprovalDecision,
  OpenClawApprovalRequest,
  OpenClawApprovalRequestResult,
  OpenClawApprovalResolution,
  OpenClawChatHistory,
  OpenClawHello,
  OpenClawPendingApproval,
  OpenClawRunSnapshot,
  OpenClawSendInput,
  OpenClawSendInputResult,
  OpenClawStructuredRunResult,
} from "../protocol/types";
import type {
  BridgeExecutionTaskRequest,
  BridgeFeature,
  BridgeFeatureRequest,
  BridgeResponse,
  NDJSONEvent,
} from "./bridge-types";
import type { RuntimeInput } from "@chrona/runtime-core";
import {
  checkGatewayAvailable,
  executeGatewayRequest,
  noopBridgeLogger,
} from "../provider-core/executor";
import { DEFAULT_OPENCLAW_ENVIRONMENT } from "../provider-core/constants";
import type { BridgeEnvironment } from "../provider-core/types";

export type OpenClawEmbeddedClientOptions = {
  timeoutSeconds?: number;
  onEvent?: (event: NDJSONEvent) => void;
  environment?: BridgeEnvironment;
};

export type SessionState = {
  sessionId: string;
  sessionKey: string;
  messages: Array<Record<string, unknown>>;
  lastRunRef: string | null;
  lastResponseId: string | null;
  lastRunStatus: OpenClawRunSnapshot["status"];
  lastOutput: string;
  toolCalls: Array<{
    tool: string;
    callId: string;
    input: Record<string, unknown>;
    result?: string;
  }>;
  lastStructured: OpenClawStructuredRunResult | null;
};

export class OpenClawEmbeddedClient implements OpenClawRuntimeClient {
  private timeoutSeconds: number;
  private onEvent?: (event: NDJSONEvent) => void;
  private environment: BridgeEnvironment;
  private sessions = new Map<string, SessionState>();

  constructor(options: OpenClawEmbeddedClientOptions = {}) {
    this.timeoutSeconds = options.timeoutSeconds ?? 300;
    this.onEvent = options.onEvent;
    this.environment = options.environment ?? DEFAULT_OPENCLAW_ENVIRONMENT;
  }

  async connect(): Promise<OpenClawHello> {
    const healthy = await checkGatewayAvailable(this.environment);
    if (!healthy) {
      throw new Error("OpenClaw gateway is not available");
    }

    return {
      protocol: 1,
      methods: [
        "health",
        "features/suggest",
        "features/suggest/stream",
        "features/generate-plan",
        "features/generate-plan/stream",
        "features/analyze-conflicts",
        "features/suggest-timeslot",
        "features/chat",
        "features/dispatch-task",
        "execution/task",
        "execution/task/stream",
      ],
    };
  }

  close(): void {
    // no-op for embedded client
  }

  async createRun(input: {
    prompt: string;
    runtimeInput: RuntimeInput;
    runtimeSessionKey?: string;
  }): Promise<{
    runtimeRunRef?: string;
    runtimeSessionRef?: string;
    runtimeSessionKey?: string;
    runStarted: boolean;
  }> {
    const sessionKey = input.runtimeSessionKey ?? crypto.randomUUID();
    const requestBody: BridgeExecutionTaskRequest = {
      sessionId: sessionKey,
      sessionKey,
      instructions: input.prompt,
      taskTitle:
        typeof input.runtimeInput.prompt === "string" && input.runtimeInput.prompt.trim()
          ? input.runtimeInput.prompt
          : undefined,
      runtimeAdapterKey: "openclaw",
      runtimeInput: input.runtimeInput,
      timeout: this.timeoutSeconds,
    };

    const { response, events } = await executeGatewayRequest(
      { kind: "execution", stream: false },
      requestBody,
      noopBridgeLogger,
      this.environment,
    );
    this.emitEvents(events);
    this.recordBridgeResponse(sessionKey, input.prompt, response);

    return {
      runtimeRunRef: response.responseId ?? response.runId ?? response.sessionId,
      runtimeSessionRef: response.sessionId,
      runtimeSessionKey: sessionKey,
      runStarted: true,
    };
  }

  async createStructuredRun<T = unknown>(input: {
    feature: BridgeFeature;
    prompt: string;
    runtimeSessionKey?: string;
    instructions?: string;
    timeoutSeconds?: number;
  }): Promise<OpenClawStructuredRunResult<T>> {
    const sessionKey = input.runtimeSessionKey ?? crypto.randomUUID();
    const requestBody: BridgeFeatureRequest<Record<string, unknown>> = {
      sessionId: sessionKey,
      sessionKey,
      input: { prompt: input.prompt },
      ...(input.instructions ? { instructions: input.instructions } : {}),
      timeout: input.timeoutSeconds ?? this.timeoutSeconds,
    };

    const { response, events } = await executeGatewayRequest(
      { kind: "feature", feature: input.feature, stream: false },
      requestBody,
      noopBridgeLogger,
      this.environment,
    );
    this.emitEvents(events);
    this.recordBridgeResponse(sessionKey, input.prompt, response);

    return {
      ok: response.structured?.ok ?? false,
      parsed: (response.structured?.parsed ?? null) as T | null,
      source: response.structured?.source,
      feature: response.structured?.feature,
      toolName: response.structured?.toolName,
      rawOutput: response.output,
      error: response.structured?.error ?? response.error,
      validationIssues: response.structured?.validationIssues,
      sessionId: response.sessionId,
      runId: response.responseId ?? response.runId,
      bridgeToolCalls: response.structured?.bridgeToolCalls,
    };
  }

  async waitForRun(
    input: OpenClawWaitForRunInput | string,
  ): Promise<OpenClawRunSnapshot> {
    const key =
      typeof input === "string"
        ? input
        : input.runtimeSessionKey ?? input.runtimeRunRef;
    const session =
      this.sessions.get(key) ??
      Array.from(this.sessions.values()).find(
        (candidate) => candidate.lastRunRef === key || candidate.lastResponseId === key,
      );

    return {
      runtimeRunRef: session?.lastRunRef ?? key,
      runtimeSessionRef: session?.sessionId ?? undefined,
      runtimeSessionKey: session?.sessionKey ?? key,
      status: session?.lastRunStatus ?? "Completed",
      lastMessage: session?.lastOutput,
    };
  }

  async readOutputs(runtimeSessionKey: string): Promise<OpenClawChatHistory> {
    const session = this.sessions.get(runtimeSessionKey);
    return { messages: session?.messages ?? [] };
  }

  async getStructuredResult<T = unknown>(
    runtimeSessionKey: string,
  ): Promise<OpenClawStructuredRunResult<T> | null> {
    const session = this.sessions.get(runtimeSessionKey);
    if (!session?.lastStructured) return null;
    return {
      ...session.lastStructured,
      parsed: (session.lastStructured.parsed ?? null) as T | null,
    };
  }

  async listApprovals(): Promise<OpenClawPendingApproval[]> {
    return [];
  }

  async sendInput(input: OpenClawSendInput): Promise<OpenClawSendInputResult> {
    const requestBody: BridgeExecutionTaskRequest = {
      sessionId: input.runtimeSessionKey,
      sessionKey: input.runtimeSessionKey,
      instructions: input.message,
      timeout: this.timeoutSeconds,
    };

    const { response, events } = await executeGatewayRequest(
      { kind: "execution", stream: false },
      requestBody,
      noopBridgeLogger,
      this.environment,
    );
    this.emitEvents(events);
    this.recordBridgeResponse(input.runtimeSessionKey, input.message, response);

    return {
      accepted: !response.error,
      runtimeRunRef: response.responseId ?? response.runId ?? response.sessionId,
      runtimeSessionKey: input.runtimeSessionKey,
      runStarted: true,
    };
  }

  async waitForApprovalDecision(): Promise<OpenClawApprovalDecision | null> {
    return null;
  }

  async requestApproval(
    _input: OpenClawApprovalRequest,
  ): Promise<OpenClawApprovalRequestResult> {
    return { approvalId: "noop", status: "auto-approved" };
  }

  async resolveApproval(
    _input: OpenClawApprovalResolution,
  ): Promise<{ accepted: boolean }> {
    return { accepted: true };
  }

  private emitEvents(events: NDJSONEvent[]): void {
    const handler = this.onEvent;
    if (!handler) return;
    for (const event of events) {
      handler(event);
    }
  }

  private getOrCreateSession(sessionKey: string): SessionState {
    let session = this.sessions.get(sessionKey);
    if (!session) {
      session = {
        sessionId: sessionKey,
        sessionKey,
        messages: [],
        lastRunRef: null,
        lastResponseId: null,
        lastRunStatus: "Pending",
        lastOutput: "",
        toolCalls: [],
        lastStructured: null,
      };
      this.sessions.set(sessionKey, session);
    }
    return session;
  }

  private recordBridgeResponse(
    sessionKey: string,
    userMessage: string,
    response: BridgeResponse,
  ): void {
    const session = this.getOrCreateSession(sessionKey);
    session.sessionId = response.sessionId;
    session.lastRunRef = response.responseId ?? response.runId ?? response.sessionId;
    session.lastResponseId = response.responseId ?? null;
    session.lastOutput = response.output;
    session.lastRunStatus = response.error ? "Failed" : "Completed";
    session.lastStructured = response.structured;
    session.messages.push(
      { role: "user", content: userMessage },
      { role: "assistant", content: response.output },
    );

    for (const toolCall of response.toolCalls) {
      session.toolCalls.push({
        tool: toolCall.tool,
        callId: toolCall.callId,
        input: toolCall.input,
        result: toolCall.result,
      });
    }
  }
}
