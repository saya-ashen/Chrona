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

export {
  OpenClawClient,
} from "./client/OpenClawClient";

export type {
  OpenClawClientConfig,
  OpenClawFeature,
  OpenClawResponse,
  OpenClawStreamEvent,
  OpenClawToolCall,
} from "./client/types";

export { normalizeGatewayHttpUrl } from "./shared/constants";

export type { BridgeEnvironment } from "./shared/types";

export type {
  BridgeFeature,
  BridgeFeatureRequest,
  BridgeResponse,
  NDJSONEvent,
  ToolCallInfo,
} from "./transport/bridge-types";
