"use client";

import { useState } from "react";
import type { CalendarSourceSummary, CalendarSourceSyncPolicy, CalendarSyncStatus } from "@chrona/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  deleteExternalCalendarSource,
  getExternalCalendarErrorMessage,
  refreshExternalCalendarSource,
  updateExternalCalendarSource,
} from "@/lib/external-calendar-client";
import { externalCalendarMessages } from "@/lib/i18n/messages";

type CalendarSourceActionsProps = {
  workspaceId: string;
  source: CalendarSourceSummary;
  syncStatus?: CalendarSyncStatus;
  onSourceChange: (source: CalendarSourceSummary, syncStatus?: CalendarSyncStatus) => void;
  onSourceRemove: (sourceId: string) => void;
};

export function CalendarSourceActions({
  workspaceId,
  source,
  syncStatus,
  onSourceChange,
  onSourceRemove,
}: CalendarSourceActionsProps) {
  const [name, setName] = useState(source.name);
  const [color, setColor] = useState(source.color);
  const [syncPolicy, setSyncPolicy] = useState<CalendarSourceSyncPolicy>(source.syncPolicy);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const isPending = pendingAction !== null;
  const isDisabled = source.lifecycleState === "disabled";
  const status = syncStatus?.state ?? (source.lastErrorCode ? "failed" : "idle");

  async function run(action: string, operation: () => Promise<void>) {
    setErrorMessage(null);
    setPendingAction(action);
    try {
      await operation();
      window.dispatchEvent(new CustomEvent("chrona:external-calendar-source-created"));
    } catch (error) {
      setErrorMessage(getExternalCalendarErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  }

  function handleSave() {
    void run("save", async () => {
      const updated = await updateExternalCalendarSource(workspaceId, source.id, {
        name: name.trim(),
        color,
        syncPolicy,
      });
      onSourceChange(updated.source, updated.syncStatus);
    });
  }

  function handleToggleEnabled() {
    void run("toggle", async () => {
      const updated = await updateExternalCalendarSource(workspaceId, source.id, { enabled: isDisabled });
      onSourceChange(updated.source, updated.syncStatus);
    });
  }

  function handleRefresh() {
    void run("refresh", async () => {
      const refreshed = await refreshExternalCalendarSource(workspaceId, source.id);
      onSourceChange(refreshed.source, refreshed.syncStatus);
    });
  }

  function handleRemove() {
    if (!confirmingRemove) {
      setConfirmingRemove(true);
      return;
    }
    void run("remove", async () => {
      await deleteExternalCalendarSource(workspaceId, source.id);
      onSourceRemove(source.id);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={isDisabled ? "outline" : "secondary"}>
          {isDisabled ? externalCalendarMessages.statusDisabled : externalCalendarMessages.statusActive}
        </Badge>
        <Badge variant={status === "failed" ? "destructive" : status === "partial" ? "outline" : "secondary"}>
          {pendingAction === "refresh" ? "syncing" : status}
        </Badge>
      </div>

      <FieldGroup className="gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Field>
          <FieldLabel htmlFor={`source-name-${source.id}`}>Display name</FieldLabel>
          <Input id={`source-name-${source.id}`} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`source-color-${source.id}`}>Calendar color</FieldLabel>
          <Input
            id={`source-color-${source.id}`}
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="h-10 w-20 cursor-pointer p-1"
          />
        </Field>
      </FieldGroup>

      <Field>
        <FieldLabel htmlFor={`source-sync-policy-${source.id}`}>Sync policy</FieldLabel>
        <Select value={syncPolicy} onValueChange={(value) => setSyncPolicy(value as CalendarSourceSyncPolicy)} disabled={isPending}>
          <SelectTrigger id={`source-sync-policy-${source.id}`} className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto_complete_past_events">Complete past events</SelectItem>
            <SelectItem value="keep_active">Keep events active</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button type="button" size="sm" onClick={handleSave} disabled={isPending || !name.trim()}>
          {pendingAction === "save" ? "Saving..." : "Save changes"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={handleRefresh} disabled={isPending}>
          {pendingAction === "refresh" ? "Refreshing..." : externalCalendarMessages.refreshAction}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={handleToggleEnabled} disabled={isPending}>
          {pendingAction === "toggle"
            ? "Updating..."
            : isDisabled
              ? externalCalendarMessages.enableAction
              : externalCalendarMessages.disableAction}
        </Button>
        <Button type="button" size="sm" variant={confirmingRemove ? "destructive" : "outline"} onClick={handleRemove} disabled={isPending}>
          {pendingAction === "remove" ? "Removing..." : externalCalendarMessages.removeAction}
        </Button>
      </div>

      {confirmingRemove ? (
        <p className="text-sm text-red-700">{externalCalendarMessages.removeConfirmation}</p>
      ) : null}
      {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
    </div>
  );
}
