import { db } from "@/lib/db";
import { syncTaskRunForRead } from "@/modules/runtime/openclaw/freshness";

type EvidenceItem = {
  label: string;
  value: string;
  tone: "neutral" | "warning" | "critical";
  href?: string | null;
};

function makeEvidence(item: EvidenceItem) {
  return item;
}

function toIsoString(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function summarizeValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }

  if (value && typeof value === "object") {
    return "details";
  }

  return "-";
}

function summarizePayload(payload: Record<string, unknown>) {
  const entries = Object.entries(payload).slice(0, 3);

  if (entries.length === 0) {
    return "No structured payload recorded.";
  }

  return entries.map(([key, value]) => `${key}: ${summarizeValue(value)}`).join(" · ");
}

function formatEventTitle(eventType: string) {
  return eventType
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function classifyWorkstreamItem(eventType: string) {
  if (/approval/i.test(eventType)) {
    return {
      kind: "approval",
      badge: "Needs approval",
      whyItMatters: "Human approval or review directly affects whether this run can continue.",
      linkedEvidenceLabel: "Linked to Next Action",
    } as const;
  }

  if (/input/i.test(eventType)) {
    return {
      kind: "input",
      badge: "Needs input",
      whyItMatters: "The agent cannot continue until an operator provides guidance.",
      linkedEvidenceLabel: "Linked to Next Action",
    } as const;
  }

  if (/fail|error|blocked|reject/i.test(eventType)) {
    return {
      kind: "failure",
      badge: "Needs recovery",
      whyItMatters: "This event likely explains why the run stalled or needs a retry path.",
      linkedEvidenceLabel: "Recovery evidence",
    } as const;
  }

  if (/complete|finish/i.test(eventType)) {
    return {
      kind: "result",
      badge: "Result",
      whyItMatters: "This milestone helps explain the latest outcome and what follow-up may be needed.",
      linkedEvidenceLabel: "Feeds Shared Output",
    } as const;
  }

  if (/artifact|memory|output/i.test(eventType)) {
    return {
      kind: "output",
      badge: "Output",
      whyItMatters: "This event produced material that can guide the next decision or handoff.",
      linkedEvidenceLabel: "Feeds Shared Output",
    } as const;
  }

  return {
    kind: "progress",
    badge: "Progress",
    whyItMatters: "This shows the latest execution progress without demanding immediate action.",
    linkedEvidenceLabel: null,
  } as const;
}

function buildScheduleImpact(task: {
  scheduleStatus: string;
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
}) {
  return {
    status: task.scheduleStatus,
    dueAt: toIsoString(task.dueAt),
    scheduledStartAt: toIsoString(task.scheduledStartAt),
    scheduledEndAt: toIsoString(task.scheduledEndAt),
    summary:
      task.scheduleStatus === "AtRisk"
        ? "Execution timing is slipping against the planned window."
        : task.scheduleStatus === "Overdue"
          ? "The task is beyond its expected window and needs recovery."
          : "Schedule remains aligned with the current plan.",
  };
}

function readBlockReason(
  task: {
    blockReason: unknown;
    projection:
      | {
          actionRequired: string | null;
          blockType: string | null;
          blockScope: string | null;
          blockSince: Date | null;
        }
      | null;
  },
) {
  return (
    (task.blockReason as {
      actionRequired?: string;
      blockType?: string;
      scope?: string;
      since?: string;
    } | null) ??
    (task.projection
      ? {
          actionRequired: task.projection.actionRequired ?? undefined,
          blockType: task.projection.blockType ?? undefined,
          scope: task.projection.blockScope ?? undefined,
          since: task.projection.blockSince?.toISOString(),
        }
      : null)
  );
}

function buildCurrentIntervention({
  taskTitle,
  currentRun,
  approvals,
  blockReason,
  latestOutput,
  workstreamItems,
  toolCalls,
  scheduleImpact,
}: {
  taskTitle: string;
  currentRun:
    | {
        id: string;
        status: string;
        pendingInputPrompt?: string | null;
      }
    | null;
  approvals: Array<{ id: string; title: string; status: string; summary?: string }>;
  blockReason: ReturnType<typeof readBlockReason>;
  latestOutput: {
    title: string;
    body: string;
    href: string | null;
    empty: boolean;
  };
  workstreamItems: Array<{
    title: string;
    summary: string;
    kind: string;
    whyItMatters: string;
  }>;
  toolCalls: Array<{
    toolName: string;
    status: string;
    errorSummary?: string | null;
    resultSummary?: string | null;
  }>;
  scheduleImpact: {
    status: string;
    summary: string;
  };
}) {
  const latestWorkstreamItem = [...workstreamItems].reverse()[0] ?? null;
  const latestToolIssue = [...toolCalls].reverse().find((tool) => tool.errorSummary || tool.status === "failed") ?? null;
  const sharedEvidence: EvidenceItem[] = [];

  if (!latestOutput.empty) {
    sharedEvidence.push({
      label: "Latest output",
      value: latestOutput.title,
      tone: "neutral",
      href: latestOutput.href,
    });
  }

  if (latestWorkstreamItem) {
    sharedEvidence.push({
      label: "Latest milestone",
      value: latestWorkstreamItem.summary,
      tone: latestWorkstreamItem.kind === "failure" ? "critical" : "neutral",
    });
  }

  if (scheduleImpact.status === "AtRisk" || scheduleImpact.status === "Overdue") {
    sharedEvidence.push({
      label: "Schedule impact",
      value: scheduleImpact.summary,
      tone: scheduleImpact.status === "Overdue" ? "critical" : "warning",
    });
  }

  if (!currentRun) {
    return {
      kind: "idle",
      title: "Start execution",
      description: "No run is active yet. Launch one from the Task Page when the plan is ready.",
      actionLabel: "Open Task",
      whyNow: blockReason?.actionRequired ?? "There is no active run, so execution cannot progress from this page yet.",
      evidence: sharedEvidence,
    } as const;
  }

  switch (currentRun.status) {
    case "WaitingForInput":
      return {
        kind: "input",
        title: "Provide input",
        description: currentRun.pendingInputPrompt ?? blockReason?.actionRequired ?? "The agent is waiting for operator guidance.",
        actionLabel: "Send to Agent",
        defaultMessage: currentRun.pendingInputPrompt ?? `Continue work on ${taskTitle}`,
        whyNow: blockReason?.actionRequired ?? "The run is paused until the operator replies.",
        evidence: [
          makeEvidence({
            label: "Requested guidance",
            value: currentRun.pendingInputPrompt ?? `Continue work on ${taskTitle}`,
            tone: "warning",
          }),
          ...sharedEvidence,
        ].slice(0, 3),
      } as const;
    case "WaitingForApproval":
      return {
        kind: "approval",
        title: "Resolve approval",
        description:
          approvals[0]?.summary ??
          blockReason?.actionRequired ??
          "The run is blocked on an approval decision before it can continue.",
        actionLabel: "Approve / Reject / Edit",
        approvals,
        whyNow: blockReason?.actionRequired ?? "A human decision is required before the next execution step can proceed.",
        evidence: [
          makeEvidence({
            label: "Pending approval",
            value: approvals[0]?.title ?? "Approval request",
            tone: "warning",
          }),
          ...(approvals[0]?.summary
            ? [
                makeEvidence({
                  label: "Approval summary",
                  value: approvals[0].summary,
                  tone: "warning",
                }),
              ]
            : []),
          ...sharedEvidence,
        ].slice(0, 3),
      } as const;
    case "Failed":
    case "Cancelled":
      return {
        kind: "retry",
        title: "Recover run",
        description: blockReason?.actionRequired ?? "The last run stopped before finishing. Retry with a focused recovery prompt.",
        actionLabel: "Retry Run",
        defaultMessage: `Retry task: ${taskTitle}`,
        whyNow: blockReason?.actionRequired ?? "Execution stopped and will not progress until a recovery action is taken.",
        evidence: [
          ...(latestToolIssue
            ? [
                makeEvidence({
                  label: "Latest tool issue",
                  value: latestToolIssue.errorSummary ?? `${latestToolIssue.toolName} ended in ${latestToolIssue.status}`,
                  tone: "critical",
                }),
              ]
            : []),
          ...sharedEvidence,
        ].slice(0, 3),
      } as const;
    case "Completed":
      return {
        kind: "review",
        title: "Review result",
        description: "The run completed. Review the latest output and decide whether follow-up work is needed.",
        actionLabel: "Review Output",
        whyNow: "The latest result is available and should be reviewed before closing or extending the task.",
        evidence: sharedEvidence.slice(0, 3),
      } as const;
    case "Running":
      return {
        kind: "observe",
        title: "Observe progress",
        description: "The run is still active. Watch the newest milestones and intervene only if the state changes.",
        actionLabel: "Watch Workstream",
        whyNow: "The agent is currently executing, so the best next step is to monitor the newest evidence.",
        evidence: sharedEvidence.slice(0, 3),
      } as const;
    default:
      return {
        kind: "idle",
        title: "Check run state",
        description: blockReason?.actionRequired ?? "Review the latest output and inspector state before acting.",
        actionLabel: "Inspect Run",
        whyNow: blockReason?.actionRequired ?? "The run state needs inspection before the next action is clear.",
        evidence: sharedEvidence.slice(0, 3),
      } as const;
  }
}

function buildLatestOutput({
  artifacts,
  conversation,
}: {
  artifacts: Array<{ id: string; title: string; type: string; uri?: string | null; createdAt?: Date | null }>;
  conversation: Array<{ id: string; role: string; content: string; runtimeTs?: Date | null }>;
}) {
  const latestArtifact = artifacts[0];

  if (latestArtifact) {
    return {
      kind: "artifact",
      title: latestArtifact.title,
      body: `Type: ${latestArtifact.type}`,
      timestamp: toIsoString(latestArtifact.createdAt),
      href: latestArtifact.uri ?? null,
      empty: false,
      sourceLabel: `Artifact · ${latestArtifact.type}`,
    } as const;
  }

  const latestAgentOutput = [...conversation].reverse().find((entry) => entry.role !== "user");

  if (latestAgentOutput) {
    return {
      kind: "message",
      title: "Latest agent output",
      body: latestAgentOutput.content,
      timestamp: toIsoString(latestAgentOutput.runtimeTs),
      href: null,
      empty: false,
      sourceLabel: "Conversation output",
    } as const;
  }

  return {
    kind: "empty",
    title: "No mapped output yet",
    body: "The latest artifact or agent result will appear here first.",
    timestamp: null,
    href: null,
    empty: true,
    sourceLabel: "No output source",
  } as const;
}

export async function getWorkPage(taskId: string) {
  await syncTaskRunForRead(taskId);

  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      projection: true,
      events: { orderBy: [{ runtimeTs: "asc" }, { ingestSequence: "asc" }], take: 100 },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          approvals: { where: { status: "Pending" }, orderBy: { requestedAt: "desc" } },
          artifacts: { orderBy: { createdAt: "desc" } },
          conversationEntries: { orderBy: { sequence: "asc" } },
          toolCallDetails: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });

  const currentRun = task.runs[0] ?? null;
  const blockReason = readBlockReason(task);
  const approvals =
    currentRun?.approvals.map((approval) => ({
      id: approval.id,
      title: approval.title,
      status: approval.status,
      summary: approval.summary,
    })) ?? [];
  const conversation =
    currentRun?.conversationEntries.map((entry) => ({
      id: entry.id,
      role: entry.role,
      content: entry.content,
      runtimeTs: toIsoString(entry.runtimeTs),
    })) ?? [];
  const artifacts =
    currentRun?.artifacts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      type: artifact.type,
      uri: artifact.uri,
      createdAt: toIsoString(artifact.createdAt),
    })) ?? [];
  const toolCalls =
    currentRun?.toolCallDetails.map((tool) => ({
      id: tool.id,
      toolName: tool.toolName,
      status: tool.status,
      argumentsSummary: tool.argumentsSummary,
      resultSummary: tool.resultSummary,
      errorSummary: tool.errorSummary,
    })) ?? [];
  const workstreamItems = task.events.map((event) => {
    const eventInfo = classifyWorkstreamItem(event.eventType);

    return {
      id: event.id,
      eventType: event.eventType,
      title: formatEventTitle(event.eventType),
      summary: summarizePayload(event.payload as Record<string, unknown>),
      payload: event.payload as Record<string, unknown>,
      runtimeTs: toIsoString(event.runtimeTs),
      kind: eventInfo.kind,
      badge: eventInfo.badge,
      whyItMatters: eventInfo.whyItMatters,
      linkedEvidenceLabel: eventInfo.linkedEvidenceLabel,
    };
  });
  const serializedRun = currentRun
    ? {
        id: currentRun.id,
        status: currentRun.status,
        startedAt: toIsoString(currentRun.startedAt),
        endedAt: toIsoString(currentRun.endedAt),
        syncStatus: currentRun.syncStatus,
        resumeSupported: currentRun.resumeSupported,
        pendingInputPrompt: currentRun.pendingInputPrompt,
      }
    : null;

  const latestOutput = buildLatestOutput({
    artifacts: currentRun?.artifacts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      type: artifact.type,
      uri: artifact.uri,
      createdAt: artifact.createdAt,
    })) ?? [],
    conversation: currentRun?.conversationEntries.map((entry) => ({
      id: entry.id,
      role: entry.role,
      content: entry.content,
      runtimeTs: entry.runtimeTs,
    })) ?? [],
  });
  const scheduleImpact = buildScheduleImpact(task);

  return {
    taskShell: {
      id: task.id,
      workspaceId: task.workspaceId,
      title: task.title,
      status: task.projection?.displayState ?? task.status,
      priority: task.priority,
      dueAt: toIsoString(task.dueAt),
      scheduledStartAt: toIsoString(task.scheduledStartAt),
      scheduledEndAt: toIsoString(task.scheduledEndAt),
      scheduleStatus: task.scheduleStatus,
      blockReason,
    },
    currentRun: serializedRun,
    currentIntervention: buildCurrentIntervention({
      taskTitle: task.title,
      currentRun: serializedRun,
      approvals,
      blockReason,
      latestOutput,
      workstreamItems,
      toolCalls,
      scheduleImpact,
    }),
    latestOutput,
    scheduleImpact,
    workstreamItems,
    conversation,
    inspector: {
      approvals,
      artifacts,
      toolCalls,
    },
  };
}
