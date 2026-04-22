/**
 * OpenClaw CLI Bridge Client
 *
 * Implements the OpenClawRuntimeClient interface by communicating with the
 * CLI Bridge HTTP server (services/openclaw-bridge/server.ts).
 *
 * The bridge wraps `openclaw agent --local --json` CLI invocations behind
 * a simple REST API on localhost:7677.
 *
 * This client uses a simpler HTTP flow because:
 * - Each request is a blocking HTTP call (no persistent connection)
 * - Session management is handled by the CLI via --session-id
 * - Approvals are auto-resolved (the CLI bridge doesn't expose interactive approvals)
 *
 * Note: this adapter also keeps a small in-memory compatibility cache so blocking
 * bridge responses can still satisfy runtime-style status/history reads. That cache
 * belongs to the OpenClaw integration layer, not the backend-agnostic runtime core.
 */

import type { OpenClawRuntimeClient, OpenClawWaitForRunInput } from "../runtime/runtime-client";
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
import type { BridgeRequest, BridgeResponse, NDJSONEvent } from "./bridge-types";
import type { RuntimeInput } from "../../../../packages/runtime-core/src/index";

type BridgeClientOptions = {
  baseUrl?: string;
  timeoutSeconds?: number;
  onEvent?: (event: NDJSONEvent) => void;
};

type SessionState = {
  sessionId: string;
  messages: Array<Record<string, unknown>>;
  lastRunRef: string | null;
  lastRunStatus: OpenClawRunSnapshot["status"];
  lastOutput: string;
  toolCalls: Array<{ tool: string; callId: string; input: Record<string, unknown>; result?: string }>;
  lastStructured: OpenClawStructuredRunResult | null;
};

export class OpenClawBridgeClient implements OpenClawRuntimeClient {
  private baseUrl: string;
  private timeoutSeconds: number;
  private onEvent?: (event: NDJSONEvent) => void;
  private sessions = new Map<string, SessionState>();

