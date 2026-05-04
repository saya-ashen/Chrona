import {
  buildGatewayBody,
  checkGatewayAvailable as checkGateway,
  gatewayHeaders,
} from "@chrona/openclaw-bridge/execution/gateway";
import { buildFeatureResultFromResponse } from "@chrona/openclaw-bridge/features/feature-contracts";
import type { BridgeEnvironment } from "@chrona/openclaw-bridge/shared/types";
import type { BridgeResponse, ToolCallInfo } from "@chrona/openclaw-integration/bridge/contracts";
import { ProviderClient, type ProviderConfig, type ProviderFeature, type StreamEvent } from "./ProviderClient";

function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

export class OpenClawClient extends ProviderClient {
  private env: BridgeEnvironment;

  constructor(config: ProviderConfig) {
    super(config);
    this.env = {
      defaultPort: 7677,
      gatewayHttpUrl: config.gatewayUrl,
      gatewayToken: config.gatewayToken ?? "",
      agentId: "main",
      model: config.model,
    };
  }

  async checkHealth(): Promise<boolean> {
    return checkGateway(this.env);
  }

  async executeFeature(
    feature: ProviderFeature,
    input: { sessionKey?: string; instructions?: string; timeout?: number; [key: string]: unknown },
  ): Promise<BridgeResponse> {
    return this.executeGateway("feature", feature, false, input);
  }

  async *executeFeatureStream(
    feature: ProviderFeature,
    input: { sessionKey?: string; instructions?: string; timeout?: number; [key: string]: unknown },
  ): AsyncGenerator<StreamEvent> {
    const { events } = await this.executeGatewayRaw("feature", feature, true, input);
    yield* this.yieldEvents(events);
  }

  async executeTask(
    input: { sessionKey?: string; instructions: string; prompt?: string; timeout?: number; [key: string]: unknown },
  ): Promise<BridgeResponse> {
    return this.executeGateway("execution", undefined as unknown as ProviderFeature, false, input);
  }

  private async executeGateway(
    kind: "feature" | "execution",
    feature: ProviderFeature | undefined,
    stream: boolean,
    input: Record<string, unknown>,
  ): Promise<BridgeResponse> {
    const { response } = await this.executeGatewayRaw(kind, feature, stream, input);
    return response;
  }

