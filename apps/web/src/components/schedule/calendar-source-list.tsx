"use client";

import { useEffect, useState } from "react";
import type { CalendarSourceSummary, CalendarSyncStatus } from "@chrona/contracts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field";
import { listExternalCalendarSources } from "@/lib/external-calendar-client";
import { externalCalendarMessages } from "@/lib/i18n/messages";
import { CalendarSourceActions } from "./calendar-source-actions";

type CalendarSourceRecord = {
  source: CalendarSourceSummary;
  syncStatus?: CalendarSyncStatus;
};

type CalendarSourceListProps = {
  workspaceId: string;
  createdSources?: CalendarSourceRecord[];
};

const EMPTY_CREATED_SOURCES: CalendarSourceRecord[] = [];

export function CalendarSourceList({ workspaceId, createdSources = EMPTY_CREATED_SOURCES }: CalendarSourceListProps) {
  const [sources, setSources] = useState<CalendarSourceRecord[]>(createdSources);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listExternalCalendarSources(workspaceId)
      .then((result) => {
        if (!cancelled) setSources((current) => mergeSources(result.sources.map((source) => ({ source })), current));
      })
      .catch(() => {
        if (!cancelled) setErrorMessage(externalCalendarMessages.unknownError);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    setSources((current) => mergeSources(createdSources, current));
  }, [createdSources]);

  function updateSource(source: CalendarSourceSummary, syncStatus?: CalendarSyncStatus) {
    setSources((current) => current.map((item) => item.source.id === source.id ? { source, syncStatus: syncStatus ?? item.syncStatus } : item));
  }

  function removeSource(sourceId: string) {
    setSources((current) => current.filter((item) => item.source.id !== sourceId));
  }

  return (
    <Card className="border-slate-200 bg-white/85 shadow-sm">
      <CardHeader className="gap-2">
        <CardTitle role="heading" aria-level={2}>Manage calendar sources</CardTitle>
        <CardDescription>Review sync health, disable imported busy time, refresh, rename, or remove read-only sources.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
        {sources.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-muted-foreground">
            {externalCalendarMessages.connectedEmpty}
          </p>
        ) : (
          sources.map(({ source, syncStatus }) => (
            <article key={source.id} className="space-y-3 rounded-2xl border border-border/70 bg-background/95 p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: source.color }} />
                    <h3 className="truncate font-semibold text-foreground">{source.name}</h3>
                  </div>
                  <p className="break-all text-muted-foreground">{source.redactedUrlLabel}</p>
                </div>
              </div>
              <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <SourceMeta label={externalCalendarMessages.lastSuccessfulRefresh} value={formatDate(source.lastSuccessfulRefreshAt)} />
                <SourceMeta label={externalCalendarMessages.nextExpectedRefresh} value={formatDate(source.nextExpectedRefreshAt)} />
                <SourceMeta label="Sync policy" value={formatSyncPolicy(source.syncPolicy)} />
                <SourceMeta label={externalCalendarMessages.latestError} value={source.lastErrorMessage ?? syncStatus?.latestErrorMessage ?? "None"} />
                <SourceMeta label={externalCalendarMessages.importedCount} value={syncStatus ? String(syncStatus.importedCount) : "Unknown"} />
              </dl>
              <CalendarSourceActions
                workspaceId={workspaceId}
                source={source}
                syncStatus={syncStatus}
                onSourceChange={updateSource}
                onSourceRemove={removeSource}
              />
            </article>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function formatSyncPolicy(value: CalendarSourceSummary["syncPolicy"]) {
  return value === "auto_complete_past_events" ? "Complete past events" : "Keep events active";
}

function mergeSources(incoming: CalendarSourceRecord[], current: CalendarSourceRecord[]) {
  const byId = new Map<string, CalendarSourceRecord>();
  for (const item of current) byId.set(item.source.id, item);
  for (const item of incoming) byId.set(item.source.id, { ...byId.get(item.source.id), ...item, source: item.source });
  return Array.from(byId.values()).sort((a, b) => a.source.name.localeCompare(b.source.name));
}

function formatDate(value?: string) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function SourceMeta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium text-foreground">{label}</dt>
      <dd className="mt-0.5 break-words">{value}</dd>
    </div>
  );
}
