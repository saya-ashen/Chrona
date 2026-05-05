import { DEFAULT_WORK_PAGE_COPY } from "./work-page-copy";

export type WorkPageClientProps = {
  initialData: {
    taskShell: {
      id: string;
      workspaceId: string;
      title: string;
      runtimeModel: string | null;
      prompt: string | null;
      status: string;
      priority: string;
      dueAt: string | null;
      scheduledStartAt: string | null;
      scheduledEndAt: string | null;
      scheduleStatus: string;
      blockReason: {
        actionRequired?: string;
        blockType?: string;
        scope?: string;
        since?: string;
      } | null;
    };
    currentRun: {
      id: string;
      status: string;
      startedAt?: string | null;
      endedAt?: string | null;
      updatedAt?: string | null;
      lastSyncedAt?: string | null;
      syncStatus?: string | null;
      resumeSupported?: boolean | null;
      pendingInputPrompt?: string | null;
      errorSummary?: string | null;
    } | null;
    currentIntervention: {
      kind: "idle" | "input" | "approval" | "retry" | "review" | "observe";
      title: string;
      description: string;
      whyNow: string;
      actionLabel: string;
      defaultMessage?: string;
      evidence: Array<{
        label: string;
        value: string;
        tone: "neutral" | "warning" | "critical";
        href?: string | null;
      }>;
      approvals?: Array<{
        id: string;
        title: string;
        status: string;
        summary?: string;
      }>;
    } | null;
    latestOutput: {
      kind: "artifact" | "message" | "empty";
      title: string;
      body: string;
      timestamp: string | null;
      href: string | null;
      empty: boolean;
      sourceLabel: string;
    };
    scheduleImpact: {
      status: string;
      dueAt: string | null;
      scheduledStartAt: string | null;
      scheduledEndAt: string | null;
      summary: string;
    };
    reliability: {
      refreshedAt: string;
      lastSyncedAt: string | null;
      lastUpdatedAt: string | null;
      syncStatus: string | null;
      isStale: boolean;
      stuckFor: string | null;
      stopReason: string | null;
    };
    closure: {
      resultAccepted: boolean;
      acceptedAt: string | null;
      isDone: boolean;
      doneAt: string | null;
      canAcceptResult: boolean;
      canMarkDone: boolean;
      canCreateFollowUp: boolean;
      canRetry: boolean;
      canReopen: boolean;
      latestFollowUp: {
        id: string;
        title: string;
        status: string;
        scheduleStatus: string;
        createdAt: string | null;
      } | null;
    };
    taskPlan: {
      state: "empty" | "ready";
      revision: string | null;
      generatedBy: string | null;
      isMock: boolean;
      summary: string | null;
      updatedAt: string | null;
      changeSummary: string | null;
      currentStepId: string | null;
      steps: Array<{
        id: string;
        title: string;
        objective: string;
        phase: string;
        status:
          | "pending"
          | "in_progress"
          | "waiting_for_user"
          | "waiting_for_child"
          | "waiting_for_approval"
          | "done"
          | "blocked"
          | "skipped";
        requiresHumanInput: boolean;
        type?: string;
        linkedTaskId?: string | null;
        executionMode?: string | null;
        estimatedMinutes?: number | null;
        priority?: string | null;
      }>;
      edges?: Array<{
        id: string;
        fromNodeId: string;
        toNodeId: string;
        type: string;
      }>;
    };
    workspaceRail?: {
      sections: Array<{
        id: string;
        title: string;
        items: Array<{
          taskId: string;
          title: string;
          statusLabel: string;
          tone: string;
          isCurrent: boolean;
        }>;
      }>;
    };
    workstreamItems: Array<{
      id: string;
      eventType: string;
      title: string;
      summary: string;
      kind: string;
      badge: string;
      whyItMatters: string;
      linkedEvidenceLabel?: string | null;
      payload: Record<string, unknown>;
      runtimeTs?: string | null;
      runId?: string | null;
    }>;
    conversation: Array<{
      id: string;
      role: string;
      content: string;
      runtimeTs?: string | null;
    }>;
    composerValue?: string;
    planExecution?: {
      status:
        | "no_plan"
        | "started"
        | "running"
        | "waiting_for_user"
        | "waiting_for_approval"
        | "blocked"
        | "completed";
      currentNodeId: string | null;
      executedNodeIds: string[];
      waitingNodeIds: string[];
      blockedNodeIds: string[];
      message: string;
    } | null;
    inspector: {
      approvals: Array<{
        id: string;
        title: string;
        status: string;
        summary?: string;
      }>;
      artifacts: Array<{
        id: string;
        title: string;
        type: string;
        uri?: string | null;
        createdAt?: string | null;
      }>;
      toolCalls: Array<{
        id: string;
        toolName: string;
        status: string;
        argumentsSummary?: string | null;
        resultSummary?: string | null;
        errorSummary?: string | null;
      }>;
    };
  };
};

export type WorkbenchComposer = {
  mode: "start" | "response" | "note" | "continue" | "retry";
  description: string;
  inputLabel: string;
  submitLabel: string;
  defaultValue: string;
  placeholder?: string;
  statusHint: string;
  submitVariant?: "default" | "outline" | "secondary";
};

export type WorkbenchCopy = {
  [Key in keyof typeof DEFAULT_WORK_PAGE_COPY]: string;
};
export type WorkPageData = WorkPageClientProps["initialData"];
