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
const DEFAULT_SCOPES = ["operator.read", "operator.write", "operator.approvals"];

type OpenClawFrame = Record<string, unknown>;
type PendingRequest = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
};

type OpenClawWebSocket = Pick<
  WebSocket,
  "addEventListener" | "removeEventListener" | "send" | "close" | "readyState"
>;

export interface OpenClawRuntimeClient {
  connect(): Promise<OpenClawHello>;
  close(code?: number, reason?: string): void;
  createRun(input: {
    prompt: string;
  }): Promise<{
    runtimeRunRef?: string;
    runtimeSessionRef?: string;
    runtimeSessionKey?: string;
    runStarted: boolean;
  }>;
  waitForRun(runtimeRunRef: string, timeoutMs?: number): Promise<OpenClawRunSnapshot>;
  readOutputs(runtimeSessionKey: string): Promise<OpenClawChatHistory>;
  listApprovals(): Promise<OpenClawPendingApproval[]>;
  sendInput(input: OpenClawSendInput): Promise<OpenClawSendInputResult>;
  waitForApprovalDecision(approvalId: string): Promise<OpenClawApprovalDecision | null>;
  requestApproval(input: OpenClawApprovalRequest): Promise<OpenClawApprovalRequestResult>;
  resolveApproval(input: OpenClawApprovalResolution): Promise<{
    accepted: boolean;
  }>;
}

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

