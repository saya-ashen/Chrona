/**
 * @chrona/runtime-client/openclaw
 *
 * OpenClaw runtime client — pure communication layer.
 * No database, no event system, no projections.
 */

// Types
export type {
  GateCheckName,
  GateCheckResult,
  GateReport,
  OpenClawConnectAuth,
  OpenClawDeviceIdentity,
  OpenClawHello,
  OpenClawRunSnapshot,
  OpenClawChatHistory,
  OpenClawApprovalRequest,
  OpenClawApprovalRequestResult,
  OpenClawApprovalResolution,
  OpenClawApprovalDecision,
  OpenClawPendingApproval,
  OpenClawSendInput,
  OpenClawSendInputResult,
  OpenClawExecuteTaskInput,
  OpenClawTaskProgressEvent,
  OpenClawExecuteTaskResult,
  OpenClawSessionStatus,
  RuntimeInput,
  OpenClawOrchestratorStrategy,
  OpenClawOrchestratorConfig,
  OpenClawOrchestratorEvent,
} from "./types";

// Bridge types
export type {
  BridgeRequest,
  BridgeResponse,
  NDJSONEvent,
  ToolCallInfo,
} from "./bridge-types";

// Structured result types
export {
  SUBMIT_STRUCTURED_RESULT_TOOL_NAME,
  STRUCTURED_RESULT_STATUSES,
  extractStructuredResultFromToolCalls,
  parseMaybeJson,
  validateStructuredSubmission,
} from "./structured-result";
export type {
  StructuredAgentResult,
  StructuredResultReliability,
  StructuredResultStatus,
  StructuredSubmissionEnvelope,
  StructuredValidationIssue,
} from "./structured-result";

// Client interface
export type {
  OpenClawRuntimeClient,
  OpenClawWaitForRunInput,
} from "./runtime-client";

// Adapter
export type { OpenClawAdapter } from "./adapter";
export {
  createRuntimeAdapter,
  createLiveOpenClawAdapter,
  getOpenClawTaskConfigSpec,
  OPENCLAW_RUNTIME_ADAPTER_KEY,
  OPENCLAW_RUNTIME_INPUT_VERSION,
  validateOpenClawTaskConfig,
} from "./adapter";

// Bridge client
export { OpenClawBridgeClient } from "./bridge-client";

// Orchestrator
export { OpenClawOrchestrator, createOrchestrator } from "./orchestrator";
export type { OpenClawOrchestratorOptions } from "./orchestrator";

// Mock adapter
export { createMockOpenClawAdapter, createStatefulMockAdapter } from "./mock-adapter";
export type { StatefulMockAdapter, StatefulMockInternals, StatefulMockOptions } from "./mock-adapter";

// Config
export { getOpenClawTaskConfigSpec as getConfigSpec, validateOpenClawTaskConfig as validateConfig } from "./config";

// Device identity
export { loadOpenClawPersistedDeviceIdentity } from "./device-identity";

// Probe & gate
export { collectOpenClawGateChecks, renderOpenClawGateMarkdown, OPENCLAW_PROBE_PROMPT } from "./probe";
export { evaluateOpenClawGate } from "./evaluate-gate";
