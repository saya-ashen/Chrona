import { describe, expect, it } from "bun:test";
import { providerCapabilityMatrix, summarizeProviderCapabilities } from "./provider-capability-matrix";
import {
  supportsDurableFeatureRuntime,
  supportsSafeTerminalOnlyFeatureRuntime,
} from "./ProviderClient";

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

  it("models Oh My Pi as a stable SDK session-history provider with fail-closed single-attempt recovery", () => {
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
      readOnlySingleAttempt: true,
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

  it("models the debug adapter as the only engine-managed operation bridge", () => {
    const debug = providerCapabilityMatrix.find((entry) => entry.provider === "debug");
    expect(debug?.execution).toMatchObject({
      engineManagedToolResults: true,
      externalControlPlaneActions: false,
    });
    expect(debug?.recovery).toMatchObject({
      clientOperationLookup: true,
      providerResumeRef: true,
      runEventReplay: true,
    });
  });

  it("summarizes invocation and operation recovery capabilities", () => {
    expect(summarizeProviderCapabilities({
      supportsSessions: true,
      supportsStreaming: true,
      supportsRunLookup: true,
      supportsCancellation: true,
      supportsToolCalls: true,
      supportsPreviousResponse: false,
      actionInvocation: "engine_managed",
      startIdempotency: "client_operation_id",
      lookupByClientOperationId: true,
      recovery: {
        sessionResume: true,
        historyReplay: true,
        activeRunLookup: true,
        streamReconnect: true,
        providerResumeRef: true,
        runEventReplay: true,
        mode: "authoritative_run_lookup",
      },
    })).toMatchObject({
      clientOperationLookup: true,
      providerResumeRef: true,
      runEventReplay: true,
      readOnlySingleAttempt: false,
      engineManagedToolResults: true,
      externalControlPlaneActions: false,
    });
  });

  it("requires cross-process authoritative lookup, reconnect, and idempotent start for Feature Runtime", () => {
    const durable = {
      supportsSessions: true,
      supportsStreaming: true,
      supportsRunLookup: true,
      supportsCancellation: true,
      supportsToolCalls: true,
      supportsPreviousResponse: false,
      startIdempotency: "client_operation_id" as const,
      recovery: {
        sessionResume: true,
        historyReplay: true,
        activeRunLookup: true,
        streamReconnect: true,
        crossProcessDurable: true,
        providerResumeRef: true,
        runEventReplay: true,
        mode: "authoritative_run_lookup" as const,
      },
    };
    expect(supportsDurableFeatureRuntime(durable)).toBe(true);
    expect(supportsDurableFeatureRuntime({ ...durable, recovery: { ...durable.recovery, crossProcessDurable: false, mode: "local_stream_only" } })).toBe(false);
    expect(supportsDurableFeatureRuntime({ ...durable, startIdempotency: "unsupported" })).toBe(false);
  });

  it("accepts only durable attach or explicit terminal-only single attempt recovery", () => {
    const singleAttempt = {
      supportsSessions: true,
      supportsStreaming: true,
      supportsRunLookup: false,
      supportsCancellation: true,
      supportsToolCalls: true,
      supportsPreviousResponse: false,
      startIdempotency: "unsupported" as const,
      readOnlySingleAttempt: true,
      recovery: {
        sessionResume: true,
        historyReplay: true,
        activeRunLookup: false,
        streamReconnect: false,
        crossProcessDurable: false,
        providerResumeRef: true,
        runEventReplay: false,
        mode: "session_history" as const,
      },
    };
    expect(supportsDurableFeatureRuntime(singleAttempt)).toBe(false);
    expect(supportsSafeTerminalOnlyFeatureRuntime(singleAttempt)).toBe(true);
    expect(supportsSafeTerminalOnlyFeatureRuntime({ ...singleAttempt, readOnlySingleAttempt: false })).toBe(false);
    expect(supportsSafeTerminalOnlyFeatureRuntime({ ...singleAttempt, supportsStreaming: false })).toBe(false);
  });
});
