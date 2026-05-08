import type { RuntimeInput } from "@chrona/runtime-core";
import type { PreparedAiFeatureSpec } from "@chrona/contracts";
import type {
  BridgeEnvironment,
  BridgeExecutionTaskRequest,
  BridgeFeature,
  BridgeFeatureRequest,
  BridgeLogger,
  BridgeResponse,
  NDJSONEvent,
  OpenClawAdapterConfig,
  OpenClawApprovalDecision,
  OpenClawApprovalRequest,
  OpenClawApprovalRequestResult,
  OpenClawApprovalResolution,
  OpenClawChatHistory,
  OpenClawHello,
  OpenClawPendingApproval,
  OpenClawRunSnapshot,
  OpenClawRuntimeClient,
  OpenClawSendInput,
  OpenClawSendInputResult,
  OpenClawSessionStatus,
  OpenClawStructuredRunResult,
  OpenClawWaitForRunInput,
  RouteKind,
} from "./types";
import {
  checkGatewayAvailable,
  executeGatewayRequest,
  normalizeGatewayHttpUrl,
} from "./gateway";

export type OpenClawAdapter = {
  createRun(input: {
    prompt: string;
    runtimeInput: RuntimeInput;
    runtimeSessionKey?: string;
  }): Promise<{
    runtimeRunRef?: string;
    runtimeSessionRef?: string;
    runtimeSessionKey?: string;
    runStarted: boolean;
  }>;
  sendOperatorMessage(input: {
    runtimeSessionKey: string;
    message: string;
  }): Promise<OpenClawSendInputResult>;
  getRunSnapshot(input: {
    runtimeRunRef: string;
    runtimeSessionKey?: string;
    timeoutMs?: number;
  }): Promise<OpenClawRunSnapshot>;
  readHistory(input: {
    runtimeSessionKey: string;
  }): Promise<OpenClawChatHistory>;
  listApprovals(input: {
    runtimeSessionKey: string;
  }): Promise<OpenClawPendingApproval[]>;
  waitForApprovalDecision(
    approvalId: string,
  ): Promise<OpenClawApprovalDecision | null>;
  resumeRun(input: {
    runtimeSessionKey: string;
    approvalId?: string;
    decision?: "approve" | "reject";
    inputText?: string;
  }): Promise<OpenClawSendInputResult | { accepted: boolean }>;
  getSessionStatus(runtimeSessionKey: string): Promise<OpenClawSessionStatus>;
};

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

  close(): void {}

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
    const taskTitle =
      typeof input.runtimeInput?.prompt === "string" &&
      input.runtimeInput.prompt.trim()
        ? input.runtimeInput.prompt
        : undefined;
    const requestBody: BridgeExecutionTaskRequest = {
      sessionId: sessionKey,
      sessionKey,
      instructions: input.prompt,
      ...(taskTitle ? { taskTitle } : {}),
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
      runStarted: !response.error,
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

  async getSessionStatus(
    runtimeSessionKey: string,
  ): Promise<OpenClawSessionStatus> {
    const [history, approvals] = await Promise.all([
      this.readOutputs(runtimeSessionKey),
      this.listApprovals(),
    ]);
    const session = this.sessions.get(runtimeSessionKey);
    const pendingApprovals = approvals.filter(
      (approval) => approval.sessionKey === runtimeSessionKey,
    );
    const exists = history.messages.length > 0 || pendingApprovals.length > 0;

    return {
      runtimeSessionKey,
      exists,
      activeRunRef: session?.lastRunRef ?? undefined,
      activeRunStatus: session?.lastRunStatus ?? undefined,
      pendingApprovals,
      lastMessage: session?.lastOutput || undefined,
    };
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
    session.lastRunRef =
      response.responseId ?? response.runId ?? response.sessionId;
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
    request:
      | BridgeExecutionTaskRequest
      | BridgeFeatureRequest<Record<string, unknown>>,
  ): Promise<BridgeResponse> {
    const result = await executeGatewayRequest(
      route,
      request,
      NOOP_LOGGER,
      this.environment,
    );
    for (const event of result.events) {
      this.onEvent?.(event);
    }
    return result.response;
  }
}

function createLiveOpenClawAdapter(client: OpenClawRuntimeClient): OpenClawAdapter {
  return {
    createRun(input) {
      return client.createRun(input);
    },
    sendOperatorMessage(input) {
      return client.sendInput(input);
    },
    getRunSnapshot(input) {
      return client.waitForRun(input);
    },
    readHistory(input) {
      return client.readOutputs(input.runtimeSessionKey);
    },
    async listApprovals(input) {
      const approvals = await client.listApprovals();
      return approvals.filter(
        (approval) => approval.sessionKey === input.runtimeSessionKey,
      );
    },
    async waitForApprovalDecision(approvalId) {
      try {
        return await client.waitForApprovalDecision(approvalId);
      } catch {
        return null;
      }
    },
    async resumeRun(input) {
      if (input.approvalId && input.decision) {
        return client.resolveApproval({
          approvalId: input.approvalId,
          decision: input.decision,
        });
      }
      if (input.inputText?.trim()) {
        return client.sendInput({
          runtimeSessionKey: input.runtimeSessionKey,
          message: input.inputText,
        });
      }
      return { accepted: true };
    },
    getSessionStatus(runtimeSessionKey) {
      return client.getSessionStatus(runtimeSessionKey);
    },
  };
}

