import {
  createCalendarSource,
  getCalendarSource,
  listCalendarSources,
  listImportedCalendarEventsInRange,
  markCalendarSourceRemoved,
  replaceImportedCalendarEvents,
  updateCalendarSource,
  updateCalendarSourceSyncStatus,
  type CalendarSource,
  type ImportedCalendarEventWrite,
} from "@chrona/db";
import type {
  CalendarAutomationPolicy,
  CalendarSourceSummary,
  CalendarSourceSyncPolicy,
  CalendarSyncStatus,
  CalendarValidationErrorCode,
  CreateCalendarSourceRequest,
  ImportedCalendarEventSummary,
  UpdateCalendarSourceRequest,
  ValidateCalendarSourceResponse,
} from "@chrona/contracts";
import { normalizeImportedEvents } from "@chrona/domain";
import {
  CalendarFeedError,
  CalendarSourceUrlError,
  fetchCalendarFeed,
  normalizeCalendarSourceUrl,
  parseICalendarFeed,
  safeCalendarErrorMessage,
  type CalendarFeedTransport,
} from "@chrona/integrations";

const DEFAULT_SOURCE_COLOR = "#2563eb";
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const IMPORT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const IMPORT_LOOKAHEAD_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_IMPORTED_OCCURRENCES = 500;

export type ExternalCalendarServiceOptions = {
  transport?: CalendarFeedTransport;
  now?: () => Date;
  autoPlanTask?: (input: { taskId: string; accept?: boolean }) => void | Promise<void>;
};

type CalendarFetchOptions = {
  allowBlockedNetwork?: boolean;
};

function iso(date?: Date | null) {
  return date ? date.toISOString() : undefined;
}

function toSourceSummary(source: CalendarSource): CalendarSourceSummary {
  return {
    id: source.id,
    name: source.name,
    sourceType: "subscription",
    redactedUrlLabel: source.redactedUrlLabel,
    color: source.color,
    syncPolicy: source.syncPolicy,
    automationPolicy: source.automationPolicy as CalendarAutomationPolicy,
    lifecycleState: source.lifecycleState,
    lastSuccessfulRefreshAt: iso(source.lastSuccessfulRefreshAt),
    nextExpectedRefreshAt: iso(source.nextExpectedRefreshAt),
    lastErrorCode: source.lastErrorCode as CalendarValidationErrorCode | undefined,
    lastErrorMessage: source.lastErrorMessage ?? undefined,
  };
}

function defaultSyncPolicyForUrl(url: string): CalendarSourceSyncPolicy {
  const parsed = new URL(url);
  if (parsed.hostname === "calendar.google.com" || parsed.hostname.endsWith(".calendar.google.com")) {
    return "auto_complete_past_events";
  }
  return "keep_active";
}

function toSyncStatus(source: CalendarSource): CalendarSyncStatus {
  return {
    sourceId: source.id,
    state: source.syncState,
    lastSuccessfulRefreshAt: iso(source.lastSuccessfulRefreshAt),
    nextExpectedRefreshAt: iso(source.nextExpectedRefreshAt),
    latestErrorCode: source.lastErrorCode as CalendarValidationErrorCode | undefined,
    latestErrorMessage: source.lastErrorMessage ?? undefined,
    importedCount: source.importedCount,
    skippedCount: source.skippedCount,
  };
}

function errorCode(cause: unknown): CalendarValidationErrorCode {
  if (cause instanceof CalendarSourceUrlError || cause instanceof CalendarFeedError) return cause.code;
  if (cause instanceof Error && cause.message === "malformed_calendar") return "malformed_calendar";
  return "unknown";
}

function importRangeFrom(value: Date) {
  return {
    from: new Date(value.getTime() - IMPORT_LOOKBACK_MS),
    to: new Date(value.getTime() + IMPORT_LOOKAHEAD_MS),
    maxOccurrences: MAX_IMPORTED_OCCURRENCES,
  };
}

