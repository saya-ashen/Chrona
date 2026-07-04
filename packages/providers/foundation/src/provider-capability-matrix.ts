import type { ProviderCapabilities } from "./ProviderClient";

export type ProviderExecutionCapabilityName =
  | "healthCheck"
  | "startRun"
  | "streamEvents"
  | "cancelActiveRun"
  | "toolTraces"
  | "structuredOutput"
  | "approvalBridge";

export type ProviderRecoveryCapabilityName =
  | "sessionResume"
  | "historyReplay"
  | "activeRunLookup"
  | "streamReconnect";

export type ProviderCapabilityName = ProviderExecutionCapabilityName | ProviderRecoveryCapabilityName;

export type ProviderRecoveryMode = "authoritative_run_lookup" | "session_history" | "local_stream_only";

export type ProviderCapabilityMatrixEntry = {
  provider: "hermes" | "claude_code" | "codex";
  label: string;
  execution: Record<ProviderExecutionCapabilityName, boolean>;
  recovery: Record<ProviderRecoveryCapabilityName, boolean> & { mode: ProviderRecoveryMode };
  capabilities: Record<ProviderCapabilityName, boolean>;
  uiBehavior: Record<ProviderCapabilityName, string>;
};

const UI_BEHAVIOR: Record<ProviderCapabilityName, string> = {
  healthCheck: "Settings shows provider readiness.",
  startRun: "Execution start action can be enabled when task state allows it.",
  streamEvents: "Workspace can show live execution progress.",
  cancelActiveRun: "Workspace can show cancel/stop action during active runs.",
  approvalBridge: "Workspace can show provider approval checkpoint actions.",
  toolTraces: "Activity view can show provider tool activity.",
  structuredOutput: "Result panel can validate json-render output and fall back to text.",
  sessionResume: "Workspace can resume provider session context after interruption.",
  historyReplay: "Engine can replay provider session history for terminal evidence.",
  activeRunLookup: "Engine can query an active provider run snapshot by run id.",
  streamReconnect: "Workspace can reconnect to an active provider run stream.",
};

function matrixEntry(input: Omit<ProviderCapabilityMatrixEntry, "capabilities" | "uiBehavior">): ProviderCapabilityMatrixEntry {
  return {
    ...input,
    capabilities: {
      ...input.execution,
      sessionResume: input.recovery.sessionResume,
      historyReplay: input.recovery.historyReplay,
      activeRunLookup: input.recovery.activeRunLookup,
      streamReconnect: input.recovery.streamReconnect,
    },
    uiBehavior: UI_BEHAVIOR,
  };
}

export const providerCapabilityMatrix = [
  matrixEntry({
    provider: "hermes",
    label: "Hermes",
    execution: {
      healthCheck: true,
      startRun: true,
      streamEvents: true,
      cancelActiveRun: true,
      approvalBridge: true,
      toolTraces: true,
      structuredOutput: true,
    },
    recovery: {
      sessionResume: true,
      historyReplay: true,
      activeRunLookup: true,
      streamReconnect: true,
      mode: "authoritative_run_lookup",
    },
  }),
  matrixEntry({
    provider: "claude_code",
    label: "Claude Code",
    execution: {
      healthCheck: true,
      startRun: true,
      streamEvents: true,
      cancelActiveRun: true,
      approvalBridge: false,
      toolTraces: true,
      structuredOutput: true,
    },
    recovery: {
      sessionResume: true,
      historyReplay: true,
      activeRunLookup: true,
      streamReconnect: false,
      mode: "authoritative_run_lookup",
    },
  }),
  matrixEntry({
    provider: "codex",
    label: "Codex",
    execution: {
      healthCheck: true,
      startRun: true,
      streamEvents: true,
      cancelActiveRun: true,
      approvalBridge: true,
      toolTraces: true,
      structuredOutput: true,
    },
    recovery: {
      sessionResume: true,
      historyReplay: true,
      activeRunLookup: false,
      streamReconnect: false,
      mode: "session_history",
    },
  }),
] as const satisfies readonly ProviderCapabilityMatrixEntry[];

export function summarizeProviderCapabilities(capabilities: ProviderCapabilities): Record<ProviderCapabilityName, boolean> {
  const recovery = capabilities.recovery;
  return {
    healthCheck: true,
    startRun: true,
    streamEvents: capabilities.supportsStreaming,
    cancelActiveRun: capabilities.supportsCancellation,
    approvalBridge: capabilities.approval?.supported ?? false,
    toolTraces: capabilities.supportsToolCalls,
    structuredOutput: true,
    sessionResume: recovery?.sessionResume ?? capabilities.supportsSessions,
    historyReplay: recovery?.historyReplay ?? capabilities.supportsRunLookup,
    activeRunLookup: recovery?.activeRunLookup ?? capabilities.supportsRunLookup,
    streamReconnect: recovery?.streamReconnect ?? capabilities.supportsRunLookup,
  };
}
