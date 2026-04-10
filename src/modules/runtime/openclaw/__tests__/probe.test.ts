import { describe, expect, it, vi } from "vitest";
import type { OpenClawRuntimeClient } from "@/modules/runtime/openclaw/client";
import { evaluateOpenClawGate } from "@/modules/runtime/openclaw/evaluate-gate";
import {
  collectOpenClawGateChecks,
  OPENCLAW_PROBE_PROMPT,
  renderOpenClawGateMarkdown,
} from "@/modules/runtime/openclaw/probe";

function createRuntimeClient(): OpenClawRuntimeClient {
  return {
    connect: vi.fn().mockResolvedValue({
      protocol: 3,
      methods: ["sessions.create", "agent.wait", "chat.history"],
    }),
    close: vi.fn(),
    createRun: vi.fn().mockResolvedValue({
      runtimeRunRef: "run_123",
      runtimeSessionRef: "session_456",
      runtimeSessionKey: "session_key_456",
      runStarted: true,
    }),
    waitForRun: vi.fn().mockResolvedValue({
      runtimeRunRef: "run_123",
      status: "Completed",
      rawStatus: "completed",
    }),
    readOutputs: vi.fn().mockResolvedValue({
      messages: [{ role: "assistant", content: "probe complete" }],
    }),
    requestApproval: vi.fn().mockResolvedValue({
      approvalId: "approval_123",
      status: "pending",
    }),
    listApprovals: vi.fn().mockResolvedValue([]),
    waitForApprovalDecision: vi.fn().mockResolvedValue(null),
    sendInput: vi.fn().mockResolvedValue({ accepted: true }),
    resolveApproval: vi.fn().mockResolvedValue({ accepted: true }),
  };
}

describe("collectOpenClawGateChecks", () => {
  it("derives all four feasibility checks from gateway operations", async () => {
    const client = createRuntimeClient();

    const checks = await collectOpenClawGateChecks(client);

    expect(client.createRun).toHaveBeenCalledWith({ prompt: OPENCLAW_PROBE_PROMPT });
    expect(client.waitForRun).toHaveBeenCalledWith("run_123", 250);
    expect(client.readOutputs).toHaveBeenCalledWith("session_key_456");
    expect(client.requestApproval).toHaveBeenCalledWith({
      command: "printf openclaw-feasibility",
      cwd: ".",
      host: "gateway",
      sessionKey: "session_key_456",
    });
    expect(client.resolveApproval).toHaveBeenCalledWith({
      approvalId: "approval_123",
      decision: "approve",
    });

    expect(checks).toEqual([
      { name: "create_run", passed: true, evidence: "run_123" },
      { name: "query_status", passed: true, evidence: "completed" },
      { name: "read_outputs", passed: true, evidence: "1 transcript messages" },
      { name: "resume_after_wait", passed: true, evidence: "approval_123 resolved" },
    ]);
  });

  it("polls chat history until transcript messages appear", async () => {
    const client = createRuntimeClient();
    const readOutputs = client.readOutputs as ReturnType<typeof vi.fn>;

    readOutputs
      .mockResolvedValueOnce({ messages: [] })
      .mockResolvedValueOnce({ messages: [] })
      .mockResolvedValueOnce({ messages: [{ role: "assistant", content: "done later" }] });

    const checks = await collectOpenClawGateChecks(client, {
      historyTimeoutMs: 30,
      pollIntervalMs: 10,
      sleep: async () => {},
    });

    expect(client.readOutputs).toHaveBeenCalledTimes(3);
    expect(checks[2]).toEqual({
      name: "read_outputs",
      passed: true,
      evidence: "1 transcript messages",
    });
  });
});

describe("renderOpenClawGateMarkdown", () => {
  it("formats the evaluated gate report as markdown", () => {
    const report = evaluateOpenClawGate([
      { name: "create_run", passed: true, evidence: "run_123" },
      { name: "query_status", passed: true, evidence: "completed" },
      { name: "read_outputs", passed: true, evidence: "1 transcript messages" },
      { name: "resume_after_wait", passed: false, evidence: "approval request rejected" },
    ]);

    expect(renderOpenClawGateMarkdown(report)).toContain("# OpenClaw Feasibility Gate");
    expect(renderOpenClawGateMarkdown(report)).toContain("Overall: FAIL");
    expect(renderOpenClawGateMarkdown(report)).toContain(
      "- resume_after_wait: FAIL (approval request rejected)",
    );
  });
});
