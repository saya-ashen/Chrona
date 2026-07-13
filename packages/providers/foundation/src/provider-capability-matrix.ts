import type { ProviderCapabilities } from "./ProviderClient";
import type { ProviderCapabilityName } from "@chrona/contracts";

export type {
  ProviderCapabilityMatrixEntry,
  ProviderCapabilityName,
  ProviderExecutionCapabilityName,
  ProviderRecoveryCapabilityName,
  ProviderRecoveryMode,
} from "@chrona/contracts";

export { providerCapabilityMatrix } from "@chrona/contracts";

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
