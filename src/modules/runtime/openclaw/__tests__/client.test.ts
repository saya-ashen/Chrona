import { describe, expect, it, vi } from "vitest";
import { OpenClawGatewayClient } from "@/modules/runtime/openclaw/client";

type SocketEventName = "open" | "message" | "close" | "error";
type SocketListener = (event: Event | MessageEvent | CloseEvent) => void;

class MockWebSocket {
  public readyState = 0;
  public readonly sentFrames: Array<Record<string, unknown>> = [];

  private readonly listeners: Record<SocketEventName, Set<SocketListener>> = {
    open: new Set(),
    message: new Set(),
    close: new Set(),
    error: new Set(),
  };

  addEventListener(type: SocketEventName, listener: SocketListener) {
    this.listeners[type].add(listener);
  }

  removeEventListener(type: SocketEventName, listener: SocketListener) {
    this.listeners[type].delete(listener);
  }

  send(data: string) {
    this.sentFrames.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code?: number, reason?: string) {
    this.readyState = 3;
    this.dispatch(
      "close",
      new CloseEvent("close", { code: code ?? 1000, reason: reason ?? "" }),
    );
  }

  open() {
    this.readyState = 1;
    this.dispatch("open", new Event("open"));
  }

  emitFrame(frame: Record<string, unknown>) {
    this.dispatch("message", new MessageEvent("message", { data: JSON.stringify(frame) }));
  }

  private dispatch(type: SocketEventName, event: Event | MessageEvent | CloseEvent) {
    for (const listener of this.listeners[type]) {
      listener(event);
    }
  }
}

function createClient(
  socket: MockWebSocket,
  overrides?: Partial<ConstructorParameters<typeof OpenClawGatewayClient>[0]>,
) {
  return new OpenClawGatewayClient({
    gatewayUrl: "ws://localhost:3001/gateway",
    auth: { token: "test-key" },
    webSocketFactory: (url: string) => {
      expect(url).toBe("ws://localhost:3001/gateway");
      return socket as unknown as WebSocket;
    },
    ...overrides,
  });
}

async function connectClient(
  client: OpenClawGatewayClient,
  socket: MockWebSocket,
  methods: string[] = ["sessions.create", "agent.wait", "chat.history", "exec.approval.list"],
) {
  const connectPromise = client.connect();

  socket.open();
  expect(socket.sentFrames).toHaveLength(0);

  socket.emitFrame({
    type: "event",
    event: "connect.challenge",
    payload: { nonce: "nonce-123", ts: 1737264000000 },
  });
  await Promise.resolve();

  const connectRequest = socket.sentFrames.at(0);
  expect(connectRequest).toMatchObject({
    type: "req",
    method: "connect",
    params: {
      minProtocol: 3,
      maxProtocol: 3,
      role: "operator",
      scopes: ["operator.read", "operator.write", "operator.approvals", "operator.admin"],
      auth: { token: "test-key" },
      client: {
        id: "openclaw-probe",
        mode: "probe",
      },
    },
  });

  socket.emitFrame({
    type: "res",
    id: connectRequest?.id,
    ok: true,
    payload: {
      type: "hello-ok",
      protocol: 3,
      features: { methods },
    },
  });

  await expect(connectPromise).resolves.toMatchObject({
    protocol: 3,
    methods,
  });
}

