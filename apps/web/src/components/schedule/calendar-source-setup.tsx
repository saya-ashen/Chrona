"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import type {
  CalendarAutomationPolicy,
  CalendarSourceSummary,
  CalendarSourceSyncPolicy,
  CalendarSyncStatus,
  ValidateCalendarSourceResponse,
} from "@chrona/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  createExternalCalendarSource,
  getExternalCalendarErrorMessage,
  isBlockedNetworkCalendarError,
  validateCalendarSource,
} from "@/lib/external-calendar-client";
import { externalCalendarMessages } from "@/lib/i18n/messages";
import { CalendarSourceList } from "./calendar-source-list";

type ConnectedSource = {
  source: CalendarSourceSummary;
  syncStatus: CalendarSyncStatus;
};

export function CalendarSourceSetup({ workspaceId }: { workspaceId: string }) {
  const [connectedSources, setConnectedSources] = useState<ConnectedSource[]>([]);
  const [isConnectOpen, setIsConnectOpen] = useState(false);

  function handleConnected(created: ConnectedSource) {
    setConnectedSources((current) => [created, ...current.filter((item) => item.source.id !== created.source.id)]);
    window.dispatchEvent(new CustomEvent("chrona:external-calendar-source-created"));
  }

  return (
    <section className="flex flex-col gap-3">
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground" role="heading" aria-level={2}>
            {externalCalendarMessages.setupTitle}
          </h2>
          <Badge variant="outline">{externalCalendarMessages.readOnlyLabel}</Badge>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{externalCalendarMessages.setupDescription}</p>
      </header>

      <Button type="button" size="sm" className="w-full" onClick={() => setIsConnectOpen(true)}>
        <CalendarPlus />
        {externalCalendarMessages.connectAction}
      </Button>

      <CalendarSourceList workspaceId={workspaceId} createdSources={connectedSources} />

      <ConnectCalendarDialog
        workspaceId={workspaceId}
        open={isConnectOpen}
        onOpenChange={setIsConnectOpen}
        onConnected={handleConnected}
      />
    </section>
  );
}

type ConnectCalendarDialogProps = {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: (created: ConnectedSource) => void;
};