type ConnectResolvers = {
  requestId?: string;
  resolve: (hello: OpenClawHello) => void;
  reject: (error: Error) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNestedString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const direct = readString(record, key);
    if (direct) {
      return direct;
    }
  }

  const entry = record.entry;
  if (isRecord(entry)) {
    for (const key of keys) {
      const nested = readString(entry, key);
      if (nested) {
        return nested;
      }
    }
  }

  const run = record.run;
  if (isRecord(run)) {
    for (const key of keys) {
      const nested = readString(run, key);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}

function extractResponseError(frame: Record<string, unknown>): string {
  const error = frame.error;
  if (isRecord(error)) {
    return readString(error, "message") ?? JSON.stringify(error);
  }

  return "OpenClaw gateway request failed";
}

function mapRunStatus(status: string | undefined): OpenClawRunSnapshot["status"] {
  switch (status?.toLowerCase()) {
    case "pending":
      return "Pending";
    case "waitingforinput":
    case "waiting_for_input":
    case "waiting-input":
      return "WaitingForInput";
    case "waitingforapproval":
    case "waiting_for_approval":
    case "waiting-approval":
      return "WaitingForApproval";
    case "failed":
    case "error":
      return "Failed";
    case "completed":
    case "success":
    case "succeeded":
    case "done":
      return "Completed";
    case "cancelled":
    case "canceled":
    case "aborted":
      return "Cancelled";
    case "timeout":
    case "running":
    default:
      return "Running";
  }
}

export class OpenClawGatewayClient implements OpenClawRuntimeClient {
  private readonly options: ResolvedOpenClawGatewayClientOptions;

  private socket?: OpenClawWebSocket;
  private connectPromise?: Promise<OpenClawHello>;
  private hello?: OpenClawHello;
  private connectResolvers?: ConnectResolvers;
  private readonly pendingRequests = new Map<string, PendingRequest>();

  private readonly handleOpen = () => {
    // The gateway sends the `connect.challenge` event after the socket opens.
  };

  private readonly handleMessage = (event: Event | MessageEvent) => {
    if (!(event instanceof MessageEvent) || typeof event.data !== "string") {
      return;
    }

    const frame = JSON.parse(event.data) as OpenClawFrame;
    if (frame.type === "event" && frame.event === "connect.challenge") {
      void this.sendConnectRequest(isRecord(frame.payload) ? frame.payload : undefined);
      return;
    }

    if (frame.type !== "res" || typeof frame.id !== "string") {
      return;
    }

    if (this.connectResolvers?.requestId === frame.id) {
      if (frame.ok !== true || !isRecord(frame.payload)) {
        this.connectResolvers.reject(new Error(extractResponseError(frame)));
        this.connectResolvers = undefined;
        this.connectPromise = undefined;
        return;
      }

      const hello = {
        protocol: typeof frame.payload.protocol === "number" ? frame.payload.protocol : PROTOCOL_VERSION,
        methods: this.readMethods(frame.payload),
      } satisfies OpenClawHello;

      this.hello = hello;
      this.connectResolvers.resolve(hello);
      this.connectResolvers = undefined;
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

  private readonly handleClose = (event: Event | CloseEvent) => {
    const closeEvent = event instanceof CloseEvent ? event : undefined;
    const error = new Error(closeEvent?.reason || "OpenClaw gateway connection closed");

    this.connectResolvers?.reject(error);
    this.connectResolvers = undefined;
    this.connectPromise = undefined;
    this.hello = undefined;

    for (const request of this.pendingRequests.values()) {
      request.reject(error);
    }
    this.pendingRequests.clear();
  };

  constructor(options: OpenClawGatewayClientOptions) {
    this.options = {
      ...options,
      role: options.role ?? "operator",
      scopes: options.scopes ?? [...DEFAULT_SCOPES],
      locale: options.locale ?? "en-US",
      userAgent: options.userAgent ?? "agent-dashboard/0.1.0",
      client:
        options.client ??
        {
          id: "openclaw-probe",
          version: "0.1.0",
          platform: process.platform,
          mode: "probe",
        },
      webSocketFactory: options.webSocketFactory ?? ((url: string) => new WebSocket(url)),
    };
  }

  async connect(): Promise<OpenClawHello> {
    if (this.hello) {
      return this.hello;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.socket = this.options.webSocketFactory(this.options.gatewayUrl);
    this.socket.addEventListener("open", this.handleOpen);
    this.socket.addEventListener("message", this.handleMessage);
    this.socket.addEventListener("close", this.handleClose);
    this.socket.addEventListener("error", this.handleClose);

    this.connectPromise = new Promise<OpenClawHello>((resolve, reject) => {
      this.connectResolvers = { resolve, reject };
    });

    return this.connectPromise;
  }

  close(code?: number, reason?: string) {
    this.socket?.close(code, reason);
  }

  async createRun(input: { prompt: string }) {
    const payload = this.normalizePayload(
      await this.callRaw("sessions.create", { task: input.prompt }),
    );

    return {
      runtimeRunRef: readNestedString(payload, ["runId"]),
      runtimeSessionRef: readNestedString(payload, ["sessionId"]),
      runtimeSessionKey: readNestedString(payload, ["key", "sessionKey"]),
      runStarted: payload.runStarted === true,
    };
  }

  async waitForRun(runtimeRunRef: string, timeoutMs = 1000) {
    const payload = this.normalizePayload(
      await this.callRaw("agent.wait", { runId: runtimeRunRef, timeoutMs }),
    );
    const rawStatus = readString(payload, "status") ?? "unknown";

    return {
      runtimeRunRef,
      runtimeSessionRef: readNestedString(payload, ["sessionId"]),
      runtimeSessionKey: readNestedString(payload, ["key", "sessionKey"]),
      rawStatus,
      status: mapRunStatus(rawStatus),
      lastMessage:
        rawStatus === "timeout"
          ? "agent.wait timed out before a terminal status was returned"
          : readString(payload, "error"),
    } satisfies OpenClawRunSnapshot;
  }

  async readOutputs(runtimeSessionKey: string) {
    const payload = this.normalizePayload(
      await this.callRaw("chat.history", { sessionKey: runtimeSessionKey }),
    );

    return {
      messages: Array.isArray(payload.messages)
        ? payload.messages.filter((message): message is Record<string, unknown> => isRecord(message))
        : [],
    } satisfies OpenClawChatHistory;
  }

  async listApprovals() {
    const payload = await this.callRaw("exec.approval.list", {});

    if (!Array.isArray(payload)) {
      return [];
    }

    return payload
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .map((entry) => {
        const request = isRecord(entry.request) ? entry.request : {};

        return {
          approvalId: readString(entry, "id") ?? "",
          sessionKey: readString(request, "sessionKey"),
          host: readString(request, "host"),
          command: readString(request, "command"),
          ask: readString(request, "ask"),
          createdAtMs:
            typeof entry.createdAtMs === "number" ? entry.createdAtMs : undefined,
          expiresAtMs:
            typeof entry.expiresAtMs === "number" ? entry.expiresAtMs : undefined,
        } satisfies OpenClawPendingApproval;
      })
      .filter((approval) => approval.approvalId.length > 0);
  }

  async sendInput(input: OpenClawSendInput) {
    const payload = this.normalizePayload(
      await this.callRaw("sessions.send", {
        key: input.runtimeSessionKey,
        message: input.message,
      }),
    );

    return {
      accepted: true,
      runtimeRunRef: readNestedString(payload, ["runId"]),
      runtimeSessionKey: readNestedString(payload, ["key", "sessionKey"]),
      runStarted: payload.runStarted === true,
    } satisfies OpenClawSendInputResult;
  }

  async waitForApprovalDecision(approvalId: string) {
    const payload = this.normalizePayload(
      await this.callRaw("exec.approval.waitDecision", { id: approvalId }),
    );
    const decision = readString(payload, "decision");

    return decision === "allow-once" || decision === "allow-always" || decision === "deny"
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

    const signedAt =
      challenge && typeof challenge.ts === "number" ? challenge.ts : Date.now();
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

    if (!this.socket || this.socket.readyState !== 1) {
      throw new Error("OpenClaw gateway socket is not open");
    }

    const id = randomUUID();
    const frame = {
      type: "req",
      id,
      method,
      params,
    };

    const response = new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });

    this.socket.send(JSON.stringify(frame));
    return await response;
  }

  private async sendConnectRequest(challenge?: Record<string, unknown>) {
    if (!this.socket || !this.connectResolvers || this.connectResolvers.requestId) {
      return;
    }

    const requestId = randomUUID();
    this.connectResolvers.requestId = requestId;

    try {
      const auth = this.resolveConnectAuth();
      const device = await this.buildConnectDevice(challenge, auth);

      this.socket.send(
        JSON.stringify({
          type: "req",
          id: requestId,
          method: "connect",
          params: {
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
          },
        }),
      );
    } catch (error) {
      this.connectResolvers.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
      this.connectResolvers = undefined;
      this.connectPromise = undefined;
    }
  }

  private normalizePayload(payload: unknown): Record<string, unknown> {
    return isRecord(payload) ? payload : {};
  }

  private readMethods(payload: Record<string, unknown>) {
    const directFeatures = payload.features;
    if (isRecord(directFeatures) && Array.isArray(directFeatures.methods)) {
      return directFeatures.methods.filter((method): method is string => typeof method === "string");
    }

    return [];
  }
}
