export type AssistantSurfacePageType = "schedule" | "task" | "workbench" | "unsupported";

export type AssistantSurfaceSeverity = "critical" | "warning" | "info" | "success" | "neutral";

export type AssistantQuickActionId =
  | "explain-blocker"
  | "modify-plan"
  | "retry-node"
  | "add-step"
  | "smart-schedule"
  | "find-opening"
  | "explain-unplaced"
  | "handle-conflict"
  | "review-result"
  | "general-help";

export type AssistantQuickActionKind = "informational" | "proposal";

export type AssistantPreviewSurface =
  | "schedule.timeline"
  | "task.config"
  | "task.graph"
  | "workbench.result";

export type AssistantStatusSummary = {
  id: string;
  label: string;
  value: string;
  severity: AssistantSurfaceSeverity;
};

export type AssistantQuickAction = {
  id: AssistantQuickActionId;
  label: string;
  description: string;
  kind: AssistantQuickActionKind;
  enabled: boolean;
  disabledReason?: string;
  previewRequired: boolean;
  previewSurface?: AssistantPreviewSurface;
};

export type AssistantProposalRoute = {
  id: string;
  surface: AssistantPreviewSurface;
  label: string;
  href: string;
  createdAt: string;
};

export type AssistantSurfaceState = {
  pageType: AssistantSurfacePageType;
  fingerprint: string;
  title: string;
  primaryObjectLabel: string;
  status: "ready" | "loading" | "unavailable" | "error" | "empty";
  topSummary: AssistantStatusSummary;
  summaries: AssistantStatusSummary[];
  quickActions: AssistantQuickAction[];
  recentProposals: AssistantProposalRoute[];
  requestInputEnabled: boolean;
  unavailableReason?: string;
};

export type AssistantActionRequest = {
  pageType: AssistantSurfacePageType;
  fingerprint: string;
  actionId: AssistantQuickActionId;
  input?: string;
};

export type AssistantActionResult =
  | {
      kind: "informational";
      message: string;
    }
  | {
      kind: "proposal";
      message: string;
      route: AssistantProposalRoute;
    };
