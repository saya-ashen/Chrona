/**
 * @chrona/openclaw
 *
 * OpenClaw transport and protocol surface shared by higher layers.
 */

export {
  buildGatewayBody,
  checkGatewayAvailable,
  gatewayHeaders,
  normalizeGatewayHttpUrl,
} from "./gateway";

export { createOpenClawClient, OpenClawClient } from "./OpenClawClient";

export {
  getOpenClawTaskConfigSpec,
  OPENCLAW_EXECUTION_RUNTIME,
  validateOpenClawTaskConfig,
} from "./config";

export type { OpenClawConnectionConfig } from "./OpenClawClient";

export type {
  BridgeEnvironment,
  BridgeFeature,
  BridgeFeatureResult,
  BridgeLogger,
  BridgeRequest,
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
  OpenClawToolCall,
  StructuredAgentResult,
  ToolCallInfo,
  ToolCallOutputInfo,
} from "./types";
