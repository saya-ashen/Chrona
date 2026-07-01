import { createLogger } from "@chrona/logging";
import { ENGINE_ERROR_CODES } from "@chrona/engine";
import { getApiMessages, type Locale } from "@chrona/i18n";
import { AI_FEATURES } from "@chrona/contracts";

import { HttpError } from "../lib/http";

export const VALID_AI_FEATURES = AI_FEATURES;
export const logger = createLogger("apps.server.api");

export function toDateOrNull(value: unknown) {
  return typeof value === "string" && value ? new Date(value) : null;
}

function isInvalidDate(value: Date | null | undefined) {
  return value instanceof Date && Number.isNaN(value.getTime());
}

export function ensureValidDateFields(
  fields: Record<string, Date | null | undefined>,
  locale: Locale = "en",
) {
  const messages = getApiMessages(locale);
  for (const [field, value] of Object.entries(fields)) {
    if (isInvalidDate(value)) {
      throw new HttpError(400, messages.invalidDateField.replace("{field}", field));
    }
  }
}

export function planGenerationConflictBody(taskId: string, locale: Locale = "en") {
  return {
    error: getApiMessages(locale).planGenerationInFlight,
    code: ENGINE_ERROR_CODES.PLAN_GENERATION_IN_FLIGHT,
    taskId,
    stopEndpoint: `/api/tasks/${taskId}/plan/generations/stop`,
  };
}
