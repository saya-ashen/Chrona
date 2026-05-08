/**
 * @chrona/openclaw
 *
 * OpenClaw transport and protocol surface shared by higher layers.
 */

export {
  buildGatewayBody,
  checkGatewayAvailable,
  executeGatewayRequest,
  gatewayHeaders,
  normalizeGatewayHttpUrl,
} from "./gateway";

export {
  createMockOpenClawAdapter,
  createOpenClawAdapter,
  OpenClawBridgeClient,
  type OpenClawAdapter,
} from "./runtime";

export {
  getOpenClawTaskConfigSpec,
  OPENCLAW_RUNTIME_ADAPTER_KEY,
  OPENCLAW_RUNTIME_INPUT_VERSION,
  validateOpenClawTaskConfig,
} from "./config";

export {
  buildFeatureResultFromResponse,
} from "./feature-contracts";

export {
  OpenClawClient,
} from "./OpenClawClient";

export type {
  BridgeEnvironment,
  BridgeExecutionTaskRequest,
  BridgeFeature,
  BridgeFeatureRequest,
  BridgeFeatureResult,
  BridgeLogger,
  BridgeRequest,
  BridgeResponse,
  ExecutionResult,
  NDJSONEvent,
  OpenClawAdapterConfig,
  OpenClawApprovalDecision,
  OpenClawApprovalRequest,
  OpenClawApprovalRequestResult,
  OpenClawApprovalResolution,
  OpenClawClientConfig,
  OpenClawChatHistory,
  OpenClawFeature,
  OpenClawHello,
  OpenClawPendingApproval,
  OpenClawResponse,
  OpenClawRunSnapshot,
  OpenClawRuntimeClient,
  OpenClawSendInput,
  OpenClawSendInputResult,
  OpenClawSessionStatus,
  OpenClawStreamEvent,
  OpenClawStructuredRunResult,
  OpenClawToolCall,
  OpenClawWaitForRunInput,
  RouteKind,
  StructuredAgentResult,
  ToolCallInfo,
  ToolCallOutputInfo,
} from "./types";
