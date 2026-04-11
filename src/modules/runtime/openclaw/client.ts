import { randomUUID } from "node:crypto";
import type {
  OpenClawApprovalDecision,
  OpenClawApprovalRequest,
  OpenClawApprovalRequestResult,
  OpenClawApprovalResolution,
  OpenClawChatHistory,
  OpenClawConnectAuth,
  OpenClawDeviceIdentity,
  OpenClawHello,
  OpenClawPendingApproval,
  OpenClawRunSnapshot,
  OpenClawSendInput,
  OpenClawSendInputResult,
} from "@/modules/runtime/openclaw/types";

const PROTOCOL_VERSION = 3;
const DEFAULT_SCOPES = [
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.admin",
];
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

type OpenClawFrame = Record<string, unknown>;
type PendingRequest = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
};

type OpenClawSocketEventName = "open" | "message" | "close" | "error";
type OpenClawSocketListener = (...args: unknown[]) => void;

type OpenClawWebSocket = {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  readyState?: number;
  addEventListener?: (
    type: OpenClawSocketEventName,
    listener: OpenClawSocketListener,
  ) => void;
  removeEventListener?: (
    type: OpenClawSocketEventName,
    listener: OpenClawSocketListener,
  ) => void;
  on?: (
    type: OpenClawSocketEventName,
    listener: OpenClawSocketListener,
  ) => void;
  off?: (
    type: OpenClawSocketEventName,
    listener: OpenClawSocketListener,
  ) => void;
  removeListener?: (
    type: OpenClawSocketEventName,
    listener: OpenClawSocketListener,
  ) => void;
};

export type OpenClawWaitForRunInput = {
  runtimeRunRef: string;
  runtimeSessionKey?: string;
  timeoutMs?: number;
};

export interface OpenClawRuntimeClient {
  connect(): Promise<OpenClawHello>;
  close(code?: number, reason?: string): void;
  createRun(input: { prompt: string; runtimeSessionKey?: string }): Promise<{
    runtimeRunRef?: string;
    runtimeSessionRef?: string;
    runtimeSessionKey?: string;
    runStarted: boolean;
  }>;
  waitForRun(
    input: OpenClawWaitForRunInput | string,
    timeoutMs?: number,
  ): Promise<OpenClawRunSnapshot>;
  readOutputs(runtimeSessionKey: string): Promise<OpenClawChatHistory>;
  listApprovals(): Promise<OpenClawPendingApproval[]>;
  sendInput(input: OpenClawSendInput): Promise<OpenClawSendInputResult>;
  waitForApprovalDecision(
    approvalId: string,
  ): Promise<OpenClawApprovalDecision | null>;
  requestApproval(
    input: OpenClawApprovalRequest,
  ): Promise<OpenClawApprovalRequestResult>;
  resolveApproval(input: OpenClawApprovalResolution): Promise<{
    accepted: boolean;
  }>;
}

type OpenClawAgentRunResult = {
  runtimeRunRef?: string;
  runtimeSessionRef?: string;
  runtimeSessionKey?: string;
  runStarted: boolean;
};

type OpenClawGatewayClientOptions = {
  gatewayUrl: string;
  auth: OpenClawConnectAuth;
  role?: "operator";
  scopes?: string[];
  locale?: string;
  userAgent?: string;
  deviceIdentity?: OpenClawDeviceIdentity | null;
  client?: {
    id: string;
    version: string;
    platform: string;
    mode: "probe";
  };
  webSocketFactory?: (url: string) => OpenClawWebSocket;
};

type ResolvedOpenClawGatewayClientOptions = {
  gatewayUrl: string;
  auth: OpenClawConnectAuth;
  role: "operator";
  scopes: string[];
  locale: string;
  userAgent: string;
  deviceIdentity?: OpenClawDeviceIdentity | null;
  client: {
    id: string;
    version: string;
    platform: string;
    mode: "probe";
  };
  webSocketFactory: (url: string) => OpenClawWebSocket;
};

