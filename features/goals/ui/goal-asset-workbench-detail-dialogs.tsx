"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from "@shared/ui";
import {
  createGoalAssetModificationTask,
  createGoalAssetReview,
  createGoalAssetUseTask,
  renameGoalAsset,
  type GoalAssetWorkbenchData,
} from "../workbench-api";
import {
  formatCopy,
  type AssetWorkbenchCopy,
} from "./goal-asset-workbench-shared";

export type AssetDetailActionProps = {
  goalId: string;
  workspaceId: string;
  asset: GoalAssetWorkbenchData;
  current: GoalAssetWorkbenchData["versions"][number] | undefined;
  label: string;
  setLabel: (label: string) => void;
  description: string;
  setDescription: (description: string) => void;
  instruction: string;
  setInstruction: (instruction: string) => void;
  pending: boolean;
  copy: AssetWorkbenchCopy;
  act: (action: () => Promise<unknown>, success: string) => Promise<void>;
};

type DialogProps = Pick<
  AssetDetailActionProps,
  "goalId" | "workspaceId" | "asset" | "current" | "pending" | "copy" | "act"
>;

export function AssetInfoDialog({
  open,
  onOpenChange,
  goalId,
  asset,
  label,
  setLabel,
  description,
  setDescription,
  pending,
  copy,
  act,
}: Pick<
  AssetDetailActionProps,
  | "goalId"
  | "asset"
  | "label"
  | "setLabel"
  | "description"
  | "setDescription"
  | "pending"
  | "copy"
  | "act"
> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const changed =
    label !== asset.label || description !== (asset.description ?? "");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.editAssetInfo}</DialogTitle>
          <DialogDescription>{copy.editAssetInfoDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`asset-title-${asset.id}`}>{copy.titleLabel}</Label>
            <Input
              id={`asset-title-${asset.id}`}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`asset-description-${asset.id}`}>
              {copy.descriptionLabel}
            </Label>
            <Textarea
              id={`asset-description-${asset.id}`}
              value={description}
              maxLength={400}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-28 resize-y"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {copy.cancel}
          </Button>
          <Button
            disabled={!label.trim() || !changed || pending}
            onClick={() =>
              void act(
                () =>
                  renameGoalAsset(goalId, asset.id, label, description || null),
                copy.renamed,
              )
            }
          >
            {copy.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UseTaskDialog({
  open,
  onOpenChange,
  ...props
}: DialogProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { goalId, workspaceId, asset, current, pending, copy, act } = props;
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [expectedOutcome, setExpectedOutcome] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.useTaskTitle}</DialogTitle>
          <DialogDescription>
            {formatCopy(copy.useTaskDescription, {
              asset: asset.label,
              version: current?.version ?? 1,
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`asset-task-title-${asset.id}`}>
              {copy.taskTitleLabel}
            </Label>
            <Input
              id={`asset-task-title-${asset.id}`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`asset-task-instruction-${asset.id}`}>
              {copy.taskInstruction}
            </Label>
            <Textarea
              id={`asset-task-instruction-${asset.id}`}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={copy.taskInstructionPlaceholder}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`asset-task-outcome-${asset.id}`}>
              {copy.expectedOutcomeLabel}
            </Label>
            <Input
              id={`asset-task-outcome-${asset.id}`}
              value={expectedOutcome}
              onChange={(event) => setExpectedOutcome(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {copy.cancel}
          </Button>
          <Button
            disabled={
              !current ||
              !title.trim() ||
              !instruction.trim() ||
              !expectedOutcome.trim() ||
              pending
            }
            onClick={() =>
              current &&
              void act(
                () =>
                  createGoalAssetUseTask(goalId, asset.id, {
                    workspaceId,
                    versionId: current.id,
                    title,
                    instruction,
                    expectedOutcome,
                  }),
                copy.useTaskCreated,
              )
            }
          >
            {copy.createTask}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AiModificationDialog({
  open,
  onOpenChange,
  instruction,
  setInstruction,
  ...props
}: DialogProps &
  Pick<AssetDetailActionProps, "instruction" | "setInstruction"> & {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) {
  const { goalId, workspaceId, asset, current, pending, copy, act } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-ui-surface-kind="runtime-control">
        <DialogHeader>
          <DialogTitle>{copy.modifyWithAi}</DialogTitle>
          <DialogDescription>
            {formatCopy(copy.aiModificationDialogDescription, {
              asset: asset.label,
              version: current?.version ?? 1,
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border border-info/20 bg-info/[0.05] p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-info">
              <Sparkles className="size-4" />
              {copy.currentVersion} · v{current?.version ?? 1}
            </div>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              {copy.aiModificationDescription}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`asset-ai-instruction-${asset.id}`}>
              {copy.modificationRequest}
            </Label>
            <Textarea
              id={`asset-ai-instruction-${asset.id}`}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={copy.modificationPlaceholder}
              className="min-h-28"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {copy.cancel}
          </Button>
          <Button
            disabled={!instruction.trim() || !current || pending}
            onClick={() =>
              current &&
              void act(
                () =>
                  createGoalAssetModificationTask(goalId, asset.id, {
                    workspaceId,
                    versionId: current.id,
                    instruction,
                    expectedOutcome: formatCopy(copy.expectedModifiedOutcome, {
                      asset: asset.label,
                    }),
                  }),
                copy.versionBoundTaskCreated,
              )
            }
          >
            <Sparkles className="size-4" />
            {copy.createAiTask}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FreshnessDialog({
  open,
  onOpenChange,
  ...props
}: DialogProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { goalId, workspaceId, asset, current, pending, copy, act } = props;
  const [summary, setSummary] = useState("");
  const [nextReviewAt, setNextReviewAt] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.recordVerification}</DialogTitle>
          <DialogDescription>
            {copy.recordVerificationDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`asset-review-summary-${asset.id}`}>
              {copy.reviewSummary}
            </Label>
            <Textarea
              id={`asset-review-summary-${asset.id}`}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder={copy.reviewSummaryPlaceholder}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`asset-next-review-${asset.id}`}>
              {copy.nextReview}
            </Label>
            <Input
              id={`asset-next-review-${asset.id}`}
              type="date"
              value={nextReviewAt}
              onChange={(event) => setNextReviewAt(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {copy.cancel}
          </Button>
          <Button
            disabled={!current || !summary.trim() || pending}
            onClick={() =>
              current &&
              void act(
                () =>
                  createGoalAssetReview(goalId, asset.id, {
                    workspaceId,
                    versionId: current.id,
                    verifiedAt: new Date().toISOString(),
                    summary,
                    nextReviewAt: nextReviewAt
                      ? new Date(nextReviewAt).toISOString()
                      : null,
                  }),
                copy.reviewSaved,
              )
            }
          >
            {copy.markVerified}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
