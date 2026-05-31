import type {
  CalendarSourceListResponse,
  CalendarSourceResponse,
  CreateCalendarSourceRequest,
  ImportedCalendarEventListResponse,
  UpdateCalendarSourceRequest,
  ValidateCalendarSourceResponse,
} from "@chrona/contracts";

import { apiJson } from "@/api";
import { externalCalendarMessages } from "@/lib/i18n/messages";

const base = (workspaceId: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}`;

export function validateCalendarSource(workspaceId: string, url: string) {
  return apiJson<ValidateCalendarSourceResponse>(`${base(workspaceId)}/calendar-sources/validate`, {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export function createExternalCalendarSource(
  workspaceId: string,
  input: CreateCalendarSourceRequest,
) {
  return apiJson<CalendarSourceResponse>(`${base(workspaceId)}/calendar-sources`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listExternalCalendarSources(workspaceId: string) {
  return apiJson<CalendarSourceListResponse>(`${base(workspaceId)}/calendar-sources`);
}

export function updateExternalCalendarSource(
  workspaceId: string,
  sourceId: string,
  input: UpdateCalendarSourceRequest,
) {
  return apiJson<CalendarSourceResponse>(
    `${base(workspaceId)}/calendar-sources/${encodeURIComponent(sourceId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function refreshExternalCalendarSource(workspaceId: string, sourceId: string) {
  return apiJson<CalendarSourceResponse>(
    `${base(workspaceId)}/calendar-sources/${encodeURIComponent(sourceId)}/refresh`,
    { method: "POST" },
  );
}

export function deleteExternalCalendarSource(workspaceId: string, sourceId: string) {
  return apiJson<{ removed: true; sourceId: string }>(
    `${base(workspaceId)}/calendar-sources/${encodeURIComponent(sourceId)}`,
    { method: "DELETE" },
  );
}

export function listExternalCalendarEvents(workspaceId: string, from: string, to: string, sourceId?: string) {
  const params = new URLSearchParams({ from, to });
  if (sourceId) params.set("sourceId", sourceId);
  return apiJson<ImportedCalendarEventListResponse>(`${base(workspaceId)}/calendar-events?${params}`);
}

export function getExternalCalendarErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object") {
      const code = "errorCode" in data ? (data as { errorCode?: unknown }).errorCode : undefined;
      if (code === "invalid_url") return externalCalendarMessages.invalidUrl;
      if (code === "unsupported_scheme") return externalCalendarMessages.unsupportedScheme;
      if (code === "unreachable") return externalCalendarMessages.unreachable;
      if (code === "unauthorized") return externalCalendarMessages.unauthorized;
      if (code === "malformed_calendar") return externalCalendarMessages.malformedCalendar;
      if (code === "too_large") return externalCalendarMessages.tooLarge;
      const message = "message" in data ? (data as { message?: unknown }).message : undefined;
      if (typeof message === "string" && message.trim()) return message;
    }
  }

  if (error instanceof Error && error.message) return error.message;
  return externalCalendarMessages.unknownError;
}