type OpenClawLocalRunState = {
  status: OpenClawRunSnapshot["status"];
  lastMessage?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function readRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function readNestedString(
  record: Record<string, unknown>,
  keys: string[],
  containers: string[] = ["meta", "entry", "run", "session", "request"],
): string | undefined {
  for (const key of keys) {
    const direct = readString(record, key);
    if (direct) {
      return direct;
    }
  }

  for (const container of containers) {
    const nestedRecord = readRecord(record, container);
    if (!nestedRecord) {
      continue;
    }

    for (const key of keys) {
      const nested = readString(nestedRecord, key);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}

function readArrayOfStrings(
  record: Record<string, unknown>,
  key: string,
): string[] {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function normalizeStatusKey(status: string | undefined) {
  return status?.toLowerCase().replace(/[\s._-]+/g, "");
}

function mapRawRunStatus(
  status: string | undefined,
): OpenClawRunSnapshot["status"] | undefined {
  switch (normalizeStatusKey(status)) {
    case "pending":
    case "queued":
    case "accepted":
      return "Pending";
    case "start":
    case "started":
    case "running":
    case "inprogress":
    case "processing":
    case "timeout":
      return "Running";
    case "waitingforinput":
    case "awaitinginput":
    case "needsinput":
    case "inputrequested":
      return "WaitingForInput";
    case "waitingforapproval":
    case "awaitingapproval":
    case "needsapproval":
    case "approvalrequested":
      return "WaitingForApproval";
    case "ok":
    case "end":
    case "complete":
    case "completed":
    case "finished":
    case "success":
    case "succeeded":
      return "Completed";
    case "error":
    case "failed":
    case "failure":
      return "Failed";
    case "cancelled":
    case "canceled":
      return "Cancelled";
    default:
      return undefined;
  }
}

function isTerminalRunStatus(status: OpenClawRunSnapshot["status"]) {
  return (
    status === "Completed" || status === "Failed" || status === "Cancelled"
  );
}

function preferLocalRunStatus(
  remoteStatus: OpenClawRunSnapshot["status"] | undefined,
  localStatus: OpenClawRunSnapshot["status"] | undefined,
) {
  if (!remoteStatus) {
    return localStatus ?? "Running";
  }

  if (!localStatus) {
    return remoteStatus;
  }

  if (
    (remoteStatus === "Running" || remoteStatus === "Pending") &&
    (isTerminalRunStatus(localStatus) ||
      localStatus === "WaitingForApproval" ||
      localStatus === "WaitingForInput")
  ) {
    return localStatus;
  }

  return remoteStatus;
}

function extractResponseError(frame: Record<string, unknown>): string {
  const error = frame.error;
  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  if (isRecord(error)) {
    return readString(error, "message") ?? JSON.stringify(error);
  }

  return "OpenClaw gateway request failed";
}

function isNoSessionFoundError(error: unknown) {
  return error instanceof Error && /no session found/i.test(error.message);
}

function toError(error: unknown, fallback: string) {
  return error instanceof Error ? error : new Error(fallback);
}

function decodeFrame(message: unknown): OpenClawFrame | null {
  const data = extractMessageData(message);
  if (!data) {
    return null;
  }

  try {
    const frame = JSON.parse(data) as unknown;
    return isRecord(frame) ? frame : null;
  } catch {
    return null;
  }
}

function extractMessageData(message: unknown): string | null {
  if (typeof message === "string") {
    return message;
  }

  if (typeof Buffer !== "undefined" && Buffer.isBuffer(message)) {
    return message.toString("utf8");
  }

  if (message instanceof ArrayBuffer) {
    return Buffer.from(message).toString("utf8");
  }

  if (ArrayBuffer.isView(message)) {
    return Buffer.from(
      message.buffer,
      message.byteOffset,
      message.byteLength,
    ).toString("utf8");
  }

  if (isRecord(message) && "data" in message) {
    return extractMessageData(message.data);
  }

  return null;
}

function addSocketListener(
  socket: OpenClawWebSocket,
  type: OpenClawSocketEventName,
  listener: OpenClawSocketListener,
) {
  if (typeof socket.addEventListener === "function") {
    socket.addEventListener(type, listener);
    return;
  }

  if (typeof socket.on === "function") {
    socket.on(type, listener);
    return;
  }

  throw new Error("OpenClaw gateway socket does not support event listeners");
}

function removeSocketListener(
  socket: OpenClawWebSocket,
  type: OpenClawSocketEventName,
  listener: OpenClawSocketListener,
) {
  if (typeof socket.removeEventListener === "function") {
    socket.removeEventListener(type, listener);
    return;
  }

  if (typeof socket.off === "function") {
    socket.off(type, listener);
    return;
  }

  if (typeof socket.removeListener === "function") {
    socket.removeListener(type, listener);
  }
}

function extractDisconnectReason(args: unknown[]) {
  const first = args[0];
  if (first instanceof Error) {
    return first.message;
  }

  if (typeof args[1] === "string" && args[1].length > 0) {
    return args[1];
  }

  if (
    typeof args[1] !== "undefined" &&
    typeof Buffer !== "undefined" &&
    Buffer.isBuffer(args[1])
  ) {
    return args[1].toString("utf8");
  }

  if (isRecord(first)) {
    return readString(first, "reason") ?? readString(first, "message");
  }

  return undefined;
}

export class OpenClawGatewayClient implements OpenClawRuntimeClient {
  private readonly options: ResolvedOpenClawGatewayClientOptions;

  private socket?: OpenClawWebSocket;
  private hello?: OpenClawHello;
  private connectPromise?: Promise<OpenClawHello>;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly runStates = new Map<string, OpenClawLocalRunState>();
  private readonly runSessions = new Map<string, string>();
  private readonly subscribedSessions = new Set<string>();
  private readonly subscriptionPromises = new Map<string, Promise<void>>();
  private latestChallenge?: Record<string, unknown>;

  private readonly handleOpen = () => {
    // The gateway sends `connect.challenge` after the socket opens.
  };

  private readonly handleMessage = (...args: unknown[]) => {
    const frame = decodeFrame(args[0]);
    if (!frame) {
      return;
    }

    if (frame.type === "event") {
      this.handleEvent(frame);
      return;
    }

    if (frame.type !== "res" || typeof frame.id !== "string") {
      return;
    }

    const pending = this.pendingRequests.get(frame.id);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(frame.id);
    if (frame.ok === true) {
      pending.resolve(frame.payload);
      return;
    }

    pending.reject(new Error(extractResponseError(frame)));
  };

  private readonly handleClose = (...args: unknown[]) => {
    const error = new Error(
      extractDisconnectReason(args) ?? "OpenClaw gateway connection closed",
    );

    for (const request of this.pendingRequests.values()) {
      request.reject(error);
    }
    this.pendingRequests.clear();

    this.socket = undefined;
    this.hello = undefined;
    this.connectPromise = undefined;
    this.latestChallenge = undefined;
    this.subscribedSessions.clear();
    this.subscriptionPromises.clear();
  };

  constructor(options: OpenClawGatewayClientOptions) {
    this.options = {
      ...options,
      role: options.role ?? "operator",
      scopes: options.scopes ?? [...DEFAULT_SCOPES],
      locale: options.locale ?? "en-US",
      userAgent: options.userAgent ?? "agent-dashboard/0.1.0",
      client: options.client ?? {
        id: "openclaw-probe",
        version: "0.1.0",
        platform: process.platform,
        mode: "probe",
      },
      webSocketFactory: options.webSocketFactory ?? createDefaultWebSocket,
    };
  }

  async connect(): Promise<OpenClawHello> {
    if (this.hello) {
      return this.hello;
    }

    if (!this.connectPromise) {
      this.connectPromise = this.performConnect().catch((error) => {
        this.connectPromise = undefined;
        throw error;
      });
    }

    return this.connectPromise;
  }

  close(code?: number, reason?: string) {
    this.socket?.close(code, reason);
  }

  getRunState(runId: string) {
    return this.runStates.get(runId)?.status ?? "unknown";
  }

  isRunRunning(runId: string) {
    return this.getRunState(runId) === "Running";
  }

  async createRun(input: { prompt: string; runtimeSessionKey?: string }) {
    if (input.runtimeSessionKey) {
      return this.startAgentRun({
        message: input.prompt,
        runtimeSessionKey: input.runtimeSessionKey,
      });
    }

    const payload = this.normalizePayload(
      await this.callRaw("sessions.create", { task: input.prompt }),
    );

    const result = {
      runtimeRunRef: readNestedString(payload, ["runId"]),
      runtimeSessionRef: readNestedString(payload, ["sessionId"]),
      runtimeSessionKey: readNestedString(payload, ["key", "sessionKey"]),
      runStarted: payload.runStarted === true,
    } satisfies OpenClawAgentRunResult;

    this.rememberRun(result);
    await this.ensureSessionSubscribed(result.runtimeSessionKey);
    return result;
  }

  async waitForRun(
    runtimeRunRef: string,
    timeoutMs?: number,
  ): Promise<OpenClawRunSnapshot>;
  async waitForRun(
    input: OpenClawWaitForRunInput,
  ): Promise<OpenClawRunSnapshot>;
  async waitForRun(
    inputOrRunRef: OpenClawWaitForRunInput | string,
    timeoutMs = 5_000,
  ) {
    const input =
      typeof inputOrRunRef === "string"
        ? { runtimeRunRef: inputOrRunRef, timeoutMs }
        : inputOrRunRef;

    if (input.runtimeSessionKey) {
      this.runSessions.set(input.runtimeRunRef, input.runtimeSessionKey);
      await this.connect();
      await this.ensureSessionSubscribed(input.runtimeSessionKey);
    }

    const payload = this.normalizePayload(
      await this.callRaw("agent.wait", {
        runId: input.runtimeRunRef,
        timeoutMs: input.timeoutMs ?? timeoutMs,
      }),
    );

    const rawStatus = readNestedString(payload, ["status", "phase", "state"]);
    const localState = this.runStates.get(input.runtimeRunRef);
    const status = preferLocalRunStatus(
      mapRawRunStatus(rawStatus),
      localState?.status,
    );
    const runtimeSessionKey =
      readNestedString(payload, ["key", "sessionKey"]) ??
      this.runSessions.get(input.runtimeRunRef) ??
      input.runtimeSessionKey;
    const runtimeSessionRef = readNestedString(payload, ["sessionId"]);
    const lastMessage =
      readNestedString(payload, ["error", "message", "prompt", "ask"]) ??
      localState?.lastMessage ??
      (normalizeStatusKey(rawStatus) === "timeout" && status === "Running"
        ? "agent.wait timed out before a terminal status was returned"
        : undefined);

    if (runtimeSessionKey) {
      this.runSessions.set(input.runtimeRunRef, runtimeSessionKey);
    }

    this.rememberRunState(input.runtimeRunRef, status, lastMessage, {
      allowDowngrade: true,
    });

    return {
      runtimeRunRef: input.runtimeRunRef,
      runtimeSessionRef,
      runtimeSessionKey,
      status,
      rawStatus,
      lastMessage,
    } satisfies OpenClawRunSnapshot;
  }

  async readOutputs(runtimeSessionKey: string) {
    const payload = this.normalizePayload(
      await this.callRaw("chat.history", { sessionKey: runtimeSessionKey }),
    );

    return {
      messages: Array.isArray(payload.messages)
        ? payload.messages.filter(
            (message): message is Record<string, unknown> => isRecord(message),
          )
        : [],
    } satisfies OpenClawChatHistory;
  }

  async listApprovals() {
    if (!this.supportsMethod("exec.approval.list")) {
      return [];
    }

    let payload: unknown;

    try {
      payload = await this.callRaw("exec.approval.list", {});
    } catch (error) {
      if (this.isUnknownMethodError(error)) {
        return [];
      }

      throw error;
    }

    if (!Array.isArray(payload)) {
      return [];
    }

    return payload
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .map((entry) => {
        const request = readRecord(entry, "request") ?? {};

        return {
          approvalId: readString(entry, "id") ?? "",
          sessionKey: readString(request, "sessionKey"),
          host: readString(request, "host"),
          command: readString(request, "command"),
          ask: readString(request, "ask"),
          createdAtMs: readNumber(entry, "createdAtMs"),
          expiresAtMs: readNumber(entry, "expiresAtMs"),
        } satisfies OpenClawPendingApproval;
      })
      .filter((approval) => approval.approvalId.length > 0);
  }

  async sendInput(input: OpenClawSendInput) {
    const result = await this.startAgentRun({
      message: input.message,
      runtimeSessionKey: input.runtimeSessionKey,
    });

    return {
      accepted: true,
      runtimeRunRef: result.runtimeRunRef,
      runtimeSessionKey: result.runtimeSessionKey,
      runStarted: result.runStarted,
    } satisfies OpenClawSendInputResult;
  }

  async waitForApprovalDecision(approvalId: string) {
    const payload = this.normalizePayload(
      await this.callRaw("exec.approval.waitDecision", { id: approvalId }),
    );
    const decision = readString(payload, "decision");

    return decision === "allow-once" ||
      decision === "allow-always" ||
      decision === "deny"
      ? decision
      : null;
  }

  async requestApproval(input: OpenClawApprovalRequest) {
    const payload = this.normalizePayload(
      await this.callRaw("exec.approval.request", {
        command: input.command,
        commandArgv: input.commandArgv,
        cwd: input.cwd,
        host: input.host ?? "gateway",
        sessionKey: input.sessionKey,
        twoPhase: true,
      }),
    );

    return {
      approvalId: readNestedString(payload, ["id", "approvalId"]) ?? "",
      status: readString(payload, "status"),
    } satisfies OpenClawApprovalRequestResult;
  }

  async resolveApproval(input: OpenClawApprovalResolution) {
    await this.callRaw("exec.approval.resolve", {
      id: input.approvalId,
      decision: input.decision === "approve" ? "allow-once" : "deny",
    });

    return { accepted: true };
  }

  private async performConnect() {
    this.ensureSocket();

    if (!this.socket) {
      throw new Error("Failed to initialize OpenClaw gateway socket");
    }

    await this.waitForSocketOpen(this.socket, DEFAULT_CONNECT_TIMEOUT_MS);
    const challenge = await this.waitForChallenge(
      this.socket,
      DEFAULT_CONNECT_TIMEOUT_MS,
    );
    if (!challenge) {
      throw new Error("No connect.challenge received");
    }

    const auth = this.resolveConnectAuth();
    const device = await this.buildConnectDevice(challenge, auth);
    const payload = this.normalizePayload(
      await this.sendRequestOverOpenSocket("connect", {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: this.options.client,
        role: this.options.role,
        scopes: this.options.scopes,
        caps: [],
        commands: [],
        permissions: {},
        auth,
        locale: this.options.locale,
        userAgent: this.options.userAgent,
        ...(device ? { device } : {}),
      }),
    );

    const hello = {
      protocol:
        typeof payload.protocol === "number"
          ? payload.protocol
          : PROTOCOL_VERSION,
      methods: this.readMethods(payload),
    } satisfies OpenClawHello;

    this.hello = hello;
    return hello;
  }

  private ensureSocket() {
    if (this.socket && this.socket.readyState !== 3) {
      return;
    }

    const socket = this.options.webSocketFactory(this.options.gatewayUrl);
    addSocketListener(socket, "open", this.handleOpen);
    addSocketListener(socket, "message", this.handleMessage);
    addSocketListener(socket, "close", this.handleClose);
    addSocketListener(socket, "error", this.handleClose);
    this.socket = socket;
  }

  private async waitForSocketOpen(
    socket: OpenClawWebSocket,
    timeoutMs: number,
  ) {
    if (socket.readyState === 1) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out while opening OpenClaw gateway socket"));
      }, timeoutMs);

      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onFailure = (...args: unknown[]) => {
        cleanup();
        reject(
          new Error(
            extractDisconnectReason(args) ??
              "OpenClaw gateway socket failed before opening",
          ),
        );
      };
      const cleanup = () => {
        clearTimeout(timer);
        removeSocketListener(socket, "open", onOpen);
        removeSocketListener(socket, "close", onFailure);
        removeSocketListener(socket, "error", onFailure);
      };

      addSocketListener(socket, "open", onOpen);
      addSocketListener(socket, "close", onFailure);
      addSocketListener(socket, "error", onFailure);
    });
  }

  private async waitForChallenge(socket: OpenClawWebSocket, timeoutMs: number) {
    if (this.latestChallenge) {
      return this.latestChallenge;
    }

    return await new Promise<Record<string, unknown> | null>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          resolve(null);
        }, timeoutMs);

        const onMessage = (...args: unknown[]) => {
          const frame = decodeFrame(args[0]);
          if (frame?.type !== "event" || frame.event !== "connect.challenge") {
            return;
          }

          cleanup();
          resolve(isRecord(frame.payload) ? frame.payload : {});
        };
        const onFailure = (...args: unknown[]) => {
          cleanup();
          reject(
            new Error(
              extractDisconnectReason(args) ??
                "OpenClaw gateway socket closed before challenge",
            ),
          );
        };
        const cleanup = () => {
          clearTimeout(timer);
          removeSocketListener(socket, "message", onMessage);
          removeSocketListener(socket, "close", onFailure);
          removeSocketListener(socket, "error", onFailure);
        };

        addSocketListener(socket, "message", onMessage);
        addSocketListener(socket, "close", onFailure);
        addSocketListener(socket, "error", onFailure);
      },
    );
  }

  private handleEvent(frame: OpenClawFrame) {
    if (frame.event === "connect.challenge") {
      this.latestChallenge = isRecord(frame.payload) ? frame.payload : {};
      return;
    }

    if (!isRecord(frame.payload)) {
      return;
    }

    if (frame.event === "session.message") {
      this.handleSessionMessageEvent(frame.payload);
      return;
    }

    if (frame.event === "session.tool") {
      this.handleSessionToolEvent(frame.payload);
    }
  }

  private handleSessionMessageEvent(payload: Record<string, unknown>) {
    const runId = readNestedString(payload, ["runId"]);
    if (!runId) {
      return;
    }

    const runtimeSessionKey = readNestedString(payload, ["sessionKey", "key"]);
    if (runtimeSessionKey) {
      this.runSessions.set(runId, runtimeSessionKey);
    }

    const stream = readNestedString(payload, ["stream", "channel"]);
    const role = readNestedString(payload, ["role"]);
    const status =
      mapRawRunStatus(
        readNestedString(payload, ["phase", "status", "state"]),
      ) ??
      (stream === "assistant" || role === "assistant" ? "Running" : undefined);
    const message = readNestedString(payload, [
      "message",
      "error",
      "prompt",
      "ask",
      "text",
    ]);

    if (status) {
      this.rememberRunState(runId, status, message);
      return;
    }

    if (!this.runStates.has(runId)) {
      this.rememberRunState(runId, "Running", message);
    }
  }

  private handleSessionToolEvent(payload: Record<string, unknown>) {
    const runId = readNestedString(payload, ["runId"]);
    if (!runId) {
      return;
    }

    const runtimeSessionKey = readNestedString(payload, ["sessionKey", "key"]);
    if (runtimeSessionKey) {
      this.runSessions.set(runId, runtimeSessionKey);
    }

    const explicitStatus = mapRawRunStatus(
      readNestedString(payload, ["phase", "status", "state"]),
    );
    const toolName = readNestedString(payload, ["toolName", "name", "tool"]);
    const message = readNestedString(payload, [
      "message",
      "error",
      "ask",
      "prompt",
    ]);

    if (explicitStatus) {
      this.rememberRunState(runId, explicitStatus, message);
      return;
    }

    if (
      toolName?.toLowerCase().includes("approval") ||
      readNestedString(payload, ["approvalId"])
    ) {
      this.rememberRunState(runId, "WaitingForApproval", message);
      return;
    }

    if (!this.runStates.has(runId)) {
      this.rememberRunState(runId, "Running", message);
    }
  }

  private rememberRun(result: OpenClawAgentRunResult) {
    if (result.runtimeRunRef) {
      if (result.runtimeSessionKey) {
        this.runSessions.set(result.runtimeRunRef, result.runtimeSessionKey);
      }

      if (!this.runStates.has(result.runtimeRunRef)) {
        this.runStates.set(result.runtimeRunRef, {
          status: result.runStarted ? "Running" : "Pending",
        });
      }
    }
  }

  private rememberRunState(
    runId: string,
    status: OpenClawRunSnapshot["status"],
    lastMessage?: string,
    options?: {
      allowDowngrade?: boolean;
    },
  ) {
    const previous = this.runStates.get(runId);
    let nextStatus = status;

    if (!options?.allowDowngrade && previous) {
      if (isTerminalRunStatus(previous.status)) {
        nextStatus = previous.status;
      } else if (
        (previous.status === "WaitingForApproval" ||
          previous.status === "WaitingForInput") &&
        (status === "Running" || status === "Pending")
      ) {
        nextStatus = previous.status;
      }
    }

    this.runStates.set(runId, {
      status: nextStatus,
      lastMessage: lastMessage ?? previous?.lastMessage,
    });
  }

  private resolveConnectAuth(): OpenClawConnectAuth {
    const deviceToken = this.options.deviceIdentity?.deviceToken;
    if (deviceToken) {
      return { deviceToken };
    }

    return this.options.auth;
  }

  private async buildConnectDevice(
    challenge?: Record<string, unknown>,
    auth?: OpenClawConnectAuth,
  ) {
    const deviceIdentity = this.options.deviceIdentity;
    if (!deviceIdentity) {
      return undefined;
    }

    const nonce = challenge ? readString(challenge, "nonce") : undefined;
    if (!nonce) {
      return undefined;
    }

    const signedAt = readNumber(challenge ?? {}, "ts") ?? Date.now();
    const token = auth?.deviceToken ?? auth?.token ?? "";
    const payload = [
      "v3",
      deviceIdentity.deviceId,
      this.options.client.id,
      this.options.client.mode,
      this.options.role,
      this.options.scopes.join(","),
      String(signedAt),
      token,
      nonce,
      deviceIdentity.platform ?? this.options.client.platform ?? "",
      deviceIdentity.deviceFamily ?? "",
    ].join("|");

    const signature = await deviceIdentity.sign(payload);
    return {
      id: deviceIdentity.deviceId,
      publicKey: deviceIdentity.publicKey,
      signature,
      signedAt,
      nonce,
    };
  }

  private async callRaw(method: string, params: Record<string, unknown>) {
    await this.connect();
    return await this.sendRequestOverOpenSocket(method, params);
  }

  private async sendRequestOverOpenSocket(
    method: string,
    params: Record<string, unknown>,
  ) {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) {
      throw new Error("OpenClaw gateway socket is not open");
    }

    return await new Promise<unknown>((resolve, reject) => {
      const id = randomUUID();
      this.pendingRequests.set(id, { resolve, reject });

      try {
        socket.send(
          JSON.stringify({
            type: "req",
            id,
            method,
            params,
          }),
        );
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(toError(error, `Failed to send OpenClaw request: ${method}`));
      }
    });
  }

  private normalizePayload(payload: unknown): Record<string, unknown> {
    return isRecord(payload) ? payload : {};
  }

  private readMethods(payload: Record<string, unknown>) {
    const features = readRecord(payload, "features");
    if (features) {
      const methods = readArrayOfStrings(features, "methods");
      if (methods.length > 0) {
        return methods;
      }
    }

    return readArrayOfStrings(payload, "methods");
  }

  private supportsMethod(method: string) {
    return this.hello?.methods.includes(method) ?? false;
  }

  private async ensureSessionExists(runtimeSessionKey: string) {
    try {
      await this.callRaw("sessions.resolve", { key: runtimeSessionKey });
    } catch (error) {
      if (!isNoSessionFoundError(error)) {
        throw error;
      }

      await this.callRaw("sessions.create", { key: runtimeSessionKey });
    }
  }

  private async ensureSessionSubscribed(runtimeSessionKey?: string) {
    if (!runtimeSessionKey) {
      return;
    }

    if (!this.hello) {
      await this.connect();
    }

    if (!this.supportsMethod("sessions.messages.subscribe")) {
      return;
    }

    if (this.subscribedSessions.has(runtimeSessionKey)) {
      return;
    }

    const existingPromise = this.subscriptionPromises.get(runtimeSessionKey);
    if (existingPromise) {
      await existingPromise;
      return;
    }

    const subscribePromise = this.callRaw("sessions.messages.subscribe", {
      key: runtimeSessionKey,
    })
      .then(() => {
        this.subscribedSessions.add(runtimeSessionKey);
      })
      .catch((error) => {
        if (this.isUnknownMethodError(error)) {
          return;
        }

        console.warn(
          `Failed to subscribe to OpenClaw session ${runtimeSessionKey}: ${toError(error, "subscription failed").message}`,
        );
      })
      .finally(() => {
        this.subscriptionPromises.delete(runtimeSessionKey);
      });

    this.subscriptionPromises.set(runtimeSessionKey, subscribePromise);
    await subscribePromise;
  }

  private async startAgentRun(input: {
    message: string;
    runtimeSessionKey: string;
  }): Promise<OpenClawAgentRunResult> {
    await this.ensureSessionExists(input.runtimeSessionKey);
    await this.ensureSessionSubscribed(input.runtimeSessionKey);

    const payload = this.normalizePayload(
      await this.callRaw("agent", {
        message: input.message,
        sessionKey: input.runtimeSessionKey,
        ...(process.env.OPENCLAW_AGENT_ID
          ? { agentId: process.env.OPENCLAW_AGENT_ID }
          : {}),
        idempotencyKey: randomUUID(),
      }),
    );

    const result = {
      runtimeRunRef: readNestedString(payload, ["runId"]),
      runtimeSessionRef: readNestedString(payload, ["sessionId"]),
      runtimeSessionKey:
        readNestedString(payload, ["key", "sessionKey"]) ??
        input.runtimeSessionKey,
      runStarted: payload.runStarted !== false,
    } satisfies OpenClawAgentRunResult;

    this.rememberRun(result);
    return result;
  }

  private isUnknownMethodError(error: unknown) {
    if (!(error instanceof Error)) {
      return false;
    }

    return /unknown method/i.test(error.message);
  }
}

function createDefaultWebSocket(url: string): OpenClawWebSocket {
  if (typeof WebSocket !== "function") {
    throw new Error(
      "Global WebSocket is unavailable. Provide webSocketFactory when creating OpenClawGatewayClient.",
    );
  }

  return new WebSocket(url) as unknown as OpenClawWebSocket;
}