type OpenClawMockFixtureName = "run-waiting-approval" | "run-completed";

type OpenClawMockFixture = {
  snapshot: OpenClawRunSnapshot;
  history: OpenClawChatHistory;
  approvals: OpenClawPendingApproval[];
  approvalDecisions?: Record<string, OpenClawApprovalDecision | null>;
};

const OPENCLAW_MOCK_FIXTURES: Record<
  OpenClawMockFixtureName,
  OpenClawMockFixture
> = {
  "run-waiting-approval": {
    snapshot: {
      runtimeRunRef: "runtime_waiting_1",
      runtimeSessionKey: "agent:main:dashboard:session_waiting_1",
      status: "WaitingForApproval",
      rawStatus: "waiting_for_approval",
      lastMessage: "Approval required before applying the patch.",
    },
    history: {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Read package.json and prepare a patch." },
          ],
          timestamp: 1737264000000,
          __openclaw: { id: "msg_waiting_1", seq: 1 },
        },
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "tool_read_1",
              name: "read",
              arguments: { path: "package.json", offset: 1, limit: 20 },
            },
          ],
          timestamp: 1737264001000,
          __openclaw: { id: "msg_waiting_2", seq: 2 },
        },
        {
          role: "toolResult",
          toolCallId: "tool_read_1",
          toolName: "read",
          content: [{ type: "text", text: '{"name":"chrona"}' }],
          isError: false,
          timestamp: 1737264002000,
          __openclaw: { id: "msg_waiting_3", seq: 3 },
        },
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "I found the package name and I am waiting for approval to continue.",
            },
          ],
          timestamp: 1737264003000,
          __openclaw: { id: "msg_waiting_4", seq: 4 },
        },
      ],
    },
    approvals: [
      {
        approvalId: "approval_waiting_1",
        sessionKey: "agent:main:dashboard:session_waiting_1",
        host: "gateway",
        command: "apply_patch",
        ask: "Approve patch",
        createdAtMs: 1737264004000,
        expiresAtMs: 1737267600000,
      },
    ],
  },
  "run-completed": {
    snapshot: {
      runtimeRunRef: "runtime_completed_1",
      runtimeSessionKey: "agent:main:dashboard:session_completed_1",
      status: "Completed",
      rawStatus: "completed",
    },
    history: {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Summarize the current project status." },
          ],
          timestamp: 1737265000000,
          __openclaw: { id: "msg_completed_1", seq: 1 },
        },
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "The project bootstrap, runtime probe, schema, and projections are in place.",
            },
          ],
          timestamp: 1737265001000,
          __openclaw: { id: "msg_completed_2", seq: 2 },
        },
      ],
    },
    approvals: [],
  },
};

export function createMockOpenClawAdapter(options?: {
  fixtureName?: OpenClawMockFixtureName;
  fixture?: OpenClawMockFixture;
}): OpenClawAdapter {
  const fixture =
    options?.fixture ??
    OPENCLAW_MOCK_FIXTURES[options?.fixtureName ?? "run-waiting-approval"];

  return {
    async createRun(input) {
      return {
        runtimeRunRef: fixture.snapshot.runtimeRunRef,
        runtimeSessionRef: fixture.snapshot.runtimeSessionRef,
        runtimeSessionKey:
          input.runtimeSessionKey ?? fixture.snapshot.runtimeSessionKey,
        runStarted: true,
      };
    },
    async sendOperatorMessage(input) {
      return {
        accepted: true,
        runtimeRunRef: fixture.snapshot.runtimeRunRef,
        runtimeSessionKey: input.runtimeSessionKey,
        runStarted: false,
      };
    },
    async getRunSnapshot() {
      return fixture.snapshot;
    },
    async readHistory() {
      return fixture.history;
    },
    async listApprovals(input) {
      return fixture.approvals.filter(
        (approval) => approval.sessionKey === input.runtimeSessionKey,
      );
    },
    async waitForApprovalDecision(approvalId) {
      return fixture.approvalDecisions?.[approvalId] ?? null;
    },
    async resumeRun() {
      return { accepted: true };
    },
    async getSessionStatus(runtimeSessionKey) {
      const approvals = fixture.approvals.filter(
        (approval) => approval.sessionKey === runtimeSessionKey,
      );
      return {
        runtimeSessionKey,
        exists: true,
        activeRunRef: fixture.snapshot.runtimeRunRef,
        activeRunStatus: fixture.snapshot.status,
        pendingApprovals: approvals,
        lastMessage: fixture.snapshot.lastMessage,
      };
    },
  };
}

export async function createOpenClawAdapter(
  config?: OpenClawAdapterConfig,
): Promise<OpenClawAdapter> {
  if (config?.mode === "mock") {
    return createMockOpenClawAdapter();
  }
  if (!config?.bridgeUrl?.trim()) {
    throw new Error("OpenClaw bridgeUrl is required for the live runtime adapter");
  }

  const client = new OpenClawBridgeClient({
    baseUrl: config.bridgeUrl,
    authToken: config.bridgeToken,
    timeoutSeconds: config.timeoutSeconds,
  });
  return createLiveOpenClawAdapter(client);
}
