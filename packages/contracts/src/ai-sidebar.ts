export type AiSidebarContextType = "task" | "schedule" | "unsupported";

export type AiSidebarCapabilityId =
  | "explain-blocker"
  | "modify-plan"
  | "retry-node"
  | "add-step"
  | "smart-schedule"
  | "find-opening"
  | "explain-unplaced"
  | "handle-conflict"
  | "general-help";

export type AiSidebarQuickActionKind = "informational" | "mutating-preview";

export type AiSidebarQuickAction = {
  id: AiSidebarCapabilityId;
  label: string;
  description: string;
  kind: AiSidebarQuickActionKind;
  enabled: boolean;
  disabledReason?: string;
};

export type AiSidebarHighlight = {
  label: string;
  value: string;
  tone?: "neutral" | "info" | "success" | "warning" | "critical";
};

export type AiSidebarBaseContextSummary = {
  type: AiSidebarContextType;
  fingerprint: string;
  title: string;
  primaryObjectLabel: string;
  highlights: AiSidebarHighlight[];
  capabilities: AiSidebarCapabilityId[];
  unavailableReasons?: Partial<Record<AiSidebarCapabilityId, string>>;
  primaryAction?: string;
};

export type AiSidebarTaskContextSummary = AiSidebarBaseContextSummary & {
  type: "task";
  taskId: string;
  taskTitle: string;
  activeNodeId?: string | null;
  activeNodeTitle?: string | null;
  nodeState?: string | null;
  blockReason?: string | null;
  reviewState?: string | null;
};

export type AiSidebarScheduleContextSummary = AiSidebarBaseContextSummary & {
  type: "schedule";
  workspaceId: string;
  selectedDate: string;
  unscheduledCount: number;
  freeMinutes: number;
  largestIdleWindowMinutes: number;
  conflictCount: number;
  activeView: string;
};

export type AiSidebarUnsupportedContextSummary = AiSidebarBaseContextSummary & {
  type: "unsupported";
};

export type AiSidebarPageContextSummary =
  | AiSidebarTaskContextSummary
  | AiSidebarScheduleContextSummary
  | AiSidebarUnsupportedContextSummary;

export type AiSidebarMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  content: string;
  status: "complete" | "loading" | "error";
  responseKind: "informational" | "proposal" | "error";
  relatedProposalId?: string;
};

export type AiProposalConfirmability =
  | "confirmable"
  | "stale"
  | "applying"
  | "applied"
  | "failed";

export type TaskChangePreview = {
  taskId: string;
  changeType: "plan-modification" | "retry-node" | "add-step" | "blocker-resolution";
  affectedNodes: string[];
  addedSteps: string[];
  planDiffSummary: string;
  blockerChange?: string;
  requiresReview: boolean;
};

export type ScheduleGhostPlacement = {
  taskId: string;
  title: string;
  startAt: string;
  endAt: string;
  reason: string;
  confidence: number;
};

export type ScheduleGhostBlockPreview = {
  selectedDate: string;
  placements: ScheduleGhostPlacement[];
  unplacedItems: Array<{ taskId: string; title: string; reason: string }>;
  conflictsResolved: string[];
  conflictsRemaining: string[];
};

export type AiProposalPreview = {
  id: string;
  contextFingerprint: string;
  createdAt: string;
  kind: "task" | "schedule" | "informational";
  summary: string;
  affectedAreas: string[];
  riskLevel: "low" | "medium" | "high";
  explanation: string;
  confirmability: AiProposalConfirmability;
  taskPreview: TaskChangePreview | null;
  schedulePreview: ScheduleGhostBlockPreview | null;
};

export type AiSidebarConfirmationDecision = {
  proposalId: string;
  decision: "confirm" | "dismiss" | "refine";
  decidedAt: string;
  resultStatus: "pending" | "applied" | "dismissed" | "failed";
  resultMessage?: string;
};