describe("OpenClawGatewayClient", () => {
  it("completes the gateway challenge handshake before sending RPC calls", async () => {
    const socket = new MockWebSocket();
    const client = createClient(socket);

    await connectClient(client, socket);
  });

  it("maps create-run requests onto sessions.create and returns session/run refs", async () => {
    const socket = new MockWebSocket();
    const client = createClient(socket);
    await connectClient(client, socket);

    const createRunPromise = client.createRun({ prompt: "test prompt" });
    await Promise.resolve();
    const createRunRequest = socket.sentFrames.at(-1);

    expect(createRunRequest).toMatchObject({
      type: "req",
      method: "sessions.create",
      params: {
        task: "test prompt",
      },
    });

    socket.emitFrame({
      type: "res",
      id: createRunRequest?.id,
      ok: true,
      payload: {
        key: "session_key_456",
        sessionId: "session_456",
        runId: "run_123",
        runStarted: true,
      },
    });

    await expect(createRunPromise).resolves.toMatchObject({
      runtimeRunRef: "run_123",
      runtimeSessionRef: "session_456",
      runtimeSessionKey: "session_key_456",
    });
  });

  it("maps wait, history, and approval methods onto gateway RPC frames", async () => {
    const socket = new MockWebSocket();
    const client = createClient(socket);
    await connectClient(client, socket);

    const waitPromise = client.waitForRun("run_123", 25);
    await Promise.resolve();
    const waitRequest = socket.sentFrames.at(-1);

    expect(waitRequest).toMatchObject({
      type: "req",
      method: "agent.wait",
      params: { runId: "run_123", timeoutMs: 25 },
    });

    socket.emitFrame({
      type: "res",
      id: waitRequest?.id,
      ok: true,
      payload: { runId: "run_123", status: "completed" },
    });

    await expect(waitPromise).resolves.toMatchObject({
      runtimeRunRef: "run_123",
      status: "Completed",
    });

    const historyPromise = client.readOutputs("session_key_456");
    await Promise.resolve();
    const historyRequest = socket.sentFrames.at(-1);

    expect(historyRequest).toMatchObject({
      type: "req",
      method: "chat.history",
      params: { sessionKey: "session_key_456" },
    });

    socket.emitFrame({
      type: "res",
      id: historyRequest?.id,
      ok: true,
      payload: { messages: [{ role: "assistant", content: "done" }] },
    });

    await expect(historyPromise).resolves.toEqual({
      messages: [{ role: "assistant", content: "done" }],
    });

    const approvalPromise = client.requestApproval({
      command: "echo hello",
      cwd: "/tmp",
      sessionKey: "session_key_456",
    });
    await Promise.resolve();
    const approvalRequest = socket.sentFrames.at(-1);

    expect(approvalRequest).toMatchObject({
      type: "req",
      method: "exec.approval.request",
      params: {
        command: "echo hello",
        cwd: "/tmp",
        host: "gateway",
        sessionKey: "session_key_456",
        twoPhase: true,
      },
    });

    socket.emitFrame({
      type: "res",
      id: approvalRequest?.id,
      ok: true,
      payload: { id: "approval_123", status: "accepted" },
    });

    await expect(approvalPromise).resolves.toEqual({
      approvalId: "approval_123",
      status: "accepted",
    });

    const resolvePromise = client.resolveApproval({
      approvalId: "approval_123",
      decision: "approve",
    });
    await Promise.resolve();
    const resolveRequest = socket.sentFrames.at(-1);

    expect(resolveRequest).toMatchObject({
      type: "req",
      method: "exec.approval.resolve",
      params: { id: "approval_123", decision: "allow-once" },
    });

    socket.emitFrame({
      type: "res",
      id: resolveRequest?.id,
      ok: true,
      payload: { id: "approval_123", decision: "approve" },
    });

    await expect(resolvePromise).resolves.toEqual({ accepted: true });
  });

  it("maps approval listing and session input onto gateway RPC frames", async () => {
    const socket = new MockWebSocket();
    const client = createClient(socket);
    await connectClient(client, socket);

    const listPromise = client.listApprovals();
    await Promise.resolve();
    const listRequest = socket.sentFrames.at(-1);

    expect(listRequest).toMatchObject({
      type: "req",
      method: "exec.approval.list",
      params: {},
    });

    socket.emitFrame({
      type: "res",
      id: listRequest?.id,
      ok: true,
      payload: [
        {
          id: "approval_123",
          createdAtMs: 1737264000000,
          expiresAtMs: 1737267600000,
          request: {
            sessionKey: "session_key_456",
            host: "gateway",
            command: "apply_patch",
            ask: "Approve patch",
          },
        },
      ],
    });

    await expect(listPromise).resolves.toEqual([
      {
        approvalId: "approval_123",
        sessionKey: "session_key_456",
        host: "gateway",
        command: "apply_patch",
        ask: "Approve patch",
        createdAtMs: 1737264000000,
        expiresAtMs: 1737267600000,
      },
    ]);

    const sendPromise = client.sendInput({
      runtimeSessionKey: "session_key_456",
      message: "Please continue.",
    });
    await Promise.resolve();
    const sendRequest = socket.sentFrames.at(-1);

    expect(sendRequest).toMatchObject({
      type: "req",
      method: "sessions.send",
      params: {
        key: "session_key_456",
        message: "Please continue.",
      },
    });

    socket.emitFrame({
      type: "res",
      id: sendRequest?.id,
      ok: true,
      payload: {
        key: "session_key_456",
        runId: "run_456",
        runStarted: true,
      },
    });

    await expect(sendPromise).resolves.toEqual({
      accepted: true,
      runtimeRunRef: "run_456",
      runtimeSessionKey: "session_key_456",
      runStarted: true,
    });

    const waitDecisionPromise = client.waitForApprovalDecision("approval_123");
    await Promise.resolve();
    const waitDecisionRequest = socket.sentFrames.at(-1);

    expect(waitDecisionRequest).toMatchObject({
      type: "req",
      method: "exec.approval.waitDecision",
      params: { id: "approval_123" },
    });

    socket.emitFrame({
      type: "res",
      id: waitDecisionRequest?.id,
      ok: true,
      payload: { id: "approval_123", decision: "allow-once" },
    });

    await expect(waitDecisionPromise).resolves.toBe("allow-once");
  });

  it("returns an empty approval list when the gateway does not advertise list support", async () => {
    const socket = new MockWebSocket();
    const client = createClient(socket);
    await connectClient(client, socket, ["sessions.create", "agent.wait", "chat.history"]);

    const sentBefore = socket.sentFrames.length;
    await expect(client.listApprovals()).resolves.toEqual([]);
    expect(socket.sentFrames).toHaveLength(sentBefore);
  });

  it("downgrades unknown approval list methods to an empty result", async () => {
    const socket = new MockWebSocket();
    const client = createClient(socket);
    await connectClient(client, socket);

    socket.sentFrames.length = 0;
    const listPromise = client.listApprovals();
    await Promise.resolve();
    const listRequest = socket.sentFrames.at(-1);

    expect(listRequest).toMatchObject({
      type: "req",
      method: "exec.approval.list",
      params: {},
    });

    socket.emitFrame({
      type: "res",
      id: listRequest?.id,
      ok: false,
      error: { message: "unknown method exec.approval.list" },
    });

    await expect(listPromise).resolves.toEqual([]);
  });

  it("sends a stable device identity and reuses the stored device token during connect", async () => {
    const socket = new MockWebSocket();
    const sign = vi.fn().mockResolvedValue("signed-payload");
    const client = createClient(socket, {
      auth: { token: "shared-token" },
      deviceIdentity: {
        deviceId: "device_123",
        publicKey: "public-key-abc",
        deviceToken: "device-token-123",
        platform: "linux",
        sign,
      },
    });

    const connectPromise = client.connect();

    socket.open();
    socket.emitFrame({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-123", ts: 1737264000000 },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(sign).toHaveBeenCalledWith(
      "v3|device_123|openclaw-probe|probe|operator|operator.read,operator.write,operator.approvals,operator.admin|1737264000000|device-token-123|nonce-123|linux|",
    );

    const connectRequest = socket.sentFrames.at(0);
    expect(connectRequest).toMatchObject({
      type: "req",
      method: "connect",
      params: {
        auth: { deviceToken: "device-token-123" },
        device: {
          id: "device_123",
          publicKey: "public-key-abc",
          signature: "signed-payload",
          signedAt: 1737264000000,
          nonce: "nonce-123",
        },
      },
    });

    socket.emitFrame({
      type: "res",
      id: connectRequest?.id,
      ok: true,
      payload: {
        type: "hello-ok",
        protocol: 3,
        features: { methods: ["sessions.create"] },
      },
    });

    await expect(connectPromise).resolves.toMatchObject({ protocol: 3 });
  });
});