  private async executeGatewayRaw(
    kind: "feature" | "execution",
    feature: ProviderFeature | undefined,
    stream: boolean,
    input: Record<string, unknown>,
  ): Promise<{ response: BridgeResponse; events: Array<Record<string, unknown>> }> {
    const route = kind === "feature" && feature
      ? { kind: "feature" as const, feature, stream }
      : { kind: "execution" as const, stream };

    const sessionKey = (input.sessionKey as string) ?? `openclaw-${Date.now()}`;
    const timeout = (input.timeout as number) ?? 300;
    const instructions = (input.instructions as string) ?? "";

    const { sessionKey: _sk, instructions: _in, timeout: _to, ...featureInput } = input;

    const request: Record<string, unknown> = {
      sessionKey,
      timeout,
      instructions,
      input: Object.keys(featureInput).length > 0 ? featureInput : { prompt: instructions },
    };

    const sessionId = `${sessionKey}-${Date.now()}`;
    const body = buildGatewayBody(
      route,
      request as unknown as Parameters<typeof buildGatewayBody>[1],
      sessionId,
      this.env,
    );
    const headers = gatewayHeaders(this.env, request as unknown as Parameters<typeof gatewayHeaders>[1]);
    const timeoutMs = (timeout + 15) * 1000;

    const res = await fetch(`${this.env.gatewayHttpUrl}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`[openclaw] Gateway call failed (${res.status}): ${errText.slice(0, 500)}`);
    }

    if (stream) {
      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("[openclaw] Stream response missing body");
      }

      const decoder = new TextDecoder();
      const events: Array<Record<string, unknown>> = [];
      const toolCalls: ToolCallInfo[] = [];
      let output = "";
      let buffer = "";
      let currentEventType = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith("event:")) {
            currentEventType = trimmed.slice(6).trim();
            continue;
          }
          if (!trimmed.startsWith("data:")) continue;

          const rawData = trimmed.slice(5).trim();
          if (!rawData || rawData === "[DONE]") continue;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(rawData) as Record<string, unknown>;
          } catch {
            currentEventType = "";
            continue;
          }

          if (currentEventType === "response.output_text.delta") {
            const delta = typeof parsed.delta === "string"
              ? parsed.delta
              : typeof parsed.text === "string"
                ? parsed.text
                : "";
            if (delta) {
              output += delta;
              events.push({ delta });
            }
            currentEventType = "";
            continue;
          }

          if (
            currentEventType === "response.output_item.added" ||
            currentEventType === "response.output_item.done"
          ) {
            const item = parsed.item;
            if (item && typeof item === "object" && !Array.isArray(item)) {
              const toolCall = item as Record<string, unknown>;
              if (toolCall.type === "function_call") {
                events.push({ function_call: toolCall });
                toolCalls.push({
                  tool: (toolCall.name as string) ?? "unknown",
                  callId: (toolCall.call_id as string) ?? `${Date.now()}`,
                  input: parseToolArguments(toolCall.arguments),
                  status: "completed",
                });
              }
            }
          }

          currentEventType = "";
        }
      }

      const built = buildFeatureResultFromResponse(
        feature ?? "generate_plan" as ProviderFeature,
        output,
        toolCalls,
      );

      return {
        response: {
          sessionId,
          output: built.error ? "" : output,
          error: built.error,
          toolCalls: built.featureResult ? toolCalls : [],
          usage: null,
          durationMs: 0,
          structured: null,
          feature: built.featureResult,
        },
        events,
      };
    }

    const responseText = await res.text();
    let responseJson: Record<string, unknown>;
    try {
      responseJson = JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      throw new Error(`[openclaw] Invalid JSON from gateway: ${responseText.slice(0, 200)}`);
    }

    const events: Array<Record<string, unknown>> = [];
    let output = "";
    const toolCalls: ToolCallInfo[] = [];

    if (stream) {
      for (const line of responseText.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        try {
          const parsed = JSON.parse(trimmed.slice(6)) as Record<string, unknown>;
          events.push(parsed);
          const delta = (parsed as Record<string, unknown>).delta as string | undefined;
          if (delta) output += delta;
          const toolCall = (parsed as Record<string, unknown>).function_call as Record<string, unknown> | undefined;
          if (toolCall) {
            toolCalls.push({
              tool: (toolCall.name as string) ?? "unknown",
              callId: (toolCall.call_id as string) ?? `${Date.now()}`,
              input: parseToolArguments(toolCall.arguments),
              status: "completed",
            });
          }
        } catch {
          // skip unparseable SSE lines
        }
      }
    } else {
      output = (responseJson.output_text as string) ?? (typeof responseJson.output === "string" ? responseJson.output : "") ?? "";
      events.push(responseJson);
      const responseToolCalls = (responseJson as Record<string, unknown>).output as Array<Record<string, unknown>> | undefined;
      if (responseToolCalls) {
        for (const tc of responseToolCalls) {
          if ((tc as Record<string, unknown>).type !== "function_call") continue;
          toolCalls.push({
            tool: (tc.name as string) ?? "unknown",
            callId: (tc.call_id as string) ?? `${Date.now()}`,
            input: parseToolArguments(tc.arguments),
            status: "completed",
          });
        }
      }
    }

    const built = buildFeatureResultFromResponse(
      feature ?? "generate_plan" as ProviderFeature,
      output,
      toolCalls,
    );

    return {
      response: {
        sessionId,
        output: built.error ? "" : output,
        error: built.error,
        toolCalls: built.featureResult ? toolCalls : [],
        usage: null,
        durationMs: 0,
        structured: null,
        feature: built.featureResult,
      },
      events,
    };
  }

  private async *yieldEvents(
    events: Array<Record<string, unknown>>,
  ): AsyncGenerator<StreamEvent> {
    for (const event of events) {
      const delta = (event as Record<string, unknown>).delta as string | undefined;
      if (delta) {
        yield { type: "text", data: delta };
      }
      const toolCall = (event as Record<string, unknown>).function_call as Record<string, unknown> | undefined;
      if (toolCall) {
        yield {
          type: "tool_call",
          data: JSON.stringify(toolCall),
          toolCall: {
            tool: (toolCall.name as string) ?? "unknown",
            callId: (toolCall.call_id as string) ?? `${Date.now()}`,
            input: parseToolArguments(toolCall.arguments),
            status: "completed" as const,
          },
        };
      }
    }
  }
}
