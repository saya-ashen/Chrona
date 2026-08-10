/* eslint-disable complexity -- Capability negotiation intentionally enumerates each provider contract combination. */
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
    crossProcessDurable: recovery?.crossProcessDurable ?? false,
    clientOperationLookup: capabilities.lookupByClientOperationId ?? false,
    readOnlySingleAttempt: capabilities.readOnlySingleAttempt ?? false,
    providerResumeRef: recovery?.providerResumeRef ?? false,
    runEventReplay: recovery?.runEventReplay ?? false,
    engineManagedToolResults: capabilities.actionInvocation === "engine_managed",
    externalControlPlaneActions: capabilities.actionInvocation === "external_control_plane",
  };
}