  constructor(options: BridgeClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.OPENCLAW_BRIDGE_URL ?? "http://localhost:7677").replace(/\/$/, "");
    this.timeoutSeconds = options.timeoutSeconds ?? 300;
    this.onEvent = options.onEvent;
  }

  async connect(): Promise<OpenClawHello> {
    const res = await fetch(`${this.baseUrl}/v1/health`);
    if (!res.ok) {
      throw new Error(`Bridge health check failed: ${res.status}`);
    }
    const health = (await res.json()) as { status: string };
    if (health.status !== "ok") {
      throw new Error("OpenClaw CLI not available on bridge");
    }
    return { protocol: 1, methods: ["chat", "chat/stream", "health", "chat/structured"] };
  }

  close(): void {
    // No-op for HTTP client
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
    const sessionId = input.runtimeSessionKey ?? crypto.randomUUID();
    const response = await this.callBridge(sessionId, input.prompt, {
      execution: {
        mode: "task",
        runtimeAdapterKey: "openclaw",
        runtimeInput: input.runtimeInput,
      },
    });
    this.recordBridgeResponse(sessionId, input.prompt, response);

    return {
      runtimeRunRef: response.runId ?? response.sessionId,
      runtimeSessionRef: response.sessionId,
      runtimeSessionKey: sessionId,
      runStarted: true,
    };
  }

  async createStructuredRun<T = unknown>(input: {
    prompt: string;
    runtimeSessionKey?: string;
    systemPrompt?: string;
    timeoutSeconds?: number;
  }): Promise<OpenClawStructuredRunResult<T>> {
    const sessionId = input.runtimeSessionKey ?? crypto.randomUUID();
    const response = await this.callBridge(sessionId, input.prompt, {
      systemPrompt: input.systemPrompt,
      timeout: input.timeoutSeconds,
    });
    this.recordBridgeResponse(sessionId, input.prompt, response);

    return {
      ...response.structured,
      parsed: (response.structured?.parsed ?? null) as T | null,
      rawOutput: response.output,
      sessionId: response.sessionId,
      runId: response.runId,
    };
  }

  async waitForRun(
    input: OpenClawWaitForRunInput | string,
  ): Promise<OpenClawRunSnapshot> {
    const key = typeof input === "string" ? input : (input.runtimeSessionKey ?? input.runtimeRunRef);
    const session = this.sessions.get(key);

    return {
      runtimeRunRef: session?.lastRunRef ?? key,
      runtimeSessionRef: session?.sessionId ?? undefined,
      runtimeSessionKey: key,
      status: session?.lastRunStatus ?? "Completed",
      lastMessage: session?.lastOutput,
    };
  }

  async readOutputs(runtimeSessionKey: string): Promise<OpenClawChatHistory> {
    const session = this.sessions.get(runtimeSessionKey);
    return {
      messages: session?.messages ?? [],
    };
  }

  async getStructuredResult<T = unknown>(runtimeSessionKey: string): Promise<OpenClawStructuredRunResult<T> | null> {
    const session = this.sessions.get(runtimeSessionKey);
    if (!session?.lastStructured) {
      return null;
    }
    return {
      ...session.lastStructured,
      parsed: (session.lastStructured.parsed ?? null) as T | null,
    };
  }

  async listApprovals(): Promise<OpenClawPendingApproval[]> {
    return [];
  }

  async sendInput(input: OpenClawSendInput): Promise<OpenClawSendInputResult> {
    const response = await this.callBridge(input.runtimeSessionKey, input.message);
    this.recordBridgeResponse(input.runtimeSessionKey, input.message, response);

    return {
      accepted: !response.error,
      runtimeRunRef: response.runId ?? response.sessionId,
      runtimeSessionKey: input.runtimeSessionKey,
      runStarted: true,
    };
  }

  async waitForApprovalDecision(): Promise<OpenClawApprovalDecision | null> {
    return null;
  }

  async requestApproval(_input: OpenClawApprovalRequest): Promise<OpenClawApprovalRequestResult> {
    return { approvalId: "noop", status: "auto-approved" };
  }

  async resolveApproval(_input: OpenClawApprovalResolution): Promise<{ accepted: boolean }> {
    return { accepted: true };
  }

  private getOrCreateSession(sessionId: string): SessionState {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        messages: [],
        lastRunRef: null,
        lastRunStatus: "Pending",
        lastOutput: "",
        toolCalls: [],
        lastStructured: null,
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  private recordBridgeResponse(sessionId: string, userMessage: string, response: BridgeResponse): void {
    const session = this.getOrCreateSession(sessionId);
    session.lastRunRef = response.runId ?? response.sessionId;
    session.lastOutput = response.output;
    session.lastRunStatus = response.error ? "Failed" : "Completed";
    session.lastStructured = response.structured;
    session.messages.push(
      { role: "user", content: userMessage },
      { role: "assistant", content: response.output },
    );

    for (const tc of response.toolCalls) {
      session.toolCalls.push({
        tool: tc.tool,
        callId: tc.callId,
        input: tc.input,
        result: tc.result,
      });
    }
  }

  private async callBridge(
    sessionId: string,
    message: string,
    overrides?: {
      systemPrompt?: string;
      timeout?: number;
      execution?: BridgeRequest["execution"];
    },
  ): Promise<BridgeResponse> {
    const requestBody: BridgeRequest = {
      sessionId,
      message,
      timeout: overrides?.timeout ?? this.timeoutSeconds,
    };

    if (overrides?.systemPrompt) {
      requestBody.systemPrompt = overrides.systemPrompt;
    }

    if (overrides?.execution) {
      requestBody.execution = overrides.execution;
    }

    const res = await fetch(`${this.baseUrl}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Bridge call failed (${res.status}): ${errBody}`);
    }

    return (await res.json()) as BridgeResponse;
  }

  async callBridgeStreaming(
    sessionId: string,
    message: string,
    onEvent?: (event: NDJSONEvent) => void,
  ): Promise<BridgeResponse> {
    const res = await fetch(`${this.baseUrl}/v1/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        message,
        timeout: this.timeoutSeconds,
      }),
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
        } else if (line.startsWith("data: ")) {
          const raw = line.slice(6).trim();
          try {
            const data = JSON.parse(raw) as NDJSONEvent | BridgeResponse;
            if (eventType === "done") {
              finalResponse = data as BridgeResponse;
            } else if (eventType === "event" && handler) {
              handler(data as NDJSONEvent);
            }
          } catch {
            // skip
          }
          eventType = "";
        }
      }
    }

    if (!finalResponse) {
      throw new Error("Stream ended without a final response");
    }

    this.recordBridgeResponse(sessionId, message, finalResponse);
    return finalResponse;
  }
}