function ConnectCalendarDialog({ workspaceId, open, onOpenChange, onConnected }: ConnectCalendarDialogProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState("#2563eb");
  const [syncPolicy, setSyncPolicy] = useState<CalendarSourceSyncPolicy>("auto_complete_past_events");
  const [automationPolicy, setAutomationPolicy] = useState<CalendarAutomationPolicy>("auto_plan");
  const [validation, setValidation] = useState<ValidateCalendarSourceResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [blockedNetworkAction, setBlockedNetworkAction] = useState<"validate" | "connect" | null>(null);

  function reset() {
    setName("");
    setUrl("");
    setColor("#2563eb");
    setSyncPolicy("auto_complete_past_events");
    setAutomationPolicy("auto_plan");
    setValidation(null);
    setErrorMessage(null);
    setBlockedNetworkAction(null);
  }

  async function validateSource(allowBlockedNetwork = false) {
    setErrorMessage(null);
    setValidation(null);
    setIsValidating(true);
    try {
      const result = await validateCalendarSource(workspaceId, url.trim(), allowBlockedNetwork || undefined);
      setValidation(result);
      if (!result.valid && result.errorCode === "blocked_network") setBlockedNetworkAction("validate");
    } catch (error) {
      setErrorMessage(getExternalCalendarErrorMessage(error));
    } finally {
      setIsValidating(false);
    }
  }

  function handleValidate() {
    void validateSource();
  }

  async function submitSource(allowBlockedNetwork = false) {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const created = await createExternalCalendarSource(workspaceId, {
        name: name.trim(),
        url: url.trim(),
        color,
        syncPolicy,
        automationPolicy,
        allowBlockedNetwork: allowBlockedNetwork || undefined,
      });
      if (created.syncStatus) {
        onConnected(created as ConnectedSource);
        reset();
        onOpenChange(false);
      }
    } catch (error) {
      if (isBlockedNetworkCalendarError(error)) setBlockedNetworkAction("connect");
      setErrorMessage(getExternalCalendarErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitSource();
  }

  function handleBlockedNetworkConfirm() {
    const action = blockedNetworkAction;
    setBlockedNetworkAction(null);
    if (action === "validate") void validateSource(true);
    if (action === "connect") void submitSource(true);
  }

  const trimmedUrl = url.trim();
  const canValidate = Boolean(trimmedUrl) && !isValidating && !isSubmitting;
  const canSubmit = Boolean(name.trim()) && Boolean(trimmedUrl) && !isSubmitting;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100vh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-6 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{externalCalendarMessages.connectDialogTitle}</DialogTitle>
            <Badge variant="outline">{externalCalendarMessages.readOnlyLabel}</Badge>
          </div>
          <DialogDescription>{externalCalendarMessages.setupDescription}</DialogDescription>
        </DialogHeader>

        <form className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto px-6 py-5" onSubmit={handleSubmit}>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="calendar-source-name">{externalCalendarMessages.displayNameLabel}</FieldLabel>
              <Input
                id="calendar-source-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={externalCalendarMessages.displayNamePlaceholder}
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="calendar-source-url">{externalCalendarMessages.calendarUrlLabel}</FieldLabel>
              <Input
                id="calendar-source-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={externalCalendarMessages.calendarUrlPlaceholder}
                autoComplete="off"
              />
              <FieldDescription>{externalCalendarMessages.urlPrivacyHint}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="calendar-source-color">{externalCalendarMessages.calendarColorLabel}</FieldLabel>
              <div className="flex items-center gap-3">
                <Input
                  id="calendar-source-color"
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  className="h-10 w-14 shrink-0 cursor-pointer p-1"
                />
                <span className="font-mono text-sm text-muted-foreground">{color.toUpperCase()}</span>
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="calendar-source-sync-policy">{externalCalendarMessages.syncPolicyLabel}</FieldLabel>
              <Select value={syncPolicy} onValueChange={(value) => setSyncPolicy(value as CalendarSourceSyncPolicy)}>
                <SelectTrigger id="calendar-source-sync-policy" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto_complete_past_events">{externalCalendarMessages.syncPolicyAutoComplete}</SelectItem>
                  <SelectItem value="keep_active">{externalCalendarMessages.syncPolicyKeepActive}</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>{externalCalendarMessages.syncPolicyHint}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="calendar-source-automation-policy">{externalCalendarMessages.automationPolicyLabel}</FieldLabel>
              <Select value={automationPolicy} onValueChange={(value) => setAutomationPolicy(value as CalendarAutomationPolicy)}>
                <SelectTrigger id="calendar-source-automation-policy" className="w-full">
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
          </FieldGroup>

          {validation ? <ValidationResult validation={validation} /> : null}
          {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}

          <DialogFooter className="mx-0 mb-0 border-0 bg-transparent p-0">
            <Button type="button" variant="outline" onClick={handleValidate} disabled={!canValidate}>
              {isValidating ? externalCalendarMessages.validateState : "Validate"}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting ? externalCalendarMessages.connectState : externalCalendarMessages.connectAction}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <BlockedNetworkConfirmationDialog
        open={blockedNetworkAction !== null}
        onOpenChange={(next) => setBlockedNetworkAction(next ? blockedNetworkAction : null)}
        onConfirm={handleBlockedNetworkConfirm}
      />
    </Dialog>
  );
}

function BlockedNetworkConfirmationDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{externalCalendarMessages.blockedNetworkTitle}</DialogTitle>
          <DialogDescription>{externalCalendarMessages.blockedNetworkDescription}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {externalCalendarMessages.blockedNetworkCancel}
          </Button>
          <Button type="button" onClick={onConfirm}>
            {externalCalendarMessages.blockedNetworkConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ValidationResult({ validation }: { validation: ValidateCalendarSourceResponse }) {
  if (!validation.valid) {
    return <FieldError>{validation.message}</FieldError>;
  }

  return (
    <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
      <p className="font-medium">{externalCalendarMessages.validatedTitle}</p>
      <p className="mt-1">
        {validation.detectedName ?? "Calendar feed"} has {validation.eventPreviewCount} events from {validation.redactedUrlLabel}.
      </p>
      {validation.warnings.length > 0 ? (
        <ul className="mt-2 list-disc pl-5">
          {validation.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
