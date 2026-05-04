/**
 * @chrona/openclaw
 *
 * OpenClaw transport and protocol surface shared by higher layers.
 */

export {
  buildGatewayBody,
  checkGatewayAvailable,
  gatewayHeaders,
  buildFeatureResultFromResponse,
} from "./provider-client";

export { normalizeGatewayHttpUrl } from "./shared/constants";

export type { BridgeEnvironment } from "./shared/types";

export type {
  BridgeFeature,
  BridgeFeatureRequest,
  BridgeResponse,
  NDJSONEvent,
  ToolCallInfo,
} from "./transport/bridge-types";

export {
  OPENCLAW_RUNTIME_ADAPTER_KEY,
  OPENCLAW_RUNTIME_INPUT_VERSION,
  getOpenClawTaskConfigSpec,
  validateOpenClawTaskConfig,
} from "./config/config";

export {
  createRuntimeAdapter,
  type OpenClawAdapter,
  type OpenClawAdapterConfig,
} from "./runtime/adapter";



export type {
  OpenClawApprovalDecision,
  OpenClawChatHistory,
  OpenClawPendingApproval,
  OpenClawRunSnapshot,
} from "./protocol/openclaw";
