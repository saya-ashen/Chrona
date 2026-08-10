"use client";

import { useTaskWorkspacePlanSectionRuntime } from "./task-workspace-plan-section-runtime";
import { TaskWorkspacePlanSectionView } from "./task-workspace-plan-section-view";
import type { TaskWorkspacePlanSectionProps } from "./task-workspace-plan-section-contract";
export type { TaskWorkspacePlanSectionProps } from "./task-workspace-plan-section-contract";

export { TaskWorkspacePlanSectionView } from "./task-workspace-plan-section-view";
export { derivePreferredGraphMode, recoveryActionButtonVariant } from "./task-workspace-plan-utils";
export { PlanSetupPanel } from "./task-workspace-plan-setup-panel";

export function TaskWorkspacePlanSection(props: TaskWorkspacePlanSectionProps) {
  const runtime = useTaskWorkspacePlanSectionRuntime(props);
  return <TaskWorkspacePlanSectionView props={props} runtime={runtime} />;
}
