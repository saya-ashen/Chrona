/**
 * OpenClaw CLI Bridge Client
 *
 * Implements the OpenClawRuntimeClient interface by communicating with the
 * CLI Bridge HTTP server (`packages/providers/openclaw/bridge/src/index.ts`).
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
import type { RuntimeInput } from "@chrona/runtime-core";

export type OpenClawBridgeClientOptions = {
  baseUrl?: string;
  authToken?: string;
  timeoutSeconds?: number;
  onEvent?: (event: NDJSONEvent) => void;
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

export class OpenClawBridgeClient implements OpenClawRuntimeClient {
  private baseUrl: string;
  private authToken: string;
  private timeoutSeconds: number;
  private onEvent?: (event: NDJSONEvent) => void;
  private sessions = new Map<string, SessionState>();

  constructor(options: OpenClawBridgeClientOptions = {}) {
    this.baseUrl = (
      options.baseUrl ??
      process.env.OPENCLAW_BRIDGE_URL ??
      "http://localhost:7677"
    ).replace(/\/$/, "");
    this.authToken = options.authToken ?? process.env.OPENCLAW_BRIDGE_TOKEN ?? "";
    this.timeoutSeconds = options.timeoutSeconds ?? 300;
    this.onEvent = options.onEvent;
  }

  async connect(): Promise<OpenClawHello> {
    const res = await fetch(`${this.baseUrl}/v1/health`, {
      headers: this.buildHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Bridge health check failed: ${res.status}`);
    }
    const health = (await res.json()) as { status: string };
    if (health.status !== "ok") {
      throw new Error("OpenClaw CLI not available on bridge");
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
    // no-op for HTTP client
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
    const response = await this.postJson<BridgeResponse>(
      "/v1/execution/task",
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
    timeoutSeconds?: number;
  }): Promise<OpenClawStructuredRunResult<T>> {
    const sessionKey = input.runtimeSessionKey ?? crypto.randomUUID();
    const feature = input.feature;
    const path = this.getFeaturePath(feature, false);
    const requestBody: BridgeFeatureRequest<Record<string, unknown>> = {
      sessionId: sessionKey,
      sessionKey,
      input: {
        prompt: input.prompt,
      },
      ...(input.instructions ? { instructions: input.instructions } : {}),
      timeout: input.timeoutSeconds ?? this.timeoutSeconds,
    };
    const response = await this.postJson<BridgeResponse>(
      path,
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
    const response = await this.postJson<BridgeResponse>(
      "/v1/execution/task",
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

  private getFeaturePath(feature: BridgeFeature, stream: boolean): string {
    switch (feature) {
      case "suggest":
        return stream ? "/v1/features/suggest/stream" : "/v1/features/suggest";
      case "generate_plan":
        return stream
          ? "/v1/features/generate-plan/stream"
          : "/v1/features/generate-plan";
      case "conflicts":
        return "/v1/features/analyze-conflicts";
      case "timeslots":
        return "/v1/features/suggest-timeslot";
      case "chat":
        return "/v1/features/chat";
      case "dispatch_task":
        return "/v1/features/dispatch-task";
    }
  }

  private async postJson<TResponse>(
    path: string,
    body: unknown,
  ): Promise<TResponse> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    const text = await res.text().catch(() => "");
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(
        `Bridge call failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }

    if (!res.ok) {
      const message =
        parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error?: unknown }).error ?? text)
          : text;
      throw new Error(`Bridge call failed (${res.status}): ${message}`);
    }

    return parsed as TResponse;
  }

  async callBridgeStreaming(
    path: string,
    body: unknown,
    onEvent?: (event: NDJSONEvent) => void,
  ): Promise<BridgeResponse> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Bridge stream call failed (${res.status}): ${errBody}`);
    }

    const handler = onEvent ?? this.onEvent;
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("No response body for streaming");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let finalResponse: BridgeResponse | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      let eventType = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
          continue;
        }
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        try {
          const data = JSON.parse(raw) as NDJSONEvent | BridgeResponse;
          if (eventType === "done") {
            finalResponse = data as BridgeResponse;
          } else if (eventType === "event" && handler) {
            handler(data as NDJSONEvent);
          }
        } catch {
          // ignore malformed SSE lines
        }
        eventType = "";
      }
    }

    if (!finalResponse) {
      throw new Error("Stream ended without a final response");
    }

    return finalResponse;
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
    };
  }
}
