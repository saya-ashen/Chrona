import type { StructuredAgentResult } from "@chrona/openclaw-integration/protocol/structured-result";
import type {
  BridgeExecutionTaskRequest,
  BridgeFeature,
  BridgeFeatureRequest,
  BridgeFeatureResult,
  BridgeRequest,
  BridgeResponse,
  NDJSONEvent,
  ToolCallInfo,
  ToolCallOutputInfo,
} from "@chrona/openclaw-integration/bridge/contracts";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type BridgeLogger = {
  debug: (event: string, data?: Record<string, unknown>) => void;
  info: (event: string, data?: Record<string, unknown>) => void;
  warn: (event: string, data?: Record<string, unknown>) => void;
  error: (event: string, data?: Record<string, unknown>) => void;
};

export type RouteKind =
  | { kind: "feature"; feature: BridgeFeature; stream: boolean }
  | { kind: "execution"; stream: boolean };

export interface ExecutionResult {
  response: BridgeResponse;
  events: NDJSONEvent[];
}

export interface BridgeLogEntry {
  ts: string;
  level: LogLevel;
  event: string;
  data?: Record<string, unknown>;
}

export interface BridgeEnvironment {
  defaultPort: number;
  gatewayHttpUrl: string;
  gatewayToken: string;
  agentId: string;
  model?: string;
  messageChannel?: string;
}

export interface StartBridgeServerOptions {
  port?: number;
  hostname?: string;
  logger?: BridgeLogger;
  checkGatewayAvailable?: () => Promise<boolean>;
  executeRequest?: (
    route: RouteKind,
    request: BridgeRequest,
  ) => Promise<ExecutionResult>;
}

export type {
  StructuredAgentResult,
  BridgeExecutionTaskRequest,
  BridgeFeature,
  BridgeFeatureRequest,
  BridgeFeatureResult,
  BridgeRequest,
  BridgeResponse,
  NDJSONEvent,
  ToolCallInfo,
  ToolCallOutputInfo,
};
