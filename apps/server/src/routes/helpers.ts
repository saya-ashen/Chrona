import { randomUUID } from "node:crypto";

import { TaskStatus } from "@chrona/db/generated/prisma/client";
import type { StructuredSuggestion } from "@chrona/contracts";
import { createLogger } from "@chrona/db/logger";

import { TASK_PLAN_GENERATION_IN_FLIGHT_CODE } from "@chrona/engine";
import { OpenClawClient } from "@chrona/providers-core";

import { HttpError } from "../lib/http";

export const VALID_TASK_STATUSES = new Set(Object.values(TaskStatus));
export const VALID_AI_FEATURES = [
  "suggest",
  "generate_plan",
  "conflicts",
  "timeslots",
  "chat",
] as const;
export const logger = createLogger("apps.server.api");

export async function testOpenClaw(config: Record<string, unknown>) {
  const gatewayUrl =
    typeof config.gatewayUrl === "string"
      ? config.gatewayUrl
      : typeof config.bridgeUrl === "string"
        ? config.bridgeUrl
        : "";
  const gatewayToken =
    typeof config.gatewayToken === "string" ? config.gatewayToken : "";
  if (!gatewayUrl) {
    return { available: false, reason: "Gateway URL is required" };
  }

  try {
    const client = new OpenClawClient({
      gatewayUrl,
      gatewayToken: gatewayToken || undefined,
    });
    const healthy = await client.checkHealth();
    return healthy
      ? { available: true, reason: "Gateway is reachable" }
      : { available: false, reason: "Gateway health check failed" };
  } catch (errorValue) {
    return {
      available: false,
      reason:
        errorValue instanceof Error
          ? errorValue.message
          : "Failed to reach gateway",
    };
  }
}

export function testLlm(config: Record<string, unknown>) {
  if (typeof config.baseUrl !== "string" || !config.baseUrl) {
    return { available: false, reason: "Base URL is required" };
  }
  if (typeof config.apiKey !== "string" || !config.apiKey) {
    return { available: false, reason: "API key is required" };
  }
  return { available: true, reason: "LLM configuration looks valid" };
}

export function generateSuggestionSummary(s: {
  title: string;
  priority: string;
  estimatedMinutes: number;
}) {
  const priorityMap: Record<string, string> = {
    Low: "低优先级",
    Medium: "中优先级",
    High: "高优先级",
    Urgent: "紧急",
  };
  return `创建${s.estimatedMinutes}分钟的「${s.title}」任务，${priorityMap[s.priority] ?? s.priority}`;
}

function normalizeSuggestionShape(
  parsed: unknown,
): StructuredSuggestion[] | null {
  if (!parsed || typeof parsed !== "object") return null;
  const envelope = parsed as {
    suggestions?: Array<{
      title?: string;
      description?: string;
      priority?: string;
      estimatedMinutes?: number;
      tags?: string[];
      suggestedSlot?: { startAt: string; endAt: string };
    }>;
    result?: {
      suggestions?: Array<{
        title?: string;
        description?: string;
        priority?: string;
        estimatedMinutes?: number;
        tags?: string[];
        suggestedSlot?: { startAt: string; endAt: string };
      }>;
    };
  };

  const suggestions = envelope.suggestions ?? envelope.result?.suggestions;
  if (!Array.isArray(suggestions)) return null;

  return suggestions
    .filter((item) => item.title)
    .map((item) => ({
      id: randomUUID(),
      summary: generateSuggestionSummary({
        title: item.title!,
        priority: item.priority ?? "Medium",
        estimatedMinutes: item.estimatedMinutes ?? 30,
      }),
      action: {
        type: "create_task" as const,
        title: item.title!,
        description: item.description ?? "",
        priority: (item.priority ?? "Medium") as
          | "Low"
          | "Medium"
          | "High"
          | "Urgent",
        estimatedMinutes: item.estimatedMinutes ?? 30,
        tags: item.tags ?? [],
        scheduledStartAt: item.suggestedSlot?.startAt,
        scheduledEndAt: item.suggestedSlot?.endAt,
      },
    }));
}

export function tryExtractSuggestions(
  text: string,
): StructuredSuggestion[] | null {
  const jsonMatch =
    text.match(/```(?:json)?\s*\n?([\s\S]*?)```/) ??
    text.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch?.[1] ?? text;
  try {
    return normalizeSuggestionShape(JSON.parse(jsonStr.trim()));
  } catch {
    return null;
  }
}

export function planGenerationConflictBody(taskId: string) {
  return {
    error:
      "A task plan generation job is already running. Stop the current generation before starting a new one.",
    code: TASK_PLAN_GENERATION_IN_FLIGHT_CODE,
    taskId,
    stopEndpoint: `/api/tasks/${taskId}/plan/generate/stop`,
  };
}

export function sseEncode(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function toDateOrNull(value: unknown) {
  return typeof value === "string" && value ? new Date(value) : null;
}

function isInvalidDate(value: Date | null | undefined) {
  return value instanceof Date && Number.isNaN(value.getTime());
}

export function ensureValidDateFields(
  fields: Record<string, Date | null | undefined>,
) {
  for (const [field, value] of Object.entries(fields)) {
    if (isInvalidDate(value)) {
      throw new HttpError(400, `${field} must be a valid date string`);
    }
  }
}