export function createExternalCalendarService(options: ExternalCalendarServiceOptions = {}) {
  const now = options.now ?? (() => new Date());
  const autoPlanTask = options.autoPlanTask ?? (() => undefined);

  async function validateSourceUrl(url: string, fetchOptions: CalendarFetchOptions = {}): Promise<ValidateCalendarSourceResponse> {
    try {
      const normalized = normalizeCalendarSourceUrl(url);
      const feed = await fetchCalendarFeed(normalized.url, options.transport, fetchOptions);
      const parsed = parseICalendarFeed(feed);
      return {
        valid: true,
        detectedName: parsed.name,
        eventPreviewCount: parsed.events.length,
        redactedUrlLabel: normalized.redactedUrlLabel,
        warnings: parsed.skippedCount > 0 ? [`${parsed.skippedCount} event(s) could not be imported.`] : [],
      };
    } catch (cause) {
      const code = errorCode(cause);
      return { valid: false, errorCode: code, message: safeCalendarErrorMessage(code) };
    }
  }

  async function refreshSource(workspaceId: string, sourceId: string, fetchOptions: CalendarFetchOptions = {}) {
    const source = await getCalendarSource(workspaceId, sourceId);
    if (!source) throw new Error("calendar_source_not_found");
    const allowBlockedNetwork = Boolean(fetchOptions.allowBlockedNetwork || source.blockedNetworkConfirmedAt);
    if (fetchOptions.allowBlockedNetwork && !source.blockedNetworkConfirmedAt) {
      await updateCalendarSource(workspaceId, sourceId, { blockedNetworkConfirmedAt: now() });
    }

    try {
      const refreshedAt = now();
      await updateCalendarSourceSyncStatus(workspaceId, sourceId, { syncState: "syncing" });
      const feed = await fetchCalendarFeed(source.sourceUrl, options.transport, { allowBlockedNetwork });
      const parsed = parseICalendarFeed(feed, importRangeFrom(refreshedAt));
      const normalizedEvents = normalizeImportedEvents(parsed.events);
      const writes: ImportedCalendarEventWrite[] = normalizedEvents.map((event) => ({
        ...event,
        workspaceId,
        calendarSourceId: sourceId,
      }));

      const replacement = await replaceImportedCalendarEvents(sourceId, writes, {
        policy: source.syncPolicy,
        automationPolicy: source.automationPolicy,
        now: refreshedAt,
      });
      await Promise.all(replacement.automationRequests.map((request) => autoPlanTask(request)));
      const updated = await updateCalendarSourceSyncStatus(workspaceId, sourceId, {
        syncState: parsed.skippedCount > 0 ? "partial" : "success",
        importedCount: replacement.importedCount,
        skippedCount: parsed.skippedCount,
        lastSuccessfulRefreshAt: refreshedAt,
        nextExpectedRefreshAt: new Date(refreshedAt.getTime() + REFRESH_INTERVAL_MS),
        lastErrorCode: null,
        lastErrorMessage: null,
      });
      return { source: toSourceSummary(updated), syncStatus: toSyncStatus(updated) };
    } catch (cause) {
      const code = errorCode(cause);
      const updated = await updateCalendarSourceSyncStatus(workspaceId, sourceId, {
        syncState: "failed",
        lastErrorCode: code,
        lastErrorMessage: safeCalendarErrorMessage(code),
      });
      return { source: toSourceSummary(updated), syncStatus: toSyncStatus(updated) };
    }
  }

  return {
    validateSourceUrl,
    async createSource(workspaceId: string, input: CreateCalendarSourceRequest) {
      let normalized;
      try {
        normalized = normalizeCalendarSourceUrl(input.url);
      } catch (cause) {
        const code = errorCode(cause);
        return { validation: { valid: false as const, errorCode: code, message: safeCalendarErrorMessage(code) } };
      }
      const validation = await validateSourceUrl(normalized.url, { allowBlockedNetwork: input.allowBlockedNetwork });
      if (!validation.valid) return { validation };

      const source = await createCalendarSource({
        workspaceId,
        name: input.name,
        sourceUrl: normalized.url,
        redactedUrlLabel: normalized.redactedUrlLabel,
        color: input.color ?? DEFAULT_SOURCE_COLOR,
        syncPolicy: input.syncPolicy ?? defaultSyncPolicyForUrl(normalized.url),
        automationPolicy: input.automationPolicy ?? "auto_plan",
        blockedNetworkConfirmedAt: input.allowBlockedNetwork ? now() : null,
      });
      return await refreshSource(workspaceId, source.id);
    },
    async listSources(workspaceId: string) {
      return { sources: (await listCalendarSources(workspaceId)).map(toSourceSummary) };
    },
    async updateSource(workspaceId: string, sourceId: string, input: UpdateCalendarSourceRequest) {
      const source = await updateCalendarSource(workspaceId, sourceId, {
        ...(input.name ? { name: input.name } : {}),
        ...(input.color ? { color: input.color } : {}),
        ...(input.syncPolicy ? { syncPolicy: input.syncPolicy } : {}),
        ...(input.automationPolicy ? { automationPolicy: input.automationPolicy } : {}),
        ...(typeof input.enabled === "boolean" ? { lifecycleState: input.enabled ? "active" : "disabled" } : {}),
      });
      return { source: toSourceSummary(source) };
    },
    refreshSource,
    async removeSource(workspaceId: string, sourceId: string) {
      await markCalendarSourceRemoved(workspaceId, sourceId);
      return { removed: true as const, sourceId };
    },
    async listEvents(workspaceId: string, from: Date, to: Date, sourceId?: string) {
      const events = await listImportedCalendarEventsInRange(workspaceId, from, to, sourceId);
      return {
        events: events.map((event): ImportedCalendarEventSummary => ({
          id: event.id,
          calendarSourceId: event.calendarSourceId,
          sourceName: event.calendarSource.name,
          sourceColor: event.calendarSource.color,
          title: event.title,
          startsAt: event.startsAt.toISOString(),
          endsAt: event.endsAt.toISOString(),
          isAllDay: event.isAllDay,
          status: event.status,
          readOnly: true,
        })),
      };
    },
  };
}
