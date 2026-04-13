type WorkPageData = WorkPageClientProps["initialData"];
type Copy = typeof DEFAULT_COPY;

export type NextActionModel =
  | {
      type: "input";
      title: string;
      description: string;
      whyNow: string;
      evidence: WorkPageData["currentIntervention"]["evidence"];
      fieldLabel: string;
      submitLabel: string;
      defaultValue: string;
      statusHint: string;
    }
  | {
      type: "approval";
      title: string;
      description: string;
      whyNow: string;
      evidence: WorkPageData["currentIntervention"]["evidence"];
      approvals: Array<{
        id: string;
        title: string;
        status: string;
        summary?: string;
      }>;
      noteComposer: {
        fieldLabel: string;
        submitLabel: string;
        defaultValue: string;
        statusHint: string;
        description: string;
      } | null;
    }
  | {
      type: "retry";
      title: string;
      description: string;
      whyNow: string;
      evidence: WorkPageData["currentIntervention"]["evidence"];
      defaultPrompt: string;
    }
  | {
      type: "observe";
      title: string;
      description: string;
      whyNow: string;
      evidence: WorkPageData["currentIntervention"]["evidence"];
      noteComposer: {
        fieldLabel: string;
        submitLabel: string;
        defaultValue: string;
        statusHint: string;
        description: string;
      } | null;
    }
  | {
      type: "review";
      title: string;
      description: string;
      whyNow: string;
      evidence: WorkPageData["currentIntervention"]["evidence"];
    }
  | {
      type: "start";
      title: string;
      description: string;
      whyNow: string;
      evidence: [];
      defaultPrompt: string;
    };

export function deriveNextActionModel(
  data: WorkPageData,
  copy: Copy,
): NextActionModel {
  const run = data.currentRun;
  const intervention = data.currentIntervention;

  if (!run) {
    return {
      type: "start",
      title: intervention?.title ?? "Start execution",
      description: intervention?.description ?? copy.startRunDescription,
      whyNow: intervention?.whyNow ?? "There is no active run yet.",
      evidence: [],
      defaultPrompt:
        data.taskShell.prompt ?? `Continue working on: ${data.taskShell.title}`,
    };
  }

  if (run.status === "WaitingForInput") {
    return {
      type: "input",
      title: intervention?.title ?? "Provide input",
      description:
        intervention?.description ?? copy.responseRequiredDescription,
      whyNow: intervention?.whyNow ?? copy.fallbackNoOperatorInput,
      evidence: intervention?.evidence ?? [],
      fieldLabel: copy.agentMessage,
      submitLabel: copy.sendToAgent,
      defaultValue:
        intervention?.defaultMessage ??
        run.pendingInputPrompt ??
        `Continue work on ${data.taskShell.title}`,
      statusHint: `${copy.currentRun}: ${run.status}`,
    };
  }

  if (run.status === "WaitingForApproval") {
    return {
      type: "approval",
      title: intervention?.title ?? "Resolve approval",
      description: intervention?.description ?? "",
      whyNow: intervention?.whyNow ?? "",
      evidence: intervention?.evidence ?? [],
      approvals: intervention?.approvals ?? [],
      noteComposer: {
        fieldLabel: copy.operatorNote,
        submitLabel: copy.sendNoteToAgent,
        defaultValue: "",
        statusHint: `${copy.currentRun}: ${run.status} · ${copy.noteQueuedForCheckpoint}`,
        description: copy.noteWhileAwaitingApprovalDescription,
      },
    };
  }

  if (run.status === "Running") {
    return {
      type: "observe",
      title: intervention?.title ?? "Observe progress",
      description: intervention?.description ?? "",
      whyNow: intervention?.whyNow ?? "",
      evidence: intervention?.evidence ?? [],
      noteComposer: {
        fieldLabel: copy.operatorNote,
        submitLabel: copy.sendNoteToAgent,
        defaultValue: "",
        statusHint: `${copy.currentRun}: ${run.status} · ${copy.noteQueuedForCheckpoint}`,
        description: copy.noteWhileRunningDescription,
      },
    };
  }

  if (["Failed", "Cancelled"].includes(run.status)) {
    return {
      type: "retry",
      title: intervention?.title ?? "Recover run",
      description: intervention?.description ?? "",
      whyNow: intervention?.whyNow ?? "",
      evidence: intervention?.evidence ?? [],
      defaultPrompt:
        data.taskShell.prompt ?? `Retry task: ${data.taskShell.title}`,
    };
  }

  return {
    type: "review",
    title: intervention?.title ?? "Review result",
    description: intervention?.description ?? "",
    whyNow: intervention?.whyNow ?? "",
    evidence: intervention?.evidence ?? [],
  };
}
