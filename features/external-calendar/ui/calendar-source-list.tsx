"use client";

import { useEffect, useState } from "react";
import type { CalendarSourceSummary, CalendarSyncStatus } from "../contract";

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
} from "@shared/ui";
import { listExternalCalendarSources } from "./client";
import { externalCalendarMessages } from "@chrona/i18n";
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
  const [managedId, setManagedId] = useState<string | null>(null);
  const [blockedNetworkRefresh, setBlockedNetworkRefresh] = useState<(() => void) | null>(null);

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
    setManagedId(null);
  }

  function confirmBlockedNetworkRefresh(refresh: () => void) {
    setBlockedNetworkRefresh(() => refresh);
  }

  function handleBlockedNetworkConfirm() {
    blockedNetworkRefresh?.();
    setBlockedNetworkRefresh(null);
  }
  const managed = sources.find((item) => item.source.id === managedId) ?? null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" role="heading" aria-level={2}>
          {externalCalendarMessages.connectedTitle}
        </h3>
        {sources.length > 0 ? (
          <span className="text-xs text-muted-foreground">{sources.length}</span>
        ) : null}
      </div>

      {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}

      {sources.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          {externalCalendarMessages.connectedEmpty}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {sources.map(({ source, syncStatus }) => (
            <CalendarSourceRow
              key={source.id}
              source={source}
              syncStatus={syncStatus}
              onManage={() => setManagedId(source.id)}
            />
          ))}
        </ul>
      )}

      <Dialog open={managed !== null} onOpenChange={(open) => { if (!open) setManagedId(null); }}>
        <DialogContent className="max-h-[calc(100vh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-lg">
          {managed ? (
            <>
              <DialogHeader className="border-b px-6 py-4">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: managed.source.color }} />
                  <DialogTitle className="truncate">{managed.source.name}</DialogTitle>
                </div>
                <DialogDescription>{externalCalendarMessages.manageDialogDescription}</DialogDescription>
              </DialogHeader>
              <div className="max-h-[65vh] overflow-y-auto px-6 py-5">
                <SourceMetaGrid source={managed.source} syncStatus={managed.syncStatus} />
                <div className="mt-4 border-t pt-4">
                  <CalendarSourceActions
                    workspaceId={workspaceId}
                    source={managed.source}
                    syncStatus={managed.syncStatus}
                    onBlockedNetworkRefresh={confirmBlockedNetworkRefresh}
                    onSourceChange={updateSource}
                    onSourceRemove={removeSource}
                  />
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={blockedNetworkRefresh !== null} onOpenChange={(open) => { if (!open) setBlockedNetworkRefresh(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{externalCalendarMessages.blockedNetworkTitle}</DialogTitle>
            <DialogDescription>{externalCalendarMessages.blockedNetworkDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBlockedNetworkRefresh(null)}>
              {externalCalendarMessages.blockedNetworkCancel}
            </Button>
            <Button type="button" onClick={handleBlockedNetworkConfirm}>
              {externalCalendarMessages.blockedNetworkConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type CalendarSourceRowProps = {
  source: CalendarSourceSummary;
  syncStatus?: CalendarSyncStatus;
  onManage: () => void;
};

function CalendarSourceRow({ source, syncStatus, onManage }: CalendarSourceRowProps) {
  const isDisabled = source.lifecycleState === "disabled";
  const status = syncStatus?.state ?? (source.lastErrorCode ? "failed" : "idle");
  const hasError = status === "failed";

  return (
    <li>
      <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/95 p-2.5">
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: source.color }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{source.name}</p>
          <p className="truncate text-xs text-muted-foreground">{source.redactedUrlLabel}</p>
        </div>
        {isDisabled ? (
          <Badge variant="outline" className="shrink-0">{externalCalendarMessages.statusDisabled}</Badge>
        ) : hasError ? (
          <Badge variant="destructive" className="shrink-0">{status}</Badge>
        ) : null}
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onManage}>
          {externalCalendarMessages.manageAction}
        </Button>
      </div>
    </li>
  );
}

function SourceMetaGrid({ source, syncStatus }: { source: CalendarSourceSummary; syncStatus?: CalendarSyncStatus }) {
  return (
    <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
      <SourceMeta label={externalCalendarMessages.lastSuccessfulRefresh} value={formatDate(source.lastSuccessfulRefreshAt)} />
      <SourceMeta label={externalCalendarMessages.nextExpectedRefresh} value={formatDate(source.nextExpectedRefreshAt)} />
      <SourceMeta label={externalCalendarMessages.syncPolicyLabel} value={formatSyncPolicy(source.syncPolicy)} />
      <SourceMeta label={externalCalendarMessages.automationPolicyLabel} value={formatAutomationPolicy(source.automationPolicy)} />
      <SourceMeta label={externalCalendarMessages.latestError} value={source.lastErrorMessage ?? syncStatus?.latestErrorMessage ?? "None"} />
      <SourceMeta label={externalCalendarMessages.importedCount} value={syncStatus ? String(syncStatus.importedCount) : "Unknown"} />
    </dl>
  );
}

function formatSyncPolicy(value: CalendarSourceSummary["syncPolicy"]) {
  return value === "auto_complete_past_events"
    ? externalCalendarMessages.syncPolicyAutoComplete
    : externalCalendarMessages.syncPolicyKeepActive;
}

function formatAutomationPolicy(value: CalendarSourceSummary["automationPolicy"]) {
  if (value === "auto_execute") return externalCalendarMessages.automationPolicyAutoExecute;
  if (value === "manual") return externalCalendarMessages.automationPolicyManual;
  return externalCalendarMessages.automationPolicyAutoPlan;
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
