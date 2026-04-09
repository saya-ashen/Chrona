import { describe, expect, it, vi } from "vitest";
import { createLiveOpenClawAdapter } from "@/modules/runtime/openclaw/adapter";

describe("createLiveOpenClawAdapter", () => {
  it("resolves approval first and then sends edited input", async () => {
    const client = {
      createRun: vi.fn(),
      waitForRun: vi.fn(),
      readOutputs: vi.fn(),
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
