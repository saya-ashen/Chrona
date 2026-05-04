import type { BridgeResponse, ToolCallInfo } from "@chrona/openclaw-integration/bridge/contracts";

export interface ProviderConfig {
  gatewayUrl: string;
  gatewayToken?: string;
  model?: string;
  timeoutSeconds?: number;
}

export interface StreamEvent {
  type: "text" | "tool_call" | "tool_result" | "done" | "error";
  data: string;
  toolCall?: ToolCallInfo;
}

export type ProviderFeature =
  | "suggest"
  | "generate_plan"
  | "conflicts"
  | "timeslots"
  | "chat"
  | "dispatch_task";

export abstract class ProviderClient {
  constructor(protected readonly config: ProviderConfig) {}

  abstract executeFeature(
    feature: ProviderFeature,
    input: {
      sessionKey?: string;
      instructions?: string;
      timeout?: number;
      [key: string]: unknown;
    },
  ): Promise<BridgeResponse>;

  abstract executeFeatureStream(
    feature: ProviderFeature,
    input: {
      sessionKey?: string;
      instructions?: string;
      timeout?: number;
      [key: string]: unknown;
    },
  ): AsyncGenerator<StreamEvent>;

  abstract executeTask(
    input: {
      sessionKey?: string;
      instructions: string;
      prompt?: string;
      runtimeInput?: Record<string, unknown>;
      timeout?: number;
      [key: string]: unknown;
    },
  ): Promise<BridgeResponse>;

  abstract checkHealth(): Promise<boolean>;
}
