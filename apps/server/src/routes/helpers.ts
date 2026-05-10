import { createLogger } from "@chrona/shared/logger";
import { ENGINE_ERROR_CODES } from "@chrona/engine";

import { HttpError } from "../lib/http";

export const VALID_AI_FEATURES = [
  "suggest",
  "generate_plan",
  "conflicts",
  "timeslots",
  "chat",
] as const;
export const logger = createLogger("apps.server.api");

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

export function planGenerationConflictBody(taskId: string) {
  return {
    error:
      "A task plan generation job is already running. Stop the current generation before starting a new one.",
    code: ENGINE_ERROR_CODES.PLAN_GENERATION_IN_FLIGHT,
    taskId,
    stopEndpoint: `/api/tasks/${taskId}/plan/generations/stop`,
  };
}
