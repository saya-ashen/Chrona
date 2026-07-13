import { getApiMessages } from "@chrona/i18n";
import { HttpError } from "@shared/http/server";

export { error, HttpError, internalServerError, json, toHttpError } from "@shared/http/server";

export function parseLimit(
  value: string | undefined,
  defaultValue: number,
  max: number,
  locale?: string | null,
) {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, getApiMessages(locale).invalidLimit);
  }

  return Math.min(Math.max(parsed, 1), max);
}
