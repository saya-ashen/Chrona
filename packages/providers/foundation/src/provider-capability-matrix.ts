import type { ProviderCapabilities } from "./ProviderClient";

export type ProviderCapabilityName =
  | "healthCheck"
  | "startRun"
  | "streamEvents"
  | "getRunSnapshot"
  | "cancelRun"
  | "approvalEvent"
  | "toolTraces"
  | "structuredOutput"
  | "sessionResume";

export type ProviderCapabilityMatrixEntry = {
  provider: "hermes" | "claude_code" | "codex";
  label: string;
  capabilities: Record<ProviderCapabilityName, boolean>;
  uiBehavior: Record<ProviderCapabilityName, string>;
};

const UI_BEHAVIOR: Record<ProviderCapabilityName, string> = {
  healthCheck: "Settings shows provider readiness.",
  startRun: "Execution start action can be enabled when task state allows it.",
  streamEvents: "Workspace can show live execution progress.",
  getRunSnapshot: "Engine can recover stale running state from provider snapshot.",
  cancelRun: "Workspace can show cancel/stop action during active runs.",
  approvalEvent: "Workspace can show approval checkpoint action.",
  toolTraces: "Activity view can show provider tool activity.",
  structuredOutput: "Result panel can validate json-render output and fall back to text.",
  sessionResume: "Workspace can expose resume/reconnect behavior for interrupted sessions.",
};

export const providerCapabilityMatrix = [
  {
    provider: "hermes",
    label: "Hermes",
    capabilities: {
      healthCheck: true,
      startRun: true,
      streamEvents: true,
      getRunSnapshot: true,
      cancelRun: true,
      approvalEvent: true,
      toolTraces: true,
      structuredOutput: true,
      sessionResume: true,
    },
    uiBehavior: UI_BEHAVIOR,
  },
  {
    provider: "claude_code",
    label: "Claude Code",
    capabilities: {
      healthCheck: true,
      startRun: true,
      streamEvents: true,
      getRunSnapshot: true,
      cancelRun: true,
      approvalEvent: true,
      toolTraces: true,
      structuredOutput: true,
      sessionResume: true,
    },
    uiBehavior: UI_BEHAVIOR,
  },
  {
    provider: "codex",
    label: "Codex",
    capabilities: {
      healthCheck: true,
      startRun: true,
      streamEvents: true,
      getRunSnapshot: false,
      cancelRun: true,
      approvalEvent: false,
      toolTraces: true,
      structuredOutput: true,
      sessionResume: true,
    },
    uiBehavior: UI_BEHAVIOR,
  },
] as const satisfies readonly ProviderCapabilityMatrixEntry[];

export function summarizeProviderCapabilities(capabilities: ProviderCapabilities): Record<ProviderCapabilityName, boolean> {
  return {
    healthCheck: true,
    startRun: true,
    streamEvents: capabilities.supportsStreaming,
    getRunSnapshot: capabilities.supportsRunLookup,
    cancelRun: capabilities.supportsCancellation,
    approvalEvent: capabilities.approval?.supported ?? false,
    toolTraces: capabilities.supportsToolCalls,
    structuredOutput: true,
    sessionResume: capabilities.supportsSessions,
  };
}
