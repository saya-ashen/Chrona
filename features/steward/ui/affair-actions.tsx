import { useRef, useState, type ReactNode } from "react";
import { useI18n } from "@chrona/i18n";
import { Button, Checkbox, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@shared/ui";
import type { StewardClient } from "../model/client";
import type { ScheduleDraft } from "../model/affair-actions";
import { useAddSchedule, useAffairFiles } from "../hooks/use-affair-actions";
import { MutationStatus } from "./resource-status";

type Props = { client: StewardClient; affairId: string; refresh: () => void };
export function AffairFileActions({ client, affairId, path, refresh, children }: Props & { path: string; children?: ReactNode }) {
  const { messages } = useI18n();
  const c = messages.steward.affairActions;
  const { mutation, page, setPage, folder, upload, create } = useAffairFiles(client, affairId, path, refresh);
  const input = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  return <section aria-label={c.files} className="grid min-w-0 gap-2" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!mutation.pending) void upload(Array.from(event.dataTransfer.files)); }}>
    <div className="flex flex-wrap gap-2">
      <Button variant="ghost" aria-expanded={creating} onClick={() => setCreating(!creating)}>{c.newPage}</Button>
      <Button variant="ghost" disabled={mutation.pending} onClick={() => input.current?.click()}>{c.upload}</Button>
      <input ref={input} aria-label={c.upload} type="file" multiple hidden disabled={mutation.pending} onChange={event => { void upload(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    </div>
    {creating && <form className="grid gap-2" onSubmit={event => { event.preventDefault(); void create(); }}>
      <p className="break-all text-sm">{c.folder}: {folder || "/"}</p>
      <Label className="grid gap-2">{c.pagePath}<Input value={page} onChange={event => setPage(event.target.value)} required disabled={mutation.pending} placeholder="notes/page.md" /></Label>
      <Button disabled={mutation.pending}>{messages.steward.affairFile.save}</Button>
    </form>}
    <MutationStatus mutation={mutation} />
    {children}
  </section>;
}
export function AddSchedule({ client, affairId, refresh }: Props) {
  const { messages } = useI18n();
  const c = messages.steward.affairActions;
  const center = messages.steward.affairCenter;
  const { mutation, draft, setDraft, submit } = useAddSchedule(client, affairId, refresh);
  return <details><summary>{center.addSchedule}</summary><form className="mt-3 grid min-w-0 gap-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <Label className="grid gap-2">{center.label}<Input maxLength={80} disabled={mutation.pending} value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} /></Label>
    <Label className="grid gap-2">{c.mode}<Select value={draft.mode} disabled={mutation.pending} onValueChange={value => setDraft({ ...draft, mode: value as ScheduleDraft["mode"] })}><SelectTrigger aria-label={c.mode}><SelectValue /></SelectTrigger><SelectContent>{(["remind", "wake", "job"] as const).map(mode => <SelectItem key={mode} value={mode}>{messages.steward.workspace[mode]}</SelectItem>)}</SelectContent></Select></Label>
    <Label className="grid gap-2">{c.rule}<Select value={draft.kind} disabled={mutation.pending} onValueChange={value => setDraft({ ...draft, kind: value as ScheduleDraft["kind"] })}><SelectTrigger aria-label={c.rule}><SelectValue /></SelectTrigger><SelectContent>{(["at", "daily", "weekly", "every"] as const).map(kind => <SelectItem key={kind} value={kind}>{c[kind]}</SelectItem>)}</SelectContent></Select></Label>
    {draft.kind === "at" ? <Label className="grid gap-2">{c.atLocal}<Input type="datetime-local" required disabled={mutation.pending} value={draft.at} onChange={event => setDraft({ ...draft, at: event.target.value })} /></Label> : draft.kind === "every" ? <Label className="grid gap-2">{c.minutes}<Input type="number" min={5} max={10080} required disabled={mutation.pending} value={draft.minutes} onChange={event => setDraft({ ...draft, minutes: event.target.value })} /></Label> : <Label className="grid gap-2">{c.time}<Input type="time" required disabled={mutation.pending} value={draft.time} onChange={event => setDraft({ ...draft, time: event.target.value })} /></Label>}
    {draft.kind === "weekly" && <fieldset className="grid gap-2"><legend>{c.days}</legend>{c.weekdays.map((day, index) => <Label key={day}><Checkbox disabled={mutation.pending} checked={draft.days.includes(index)} onCheckedChange={checked => setDraft({ ...draft, days: checked ? [...draft.days, index] : draft.days.filter(value => value !== index) })} />{day}</Label>)}</fieldset>}
    <Label className="grid gap-2">{c.text}<Textarea required disabled={mutation.pending} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} /></Label>
    {draft.mode === "job" && <Label className="grid gap-2">{c.command}<Input required disabled={mutation.pending} value={draft.command} onChange={event => setDraft({ ...draft, command: event.target.value })} /></Label>}
    <Button disabled={mutation.pending}>{center.addSchedule}</Button><MutationStatus mutation={mutation} />
  </form></details>;
}
