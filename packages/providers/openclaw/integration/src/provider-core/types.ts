import type {
  BridgeExecutionTaskRequest,
  BridgeFeature,
  BridgeFeatureRequest,
  BridgeRequest,
  BridgeResponse,
  NDJSONEvent,
} from "../transport/bridge-types";

export type BridgeLogger = {
  debug: (message: string, payload?: Record<string, unknown>) => void;
  info: (message: string, payload?: Record<string, unknown>) => void;
  warn: (message: string, payload?: Record<string, unknown>) => void;
  error: (message: string, payload?: Record<string, unknown>) => void;
};

export type RouteKind =
  | { kind: "feature"; feature: BridgeFeature; stream: boolean }
  | { kind: "execution"; stream: boolean };

export type ExecutionResult = {
  response: BridgeResponse;
  events: NDJSONEvent[];
};

export type BridgeEnvironment = {
  defaultPort: number;
  gatewayHttpUrl: string;
  gatewayToken: string;
  agentId: string;
  model?: string;
  messageChannel?: string;
};

export type OpenClawRequest = BridgeRequest;
export type OpenClawFeatureRequest<TInput = Record<string, unknown>> =
  BridgeFeatureRequest<TInput>;
export type OpenClawExecutionRequest = BridgeExecutionTaskRequest;
