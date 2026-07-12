"use client";

import { AlertTriangle, Check, X } from "lucide-react";
import { Card } from "shared/ui/card";
import { Button } from "shared/ui/button";
import { cn } from "@/lib/utils";
import type { TaskWorkspaceUpdateProposal } from "@chrona/contracts/ai";
import { SpecRenderer } from "../../../../../../../features/task-workspace/ui/catalog/spec-renderer";
import { buildTaskWorkspaceDiffPreviewSpec } from "./build-task-workspace-diff-preview-spec";

type EditableTask = {
  title: string;
  description: string | null;
  priority: string;
  dueAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  scheduleStatus: string;
  executionRuntime: string;
  executionConfig: unknown;
};

type Props = {
  proposal: TaskWorkspaceUpdateProposal;
  originalTask: EditableTask;
  onApply: (proposal: TaskWorkspaceUpdateProposal) => void;
  onCancel: () => void;
  isApplying: boolean;
  applyError: string | null;
};

export function TaskWorkspaceDiffPreview({
  proposal,
  originalTask,
  onApply,
  onCancel,
  isApplying,
  applyError,
}: Props) {
  return (
    <Card className="space-y-4">
      <SpecRenderer spec={buildTaskWorkspaceDiffPreviewSpec(proposal, originalTask)} />

      <div className="flex items-center gap-3 pt-2">
        <Button
          type="button"
          onClick={() => onApply(proposal)}
          disabled={isApplying}
          variant="default"
          className={cn(isApplying && "cursor-not-allowed opacity-50")}
        >
          {isApplying ? (
            <>Applying...</>
          ) : proposal.requiresConfirmation ? (
            <>
              <AlertTriangle className="size-4" />
              Accept & Apply
            </>
          ) : (
            <>
              <Check className="size-4" />
              Apply Changes
            </>
          )}
        </Button>

        <Button
          type="button"
          onClick={onCancel}
          disabled={isApplying}
          variant="outline"
        >
          <X className="size-4" />
          Cancel
        </Button>

        {applyError ? (
          <span className="text-sm text-destructive">{applyError}</span>
        ) : null}
      </div>
    </Card>
  );
}
