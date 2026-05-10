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
  createOpenClawClient,
  OpenClawClient,
} from "./OpenClawClient";

export {
  getOpenClawTaskConfigSpec,
  OPENCLAW_EXECUTION_RUNTIME,
  validateOpenClawTaskConfig,
} from "./config";

export {
  buildFeatureResultFromResponse,
} from "./feature-contracts";

export type {
  OpenClawConnectionConfig,
  OpenClawResponseRequest,
} from "./OpenClawClient";

export type {
  BridgeEnvironment,
  BridgeFeature,
  BridgeFeatureResult,
  BridgeLogger,
  BridgeRequest,
  BridgeResponse,
  ExecutionResult,
  NDJSONEvent,
  OpenClawApprovalDecision,
  OpenClawApprovalRequest,
  OpenClawApprovalRequestResult,
  OpenClawApprovalResolution,
  OpenClawClientConfig,
  OpenClawChatHistory,
  OpenClawFeature,
  OpenClawGatewayRequest,
  OpenClawPendingApproval,
  OpenClawResponseSnapshot,
  OpenClawResponse,
  OpenClawStreamEvent,
  OpenClawToolCall,
  StructuredAgentResult,
  ToolCallInfo,
  ToolCallOutputInfo,
} from "./types";
