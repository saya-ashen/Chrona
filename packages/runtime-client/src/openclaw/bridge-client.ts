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
 */

import type { OpenClawRuntimeClient, OpenClawWaitForRunInput } from "./runtime-client";
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
} from "./types";
import type { BridgeResponse, NDJSONEvent } from "./bridge-types";

type BridgeClientOptions = {
  /** Bridge server base URL. Default: http://localhost:7677 */
  baseUrl?: string;
  /** Default timeout for CLI execution (seconds). Default: 300 */
  timeoutSeconds?: number;
  /** Called for each streaming NDJSON event (only used with stream endpoint). */
  onEvent?: (event: NDJSONEvent) => void;
};

// Per-session conversation history kept in memory (the bridge is stateless per-call)
type SessionState = {
  sessionId: string;
  messages: Array<Record<string, unknown>>;
  lastRunRef: string | null;
  lastRunStatus: OpenClawRunSnapshot["status"];
  lastOutput: string;
  toolCalls: Array<{ tool: string; callId: string; input: Record<string, unknown>; result?: string }>;
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

  // -- Connection lifecycle (no-op for HTTP) --

  async connect(): Promise<OpenClawHello> {
    // Verify bridge is healthy
    const res = await fetch(`${this.baseUrl}/v1/health`);
    if (!res.ok) {
      throw new Error(`Bridge health check failed: ${res.status}`);
    }
    const health = (await res.json()) as { status: string };
    if (health.status !== "ok") {
      throw new Error("OpenClaw CLI not available on bridge");
    }
    return { protocol: 1, methods: ["chat", "chat/stream", "health"] };
  }

  close(): void {
    // No-op for HTTP client
  }

  // -- Core methods --

  async createRun(input: {
    prompt: string;
    runtimeSessionKey?: string;
  }): Promise<{
    runtimeRunRef?: string;
    runtimeSessionRef?: string;
    runtimeSessionKey?: string;
    runStarted: boolean;
  }> {
    const sessionId = input.runtimeSessionKey ?? crypto.randomUUID();
    const response = await this.callBridge(sessionId, input.prompt);

    // Track session state
    const session = this.getOrCreateSession(sessionId);
    session.lastRunRef = response.sessionId;
    session.lastOutput = response.output;
    session.lastRunStatus = response.error ? "Failed" : "Completed";
    session.messages.push(
      { role: "user", content: input.prompt },
      { role: "assistant", content: response.output },
    );

    // Track tool calls
    for (const tc of response.toolCalls) {
      session.toolCalls.push({
        tool: tc.tool,
        callId: tc.callId,
        input: tc.input,
        result: tc.result,
      });
    }

    return {
      runtimeRunRef: response.sessionId,
      runtimeSessionRef: response.sessionId,
      runtimeSessionKey: sessionId,
      runStarted: true,
    };
  }

  async waitForRun(
    input: OpenClawWaitForRunInput | string,
  ): Promise<OpenClawRunSnapshot> {
    const key = typeof input === "string" ? input : (input.runtimeSessionKey ?? input.runtimeRunRef);
    const session = this.sessions.get(key);

    return {
      runtimeRunRef: session?.lastRunRef ?? key,
      runtimeSessionRef: session?.lastRunRef ?? undefined,
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

  async listApprovals(): Promise<OpenClawPendingApproval[]> {
    // CLI Bridge doesn't support interactive approvals — auto-handled by CLI
    return [];
  }

  async sendInput(input: OpenClawSendInput): Promise<OpenClawSendInputResult> {
    const response = await this.callBridge(input.runtimeSessionKey, input.message);

    const session = this.getOrCreateSession(input.runtimeSessionKey);
    session.lastOutput = response.output;
    session.lastRunStatus = response.error ? "Failed" : "Completed";
    session.lastRunRef = response.sessionId;
    session.messages.push(
      { role: "user", content: input.message },
      { role: "assistant", content: response.output },
    );

    return {
      accepted: !response.error,
      runtimeRunRef: response.sessionId,
      runtimeSessionKey: input.runtimeSessionKey,
      runStarted: true,
    };
  }

  async waitForApprovalDecision(): Promise<OpenClawApprovalDecision | null> {
    // Not supported via CLI Bridge
    return null;
  }

  async requestApproval(_input: OpenClawApprovalRequest): Promise<OpenClawApprovalRequestResult> {
    // Not supported via CLI Bridge
    return { approvalId: "noop", status: "auto-approved" };
  }

  async resolveApproval(_input: OpenClawApprovalResolution): Promise<{ accepted: boolean }> {
    // Not supported via CLI Bridge
    return { accepted: true };
  }

  // -- Internals --

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
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  private async callBridge(sessionId: string, message: string): Promise<BridgeResponse> {
    const res = await fetch(`${this.baseUrl}/v1/chat`, {
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
      throw new Error(`Bridge call failed (${res.status}): ${errBody}`);
    }

    return (await res.json()) as BridgeResponse;
  }

  /**
   * Call the bridge streaming endpoint. Returns the final BridgeResponse
   * after processing all SSE events.
   */
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

    return finalResponse;
  }
}
