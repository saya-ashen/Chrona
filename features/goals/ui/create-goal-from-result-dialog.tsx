"use client";

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { localizeHref, useLocale } from "@chrona/i18n";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from "@shared/ui";
import type { GoalCopy } from "../model/goal-types";
import { promoteTaskToGoal } from "../browser-api";

type AcceptedArtifact = { id: string; title: string; type: string };

type Props = {
  taskId: string;
  workspaceId: string;
  acceptedRunId: string;
  taskTitle: string;
  taskDescription: string | null;
  artifacts: AcceptedArtifact[];
  copy: GoalCopy;
};

function promotionKey(taskId: string, acceptedRunId: string) {
  return `promote-${taskId}-${acceptedRunId}`;
}

export function CreateGoalFromResultDialog({
  taskId,
  workspaceId,
  acceptedRunId,
  taskTitle,
  taskDescription,
  artifacts,
  copy,
}: Props) {
  const navigate = useNavigate();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const title = taskTitle;
  const description = taskDescription ?? "";
  const criterion = `Confirm the durable outcome from ${taskTitle}`;
  const [selectedArtifactIds, setSelectedArtifactIds] = useState(() => artifacts.map((artifact) => artifact.id));
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(() => new Set(selectedArtifactIds), [selectedArtifactIds]);
  const canSubmit = selectedArtifactIds.length > 0 && !isPending;

  function toggleArtifact(artifactId: string, checked: boolean) {
    setSelectedArtifactIds((current) => checked
      ? Array.from(new Set([...current, artifactId]))
      : current.filter((id) => id !== artifactId));
  }

  async function submit() {
    if (!canSubmit) return;
    setIsPending(true);
    setError(null);
    try {
      const goal = await promoteTaskToGoal(taskId, {
        workspaceId,
        acceptedRunId,
        artifactIds: selectedArtifactIds,
        title: title.trim(),
        description: description.trim() || null,
        successCriteria: [{
          id: "outcome-confirmed",
          kind: "user_confirmed",
          description: criterion.trim(),
          satisfied: false,
          confirmedAt: null,
          proposalStatus: "proposed",
        }],
        idempotencyKey: promotionKey(taskId, acceptedRunId),
      });
      navigate(localizeHref(locale, `/goals/${goal.id}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.promotionError);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isPending) { setOpen(next); setError(null); } }}>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {copy.createFromResult}
      </Button>
      <DialogContent className="max-h-[min(90dvh,48rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{copy.createFromResultTitle}</DialogTitle>
          <DialogDescription>{copy.createFromResultDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 py-1">
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium text-foreground">{copy.selectedAssets}</legend>
            {artifacts.map((artifact) => (
              <Label key={artifact.id} className="flex min-w-0 items-start gap-3 rounded-xl border border-border/70 p-3 font-normal">
                <Checkbox checked={selected.has(artifact.id)} onCheckedChange={(checked) => toggleArtifact(artifact.id, checked === true)} disabled={isPending} />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{artifact.title}</span>
                  <span className="block text-xs text-muted-foreground">{artifact.type}</span>
                </span>
              </Label>
            ))}
            {selectedArtifactIds.length === 0 ? <p className="text-xs font-medium text-destructive">{copy.selectedAssetsRequired}</p> : null}
          </fieldset>
          <div className="rounded-xl border border-border/70 bg-muted/45 p-3 text-sm">
            <p className="font-medium text-foreground">{copy.proposedFollowUp}</p>
            <p className="mt-1 leading-6 text-muted-foreground">{copy.proposedFollowUpDescription}</p>
          </div>
          {error ? <p role="alert" className="text-sm font-medium text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>{copy.cancel}</Button>
          <Button type="button" onClick={() => void submit()} disabled={!canSubmit}>{isPending ? copy.creatingGoal : copy.createAndContinue}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
