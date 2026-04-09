"use client";

import Link from "next/link";
import { startTransition, useEffect, useEffectEvent, useState } from "react";
import {
  approveApproval,
  editAndApproveApproval,
  provideInput,
  rejectApproval,
  retryRun,
} from "@/app/actions/task-actions";
import { ConversationPanel } from "@/components/work/conversation-panel";
import { ExecutionTimeline } from "@/components/work/execution-timeline";
import { RunSidePanel } from "@/components/work/run-side-panel";

type WorkPageClientProps = {
  initialData: {
    taskShell: {
      id: string;
      workspaceId: string;
      title: string;
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
    currentRun:
      | {
          id: string;
          status: string;
          startedAt?: string | null;
          endedAt?: string | null;
          syncStatus?: string | null;
          resumeSupported?: boolean | null;
          pendingInputPrompt?: string | null;
        }
      | null;
    currentIntervention:
      | {
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
          approvals?: Array<{ id: string; title: string; status: string; summary?: string }>;
        }
      | null;
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
    }>;
    conversation: Array<{ id: string; role: string; content: string; runtimeTs?: string | null }>;
    inspector: {
      approvals: Array<{ id: string; title: string; status: string; summary?: string }>;
      artifacts: Array<{ id: string; title: string; type: string; uri?: string | null; createdAt?: string | null }>;
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

type WorkstreamTab = "workstream" | "conversation";

function formatDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "-";
}

function formatDateTime(value: string | null | undefined) {
  return value ? value.slice(0, 16).replace("T", " ") : "-";
}

function getNextActionLabel(status: string | null | undefined) {
  switch (status) {
    case "WaitingForInput":
      return "Provide Input";
    case "WaitingForApproval":
      return "Resolve Approval";
    case "Failed":
      return "Recover Run";
    case "Completed":
      return "Review Result";
    case "Running":
      return "Observe Progress";
    default:
      return "Start Execution";
  }
}

function getComposerDefaultValue(taskTitle: string, currentRun: WorkPageClientProps["initialData"]["currentRun"]) {
  return currentRun?.pendingInputPrompt ?? `Continue work on ${taskTitle}`;
}

function getEvidenceToneClass(tone: "neutral" | "warning" | "critical") {
  if (tone === "critical") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-border bg-background text-muted-foreground";
}

export function WorkPageClient({ initialData }: WorkPageClientProps) {
  const [data, setData] = useState(initialData);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkstreamTab>("workstream");

  const refresh = useEffectEvent(async () => {
    const response = await fetch(`/api/work/${data.taskShell.id}/projection`, { cache: "no-store" });

    if (!response.ok) {
      return;
    }

    const next = (await response.json()) as WorkPageClientProps["initialData"];
    startTransition(() => setData(next));
  });

  const runAction = useEffectEvent(async (action: () => Promise<void>) => {
    try {
      setIsPending(true);
      setErrorMessage(null);
      await action();
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Action failed");
    } finally {
      setIsPending(false);
    }
  });

  useEffect(() => {
    if (!data.currentRun) {
      return;
    }

    const intervalMs = Number(process.env.NEXT_PUBLIC_WORK_POLL_INTERVAL_MS ?? 10000);
    const interval = window.setInterval(() => {
      void refresh();
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [data.currentRun]);

  const currentRun = data.currentRun;
  const canProvideInput = data.currentIntervention?.kind === "input";
  const hasPendingApprovals = data.currentIntervention?.kind === "approval" && (data.currentIntervention.approvals?.length ?? 0) > 0;
  const canRetry = currentRun ? ["Failed", "Cancelled"].includes(currentRun.status) : false;

  async function submitAgentMessage(inputText: string) {
    if (!currentRun) {
      throw new Error("No active run to resume.");
    }

    await runAction(async () => {
      if (currentRun.status === "WaitingForInput") {
        await provideInput({ runId: currentRun.id, inputText });
        return;
      }

      throw new Error("The current run is not waiting for direct operator input.");
    });
  }

  async function handleComposerSubmit(formData: FormData) {
    const inputText = String(formData.get("inputText") ?? "").trim();

    if (!inputText) {
      throw new Error("message is required");
    }

    await submitAgentMessage(inputText);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <section className="sticky top-4 z-10 rounded-2xl border bg-card/95 p-4 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-lg font-semibold">{data.taskShell.title}</h1>
              <p className="text-sm text-muted-foreground">
                Keep this run moving from one focused workbench instead of hopping between logs and controls.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href={`/workspaces/${data.taskShell.workspaceId}/tasks/${data.taskShell.id}`}
                className="inline-flex rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
              >
                Open Task
              </Link>
              <Link
                href="/schedule"
                className="inline-flex rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
              >
                Open Schedule
              </Link>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border px-2 py-1">{data.taskShell.status}</span>
            <span className="rounded-full border px-2 py-1">{data.taskShell.priority}</span>
            <span className="rounded-full border px-2 py-1">Run {currentRun?.status ?? "No run"}</span>
            <span className="rounded-full border px-2 py-1">{data.taskShell.scheduleStatus}</span>
            <span className="rounded-full border px-2 py-1">Due {formatDate(data.taskShell.dueAt)}</span>
          </div>

          <div className="mt-4 grid gap-2 rounded-xl border bg-background p-3 text-sm text-muted-foreground sm:grid-cols-2">
            <div>
              <p className="font-medium text-foreground">Blocked by</p>
              <p>{data.taskShell.blockReason?.actionRequired ?? "No blocking action recorded."}</p>
            </div>
            <div>
              <p className="font-medium text-foreground">Window</p>
              <p>
                {formatDate(data.scheduleImpact.scheduledStartAt)} to {formatDate(data.scheduleImpact.scheduledEndAt)}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">Next Action</h2>
            <p className="text-sm text-muted-foreground">
              {data.currentIntervention?.title ?? getNextActionLabel(currentRun?.status)} — make the next intervention obvious and keep everything else secondary.
            </p>
          </div>

          <div className="mt-3 space-y-3">
            {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}

            {data.currentIntervention ? (
              <div className="rounded-xl border bg-background p-3 text-sm text-muted-foreground">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Why now</p>
                <p className="mt-2">{data.currentIntervention.whyNow}</p>

                {data.currentIntervention.evidence.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Evidence</p>
                    <div className="flex flex-wrap gap-2">
                      {data.currentIntervention.evidence.map((item) => {
                        const content = (
                          <>
                            <span className="font-medium">{item.label}</span>
                            <span className="line-clamp-1">{item.value}</span>
                          </>
                        );

                        if (item.href) {
                          return (
                            <a
                              key={`${item.label}-${item.value}`}
                              href={item.href}
                              className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${getEvidenceToneClass(item.tone)}`}
                            >
                              {content}
                            </a>
                          );
                        }

                        return (
                          <span
                            key={`${item.label}-${item.value}`}
                            className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${getEvidenceToneClass(item.tone)}`}
                          >
                            {content}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {canProvideInput ? (
              <form action={handleComposerSubmit} className="space-y-3">
                <p className="text-sm text-muted-foreground">{data.currentIntervention?.description}</p>
                <label className="grid gap-1 text-sm text-foreground">
                  <span className="font-medium">Agent message</span>
                  <textarea
                    name="inputText"
                    rows={5}
                    required
                    defaultValue={data.currentIntervention?.defaultMessage ?? getComposerDefaultValue(data.taskShell.title, currentRun)}
                    className="rounded-xl border bg-background px-3 py-3 text-sm"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={isPending}
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                  >
                    {currentRun?.status === "WaitingForInput" ? "Send to Agent" : "Resume with Message"}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    Current run: {currentRun?.status ?? "No run"}
                  </p>
                </div>
              </form>
            ) : hasPendingApprovals ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{data.currentIntervention?.description}</p>
                {(data.currentIntervention?.approvals ?? []).map((approval) => (
                  <div key={approval.id} className="rounded-xl border bg-background p-3 text-sm text-muted-foreground">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">{approval.title}</p>
                      <p>{approval.summary ?? "Review the approval request before resuming the run."}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <form
                        action={async () => {
                          await runAction(async () => {
                            await approveApproval(approval.id);
                          });
                        }}
                      >
                        <button type="submit" disabled={isPending} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
                          Approve
                        </button>
                      </form>
                      <form
                        action={async () => {
                          await runAction(async () => {
                            await rejectApproval(approval.id);
                          });
                        }}
                      >
                        <button type="submit" disabled={isPending} className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                          Reject
                        </button>
                      </form>
                      <form
                        action={async (formData) => {
                          await runAction(async () => {
                            await editAndApproveApproval(formData);
                          });
                        }}
                        className="flex flex-wrap gap-2"
                      >
                        <input type="hidden" name="approvalId" value={approval.id} />
                        <input
                          type="text"
                          name="editedContent"
                          placeholder="Edited instruction"
                          className="min-w-48 rounded-md border bg-card px-3 py-2 text-sm"
                        />
                        <button type="submit" disabled={isPending} className="rounded-md border px-3 py-2 text-sm text-foreground disabled:opacity-60">
                          Edit and Approve
                        </button>
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            ) : canRetry ? (
              <form
                action={async (formData) => {
                  const prompt = String(formData.get("prompt") ?? "").trim();
                  if (!prompt) {
                    throw new Error("retry prompt is required");
                  }

                  await runAction(async () => {
                    await retryRun({ taskId: data.taskShell.id, prompt });
                  });
                }}
                className="space-y-3"
              >
                <p className="text-sm text-muted-foreground">{data.currentIntervention?.description}</p>
                <label className="grid gap-1 text-sm text-foreground">
                  <span className="font-medium">Retry prompt</span>
                  <textarea
                    name="prompt"
                    rows={5}
                    required
                    defaultValue={`Retry task: ${data.taskShell.title}`}
                    className="rounded-xl border bg-background px-3 py-3 text-sm"
                  />
                </label>
                <button type="submit" disabled={isPending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
                  Retry Run
                </button>
              </form>
            ) : currentRun?.status === "Running" ? (
              <div className="rounded-xl border bg-background px-3 py-3 text-sm text-muted-foreground">
                {data.currentIntervention?.description}
              </div>
            ) : currentRun?.status === "Completed" ? (
              <div className="rounded-xl border bg-background px-3 py-3 text-sm text-muted-foreground">
                {data.currentIntervention?.description}
              </div>
            ) : (
              <div className="rounded-xl border bg-background px-3 py-3 text-sm text-muted-foreground">
                {currentRun
                  ? data.currentIntervention?.description ?? "The run does not currently require operator input. Review the output and inspector state below."
                  : "Start a run from the task page before sending agent instructions here."}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">Shared Output</h2>
            <p className="text-sm text-muted-foreground">The latest useful result from this run should be visible without digging through logs.</p>
          </div>

          {!data.latestOutput.empty ? (
            <div className="mt-3 rounded-xl border bg-background p-3 text-sm text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border px-2 py-1">{data.latestOutput.sourceLabel}</span>
                {data.currentIntervention && data.currentIntervention.kind !== "observe" ? (
                  <span className="rounded-full border border-primary/30 bg-primary/5 px-2 py-1 text-foreground">Used by next action</span>
                ) : null}
                {data.latestOutput.timestamp ? <span>Updated {formatDateTime(data.latestOutput.timestamp)}</span> : null}
              </div>
              <p className="mt-3 font-medium text-foreground">{data.latestOutput.title}</p>
              <p className="mt-2 whitespace-pre-wrap">{data.latestOutput.body}</p>
              {data.latestOutput.href ? (
                <a href={data.latestOutput.href} className="mt-2 inline-flex text-sm text-primary hover:underline">
                  Open artifact
                </a>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border bg-background px-3 py-3 text-sm text-muted-foreground">
              {data.latestOutput.body}
            </div>
          )}
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">Execution Workstream</h2>
            <p className="text-sm text-muted-foreground">Use the workstream by default, then switch to conversation only when you need deeper narrative evidence.</p>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("workstream")}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                activeTab === "workstream" ? "border-primary bg-primary/5 text-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              Workstream
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("conversation")}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                activeTab === "conversation" ? "border-primary bg-primary/5 text-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              Conversation
            </button>
          </div>

          <div className="mt-4">
            {activeTab === "workstream" ? (
              <ExecutionTimeline title="Latest execution milestones" events={data.workstreamItems} />
            ) : (
              <ConversationPanel
                embedded
                title="Conversation evidence"
                description="Use the conversation view when the workstream summary is not enough."
                entries={data.conversation}
              />
            )}
          </div>
        </section>
      </div>

      <RunSidePanel
        currentRun={currentRun}
        approvals={data.inspector.approvals}
        artifacts={data.inspector.artifacts}
        toolCalls={data.inspector.toolCalls}
      />
    </div>
  );
}
