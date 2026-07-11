import { describe, expect, it } from "bun:test";
import { providerCapabilityMatrix, summarizeProviderCapabilities } from "./provider-capability-matrix";

describe("providerCapabilityMatrix", () => {
  it("models Codex as session-history recovery instead of active run lookup", () => {
    const codex = providerCapabilityMatrix.find((entry) => entry.provider === "codex");

    expect(codex?.execution).toMatchObject({
      startRun: true,
      streamEvents: true,
      cancelActiveRun: true,
      approvalBridge: true,
    });
    expect(codex?.recovery).toMatchObject({
      sessionResume: true,
      historyReplay: true,
      activeRunLookup: false,
      streamReconnect: false,
      mode: "session_history",
    });
  });

  it("models Oh My Pi as an ACP session-history provider", () => {
    const omp = providerCapabilityMatrix.find((entry) => entry.provider === "omp");

    expect(omp?.label).toBe("Oh My Pi");
    expect(omp?.execution).toMatchObject({
      startRun: true,
      streamEvents: true,
      cancelActiveRun: true,
      approvalBridge: true,
    });
    expect(omp?.recovery).toMatchObject({
      sessionResume: true,
      historyReplay: true,
      activeRunLookup: false,
      streamReconnect: false,
      mode: "session_history",
    });
  });

  it("summarizes provider recovery independently from run lookup", () => {
    expect(summarizeProviderCapabilities({
      supportsSessions: true,
      supportsStreaming: true,
      supportsRunLookup: false,
      supportsCancellation: true,
      supportsToolCalls: true,
      supportsPreviousResponse: false,
      approval: { supported: true, choices: ["approve_once"], scopes: ["once"], resolveAll: false },
      recovery: {
        sessionResume: true,
        historyReplay: true,
        activeRunLookup: false,
        streamReconnect: false,
        mode: "session_history",
      },
    })).toMatchObject({
      approvalBridge: true,
      sessionResume: true,
      historyReplay: true,
      activeRunLookup: false,
      streamReconnect: false,
    });
  });
});
