import type { GoalStatus, GoalSuccessCriterion } from "@chrona/contracts";
import type { GoalProjection } from "@chrona/domain";

export type GoalArtifactData = {
  id: string;
  title: string;
  type: string;
  uri: string;
  contentPreview: string | null;
  createdAt: string;
};

export type GoalTaskData = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  kind: string;
  dueAt: string | null;
  updatedAt: string;
  attention: string | null;
  latestAcceptedResult: {
    runId: string;
    completedAt: string | null;
    artifacts: GoalArtifactData[];
  } | null;
};

export type GoalAssetData = {
  id: string;
  label: string;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  sourceArtifact: GoalArtifactData;
  currentArtifact: GoalArtifactData;
};

export type GoalData = {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  successCriteria: GoalSuccessCriterion[];
  status: GoalStatus;
  nextReviewAt: string | null;
  createdAt: string;
  updatedAt: string;
  achievedAt: string | null;
  stoppedAt: string | null;
  projection: GoalProjection;
  tasks: GoalTaskData[];
  assets: GoalAssetData[];
};

export type GoalCopy = {
  title: string;
  subtitle: string;
  emptyTitle: string;
  emptyDescription: string;
  openGoal: string;
  backToGoals: string;
  outcome: string;
  successCriteria: string;
  progress: string;
  boundedTasks: string;
  acceptedResults: string;
  assets: string;
  nextReview: string;
  noReview: string;
  noTasks: string;
  noAssets: string;
  sourceEvidence: string;
  currentVersion: string;
  pause: string;
  resume: string;
  stop: string;
  achieve: string;
  confirmAchievement: string;
  confirmAchievementDescription: string;
  confirmationLabel: string;
  confirmationPlaceholder: string;
  cancel: string;
  confirming: string;
  actionError: string;
  status: Record<GoalStatus, string>;
  activity: Record<string, string>;
  attention: Record<string, string>;
  nextAction: Record<string, string>;
  criteriaProgress: string;
  taskProgress: string;
  achievedAt: string;
  immutableResult: string;
  openTask: string;
  createFromResult: string;
  createFromResultTitle: string;
  createFromResultDescription: string;
  goalTitleLabel: string;
  goalDescriptionLabel: string;
  goalDescriptionPlaceholder: string;
  criterionLabel: string;
  criterionPlaceholder: string;
  selectedAssets: string;
  selectedAssetsRequired: string;
  proposedFollowUp: string;
  proposedFollowUpDescription: string;
  createAndContinue: string;
  creatingGoal: string;
  promotionError: string;
};
