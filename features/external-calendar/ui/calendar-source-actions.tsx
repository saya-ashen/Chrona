"use client";

import { useState } from "react";
import type { CalendarAutomationPolicy, CalendarSourceSummary, CalendarSourceSyncPolicy, CalendarSyncStatus } from "../contract";

import { Badge } from "shared/ui/badge";
import { Button } from "shared/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "shared/ui/select";
import {
  deleteExternalCalendarSource,
  getExternalCalendarErrorMessage,
  isBlockedNetworkCalendarError,
  refreshExternalCalendarSource,
  updateExternalCalendarSource,
} from "./client";
import { externalCalendarMessages } from "@chrona/i18n/external-calendar"

type CalendarSourceActionsProps = {
  workspaceId: string;
  source: CalendarSourceSummary;
  syncStatus?: CalendarSyncStatus;
  onBlockedNetworkRefresh: (refresh: () => void) => void;
  onSourceChange: (source: CalendarSourceSummary, syncStatus?: CalendarSyncStatus) => void;
  onSourceRemove: (sourceId: string) => void;
};

export function CalendarSourceActions({
  workspaceId,
  source,
  syncStatus,
  onBlockedNetworkRefresh,
  onSourceChange,
  onSourceRemove,
}: CalendarSourceActionsProps) {
  const [name, setName] = useState(source.name);
  const [color, setColor] = useState(source.color);
  const [syncPolicy, setSyncPolicy] = useState<CalendarSourceSyncPolicy>(source.syncPolicy);
  const [automationPolicy, setAutomationPolicy] = useState<CalendarAutomationPolicy>(source.automationPolicy);
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
        automationPolicy,
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

  function handleRefresh(allowBlockedNetwork = false) {
    void run("refresh", async () => {
      const refreshed = await refreshExternalCalendarSource(
        workspaceId,
        source.id,
        { allowBlockedNetwork: allowBlockedNetwork || undefined },
      );
      onSourceChange(refreshed.source, refreshed.syncStatus);
    });
  }

  async function handleRefreshClick() {
    setErrorMessage(null);
    setPendingAction("refresh");
    try {
      const refreshed = await refreshExternalCalendarSource(workspaceId, source.id);
      onSourceChange(refreshed.source, refreshed.syncStatus);
      if (refreshed.source.lastErrorCode === "blocked_network" || refreshed.syncStatus?.latestErrorCode === "blocked_network") {
        onBlockedNetworkRefresh(() => handleRefresh(true));
        setErrorMessage(refreshed.source.lastErrorMessage ?? refreshed.syncStatus?.latestErrorMessage ?? externalCalendarMessages.blockedNetwork);
        return;
      }
      window.dispatchEvent(new CustomEvent("chrona:external-calendar-source-created"));
    } catch (error) {
      if (isBlockedNetworkCalendarError(error)) onBlockedNetworkRefresh(() => handleRefresh(true));
      setErrorMessage(getExternalCalendarErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
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
          <div className="flex items-center gap-3">
            <Input
              id={`source-color-${source.id}`}
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="h-10 w-14 shrink-0 cursor-pointer p-1"
            />
            <span className="font-mono text-sm text-muted-foreground">{color.toUpperCase()}</span>
          </div>
        </Field>
      </FieldGroup>

      <Field>
        <FieldLabel htmlFor={`source-sync-policy-${source.id}`}>{externalCalendarMessages.syncPolicyLabel}</FieldLabel>
        <Select value={syncPolicy} onValueChange={(value) => setSyncPolicy(value as CalendarSourceSyncPolicy)} disabled={isPending}>
          <SelectTrigger id={`source-sync-policy-${source.id}`} className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto_complete_past_events">{externalCalendarMessages.syncPolicyAutoComplete}</SelectItem>
            <SelectItem value="keep_active">{externalCalendarMessages.syncPolicyKeepActive}</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field>
        <FieldLabel htmlFor={`source-automation-policy-${source.id}`}>{externalCalendarMessages.automationPolicyLabel}</FieldLabel>
        <Select value={automationPolicy} onValueChange={(value) => setAutomationPolicy(value as CalendarAutomationPolicy)} disabled={isPending}>
          <SelectTrigger id={`source-automation-policy-${source.id}`} className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto_plan">{externalCalendarMessages.automationPolicyAutoPlan}</SelectItem>
            <SelectItem value="auto_execute">{externalCalendarMessages.automationPolicyAutoExecute}</SelectItem>
            <SelectItem value="manual">{externalCalendarMessages.automationPolicyManual}</SelectItem>
          </SelectContent>
        </Select>
        <FieldDescription>{externalCalendarMessages.automationPolicyDescription}</FieldDescription>
      </Field>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button type="button" size="sm" onClick={handleSave} disabled={isPending || !name.trim()}>
          {pendingAction === "save" ? "Saving..." : "Save changes"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void handleRefreshClick()} disabled={isPending}>
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
        <p className="text-sm text-destructive">{externalCalendarMessages.removeConfirmation}</p>
      ) : null}
      {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
    </div>
  );
}
