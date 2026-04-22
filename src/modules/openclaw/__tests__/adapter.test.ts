import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveOpenClawAdapter, createRuntimeAdapter } from "@/modules/openclaw/adapter";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  delete process.env.OPENCLAW_MODE;
  delete process.env.OPENCLAW_BRIDGE_URL;
  delete process.env.OPENCLAW_TIMEOUT;
  fetchMock.mockReset();
});

describe("createRuntimeAdapter", () => {
  it("uses the bridge client whenever runtime mode is not mock", async () => {
    process.env.OPENCLAW_MODE = "bridge";
    process.env.OPENCLAW_BRIDGE_URL = "http://bridge.example:7677";
    process.env.OPENCLAW_TIMEOUT = "42";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        sessionId: "bridge-session-1",
        output: "ok",
        toolCalls: [],
        usage: null,
        error: null,
        durationMs: 5,
      }),
    });

    const adapter = await createRuntimeAdapter();
    const result = await adapter.createRun({
      prompt: "hello",
      runtimeInput: {
        model: "gpt-5.4",
        approvalPolicy: "never",
        toolMode: "workspace-write",
        temperature: 0.2,
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://bridge.example:7677/v1/chat",
      expect.objectContaining({ method: "POST" }),
    );
    const [, requestInit] = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(String(requestInit?.body));
    expect(requestBody).toMatchObject({
      message: "hello",
      timeout: 42,
      execution: {
        mode: "task",
        runtimeAdapterKey: "openclaw",
        runtimeInput: {
          model: "gpt-5.4",
          approvalPolicy: "never",
          toolMode: "workspace-write",
          temperature: 0.2,
        },
      },
    });
    expect(typeof requestBody.sessionId).toBe("string");
    expect(result).toEqual({
      runStarted: true,
      runtimeRunRef: "bridge-session-1",
      runtimeSessionRef: "bridge-session-1",
      runtimeSessionKey: expect.any(String),
    });
  });
});

describe("createLiveOpenClawAdapter", () => {
  it("resolves approval first and then sends edited input", async () => {
    const client = {
      connect: vi.fn(),
      close: vi.fn(),
      createRun: vi.fn(),
      waitForRun: vi.fn(),
      readOutputs: vi.fn(),
      requestApproval: vi.fn(),
      listApprovals: vi.fn(),
      waitForApprovalDecision: vi.fn(),
      resolveApproval: vi.fn().mockResolvedValue({ accepted: true }),
      sendInput: vi.fn().mockResolvedValue({
        accepted: true,
        runtimeRunRef: "runtime_123",
        runtimeSessionKey: "session_123",
        runStarted: true,
      }),
    };

    const adapter = createLiveOpenClawAdapter(client);
    const result = await adapter.resumeRun({
      runtimeSessionKey: "session_123",
      approvalId: "approval_123",
      decision: "approve",
      inputText: "Use the edited content",
    });

    expect(client.resolveApproval).toHaveBeenCalledWith({
      approvalId: "approval_123",
      decision: "approve",
    });
    expect(client.sendInput).toHaveBeenCalledWith({
      runtimeSessionKey: "session_123",
      message: "Use the edited content",
    });
    expect(result).toEqual({
      accepted: true,
      runtimeRunRef: "runtime_123",
      runtimeSessionKey: "session_123",
      runStarted: true,
    });
  });
});
