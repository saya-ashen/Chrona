"use client";

import type {
  GoalCopy,
  GoalData,
} from "../model/goal-types";
import { ReviewApplyDialogContent } from "./goal-workspace-review-apply";
import { AchievementDialogContent } from "./goal-workspace-achievement";

export function ReviewApplyDialog({
  goal,
  copy,
  open,
  onOpenChange,
}: {
  goal: GoalData;
  copy: GoalCopy;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return <ReviewApplyDialogContent goal={goal} copy={copy} open={open} onOpenChange={onOpenChange} />;
}

export function AchievementDialog({
  goal,
  copy,
  open,
  onOpenChange,
}: {
  goal: GoalData;
  copy: GoalCopy;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return <AchievementDialogContent goal={goal} copy={copy} open={open} onOpenChange={onOpenChange} />;
}
