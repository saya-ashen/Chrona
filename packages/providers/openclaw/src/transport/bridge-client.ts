/**
 * OpenClaw gateway client.
 *
 * Implements the OpenClawRuntimeClient interface by invoking the provider's
 * gateway integration directly, without a local bridge server.
 */

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
  BridgeFeatureRequest,
  BridgeResponse,
  NDJSONEvent,
  BridgeFeature,
} from "./bridge-types";
import { normalizeGatewayHttpUrl } from "../shared/constants";
import type { BridgeEnvironment, BridgeLogger, RouteKind } from "../shared/types";
import { checkGatewayAvailable, executeGatewayRequest } from "../execution/gateway";
import type { RuntimeInput } from "@chrona/runtime-core";
import type { PreparedAiFeatureSpec } from "@chrona/contracts";

type OpenClawBridgeClientOptions = {
  baseUrl: string;
  authToken?: string;
  agentId?: string;
  model?: string;
  messageChannel?: string;
  timeoutSeconds?: number;
  onEvent?: (event: NDJSONEvent) => void;
};

type SessionState = {
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

const NOOP_LOGGER: BridgeLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export class OpenClawBridgeClient implements OpenClawRuntimeClient {
  private environment: BridgeEnvironment;
  private timeoutSeconds: number;
  private onEvent?: (event: NDJSONEvent) => void;
  private sessions = new Map<string, SessionState>();

  constructor(options: OpenClawBridgeClientOptions) {
    this.environment = {
      gatewayHttpUrl: normalizeGatewayHttpUrl(options.baseUrl),
      gatewayToken: options.authToken ?? "",
      agentId: options.agentId?.trim() || "main",
      model: options.model?.trim() || undefined,
      messageChannel: options.messageChannel?.trim() || undefined,
    };
    this.timeoutSeconds = options.timeoutSeconds ?? 300;
    this.onEvent = options.onEvent;
  }

  async connect(): Promise<OpenClawHello> {
    const ok = await checkGatewayAvailable(this.environment);
    if (!ok) {
      throw new Error("OpenClaw gateway is not available");
    }

    return {
      protocol: 1,
      methods: [
        "responses.create",
        "responses.stream",
        "feature.suggest",
        "feature.generate_plan",
        "feature.conflicts",
        "feature.timeslots",
        "feature.chat",
        "feature.dispatch_task",
        "execution.task",
      ],
    };
  }

  close(): void {
    // no-op for gateway client
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
    const response = await this.executeRoute(
      { kind: "execution", stream: false },
      requestBody,
    );
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
    inputText?: string;
    featureSpec?: PreparedAiFeatureSpec;
    timeoutSeconds?: number;
  }): Promise<OpenClawStructuredRunResult<T>> {
    const sessionKey = input.runtimeSessionKey ?? crypto.randomUUID();
    const requestBody: BridgeFeatureRequest<Record<string, unknown>> = {
      sessionId: sessionKey,
      sessionKey,
      input: {
        prompt: input.prompt,
      },
      ...(input.instructions ? { instructions: input.instructions } : {}),
      ...(input.inputText ? { inputText: input.inputText } : {}),
      ...(input.featureSpec ? { featureSpec: input.featureSpec } : {}),
      timeout: input.timeoutSeconds ?? this.timeoutSeconds,
    };
    const response = await this.executeRoute(
      { kind: "feature", feature: input.feature, stream: false },
      requestBody,
    );
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
        : (input.runtimeSessionKey ?? input.runtimeRunRef);
    const session =
      this.sessions.get(key) ??
      Array.from(this.sessions.values()).find(
        (candidate) =>
          candidate.lastRunRef === key || candidate.lastResponseId === key,
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
    const response = await this.executeRoute(
      { kind: "execution", stream: false },
      requestBody,
    );
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

  private async executeRoute(
    route: RouteKind,
    request: BridgeExecutionTaskRequest | BridgeFeatureRequest<Record<string, unknown>>,
  ): Promise<BridgeResponse> {
    const result = await executeGatewayRequest(route, request, NOOP_LOGGER, this.environment);
    for (const event of result.events) {
      this.onEvent?.(event);
    }
    return result.response;
  }
}
