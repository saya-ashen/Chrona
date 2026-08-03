import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import {
  autoCompleteBodySchema,
  type SmartSuggestion,
  type StreamEvent,
} from "@chrona/contracts";
import {
  getAiClientForFeature,
  suggestStream,
  type ChronaEngine,
} from "@chrona/engine";
import { error, internalServerError } from "../../lib/http";


function structuredSuggestions(
  suggestions: SmartSuggestion[],
  requestId: string,
) {
  return suggestions.map((suggestion, index) => ({
    id: `${requestId}:${index}`,
    summary: suggestion.description || suggestion.title,
    action: {
      type: "create_task" as const,
      title: suggestion.title,
      description: suggestion.description,
      priority: suggestion.priority,
      estimatedMinutes: suggestion.estimatedMinutes,
      tags: suggestion.tags,
      ...(suggestion.suggestedSlot
        ? {
            scheduledStartAt: suggestion.suggestedSlot.startAt,
            scheduledEndAt: suggestion.suggestedSlot.endAt,
          }
        : {}),
    },
  }));
}

function toSse(event: StreamEvent): { event: string; data: string } | null {
  switch (event.type) {
    case "status":
      return { event: "status", data: JSON.stringify({ phase: "running" }) };
    case "tool_call":
    case "tool_result":
    case "partial":
      return null;
    case "result":
      if ("suggestions" in event) {
        return {
          event: "suggestions",
          data: JSON.stringify({
            suggestions: structuredSuggestions(
              event.suggestions.suggestions,
              event.suggestions.requestId,
            ),
            source: event.suggestions.source,
            requestId: event.suggestions.requestId,
            isFinal: true,
          }),
        };
      }
      return null;
    case "done":
      return { event: "done", data: JSON.stringify({}) };
    case "error":
      return { event: "error", data: JSON.stringify({ message: "Suggestion generation failed" }) };
  }
}

export function createAiSuggestionRoutes(_engine: ChronaEngine) {
  return new Hono().post(
    "/ai/auto-complete",
    zValidator("json", autoCompleteBodySchema),
    async (c) => {
      try {
        const client = await getAiClientForFeature("suggest");
        if (!client) return error(c, "No AI client is configured for suggestions", 503);
        const request = c.req.valid("json");
        const abortController = new AbortController();
        return streamSSE(c, async (stream) => {
          stream.onAbort(() => abortController.abort());
          try {
            for await (const event of suggestStream(client, {
              input: request.title,
              kind: "auto-complete",
              workspaceId: request.workspaceId,
              sessionKey: `chrona:suggest:${crypto.randomUUID()}`,
              signal: abortController.signal,
            } as Parameters<typeof suggestStream>[1] & { signal: AbortSignal })) {
              const serialized = toSse(event);
              if (serialized) await stream.writeSSE(serialized);
            }
          } catch {
            if (!abortController.signal.aborted) {
              await stream.writeSSE({
                event: "error",
                data: JSON.stringify({ message: "Suggestion generation failed" }),
              });
            }
          }
        });
      } catch (cause) {
        return internalServerError(
          c,
          "POST /api/ai/auto-complete",
          cause,
          "Suggestion generation failed",
        );
      }
    },
  );
}
