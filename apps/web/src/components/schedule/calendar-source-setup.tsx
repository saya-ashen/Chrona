"use client";

import { useState } from "react";
import type {
  CalendarSourceSummary,
  CalendarSourceSyncPolicy,
  CalendarSyncStatus,
  ValidateCalendarSourceResponse,
} from "@chrona/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  createExternalCalendarSource,
  getExternalCalendarErrorMessage,
  validateCalendarSource,
} from "@/lib/external-calendar-client";
import { externalCalendarMessages } from "@/lib/i18n/messages";
import { CalendarSourceList } from "./calendar-source-list";

type ConnectedSource = {
  source: CalendarSourceSummary;
  syncStatus: CalendarSyncStatus;
};

export function CalendarSourceSetup({ workspaceId }: { workspaceId: string }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState("#2563eb");
  const [syncPolicy, setSyncPolicy] = useState<CalendarSourceSyncPolicy>("auto_complete_past_events");
  const [validation, setValidation] = useState<ValidateCalendarSourceResponse | null>(null);
  const [connectedSources, setConnectedSources] = useState<ConnectedSource[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleValidate() {
    setErrorMessage(null);
    setValidation(null);
    setIsValidating(true);
    try {
      setValidation(await validateCalendarSource(workspaceId, url.trim()));
    } catch (error) {
      setErrorMessage(getExternalCalendarErrorMessage(error));
    } finally {
      setIsValidating(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const created = await createExternalCalendarSource(workspaceId, {
        name: name.trim(),
        url: url.trim(),
        color,
        syncPolicy,
      });
      if (created.syncStatus) {
        setConnectedSources((current) => [created as ConnectedSource, ...current.filter((item) => item.source.id !== created.source.id)]);
        window.dispatchEvent(new CustomEvent("chrona:external-calendar-source-created"));
      }
      setValidation(null);
    } catch (error) {
      setErrorMessage(getExternalCalendarErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  const trimmedUrl = url.trim();
  const canValidate = Boolean(trimmedUrl) && !isValidating;
  const canSubmit = Boolean(name.trim()) && Boolean(trimmedUrl) && !isSubmitting;

  return (
    <Card className="border-blue-100 bg-blue-50/60 shadow-sm">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle role="heading" aria-level={2}>{externalCalendarMessages.setupTitle}</CardTitle>
          <Badge variant="outline" className="border-blue-200 bg-white/70 text-blue-700">
            {externalCalendarMessages.readOnlyLabel}
          </Badge>
        </div>
        <CardDescription>{externalCalendarMessages.setupDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="calendar-source-name">Display name</FieldLabel>
              <Input
                id="calendar-source-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Team calendar"
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="calendar-source-url">Calendar URL</FieldLabel>
              <Input
                id="calendar-source-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://calendar.example/team.ics"
                autoComplete="off"
              />
              <FieldDescription>Private tokens stay server-side and are redacted from responses.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="calendar-source-color">Calendar color</FieldLabel>
              <Input
                id="calendar-source-color"
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="h-10 w-20 cursor-pointer p-1"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="calendar-source-sync-policy">Sync policy</FieldLabel>
              <Select value={syncPolicy} onValueChange={(value) => setSyncPolicy(value as CalendarSourceSyncPolicy)}>
                <SelectTrigger id="calendar-source-sync-policy" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto_complete_past_events">Complete past events</SelectItem>
                  <SelectItem value="keep_active">Keep events active</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>Google calendar sources use completed past events by default; choose keep active for backlog-style calendars.</FieldDescription>
            </Field>
          </FieldGroup>

          {validation ? <ValidationResult validation={validation} /> : null}
          {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={handleValidate} disabled={!canValidate}>
              {isValidating ? "Validating..." : "Validate"}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting ? "Connecting..." : "Connect calendar"}
            </Button>
          </div>
        </form>

        <CalendarSourceList workspaceId={workspaceId} createdSources={connectedSources} />
      </CardContent>
    </Card>
  );
}

function ValidationResult({ validation }: { validation: ValidateCalendarSourceResponse }) {
  if (!validation.valid) {
    return <FieldError>{validation.message}</FieldError>;
  }

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
      <p className="font-medium">Calendar link validated.</p>
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
