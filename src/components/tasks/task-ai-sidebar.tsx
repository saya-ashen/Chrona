"use client";

import { useMemo, useState } from "react";
import { Bot, Sparkles, RotateCcw, Check } from "lucide-react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { TaskDecompositionPanel } from "@/components/schedule/task-planning-panel";
import { TaskPlanGraph } from "@/components/work/task-plan-graph";
import { buttonVariants } from "@/components/ui/button";
import {
  SurfaceCard,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/ui/surface-card";
import { cn } from "@/lib/utils";
import type { TaskPlanGraphResponse } from "@/modules/ai/types";
import { useI18n } from "@/i18n/client";

function getAiSidebarCopy(raw: Record<string, string> | undefined) {
  const s = raw ?? {};
  return {
    cockpitDescription: s.cockpitDescription ?? "Replace sub-tasks with the AI Task Plan graph directly.",
    planAcceptedAndApplied: s.planAcceptedAndApplied ?? "Task plan accepted and applied; new sub-tasks created.",
    acceptingPlan: s.acceptingPlan ?? "Accepting and applying plan…",
    planGenerationFailed: s.planGenerationFailed ?? "Task plan generation failed — please try again later.",
    noSavedFlow: s.noSavedFlow ?? "No saved flows yet",
    savedPlanTitle: s.savedPlanTitle ?? "Current saved plan title and main flow.",
    noPlanYet: s.noPlanYet ?? "No saved AI plan yet.",
    fullTaskPlan: s.fullTaskPlan ?? "Full task plan",
    aiCockpitLabel: s.aiCockpitLabel ?? "AI Task Planning Panel",
    aiCockpitHeading: s.aiCockpitHeading ?? "Let AI produce an actionable task plan",
    aiCockpitDescription: s.aiCockpitDescription ?? "Auto-generates on first visit; after that shows saved plans and lets you re-plan with a prompt.",
    aiPlanningPanel: s.aiPlanningPanel ?? "AI Task Planning Panel",
    aiPlanningDescription: s.aiPlanningDescription ?? "Auto-saves un-accepted plans; after accepting, keeps the current version and re-plans via the button.",
    lastSaved: s.lastSaved ?? "Last saved: ",
    version: s.version ?? "Version: ",
    prompt: s.prompt ?? "Prompt: ",
    planningPromptLabel: s.planningPromptLabel ?? "Planning prompt",
    planningPromptPlaceholder: s.planningPromptPlaceholder ?? "E.g.: prioritize regulatory checks first, then schedule the timeline",
    replan: s.replan ?? "Re-plan",
    acceptedNoAutoRerun: s.acceptedNoAutoRerun ?? "Accepted — will not auto-rerun unless you re-plan",
  };
}

type SavedTaskAiPlanSummary = {
  id: string;
  status: "draft" | "accepted" | "superseded" | "archived";
  prompt: string | null;
  revision?: number;
  summary?: string | null;
  updatedAt: string;
  plan?: {
    id: string;
    taskId: string;
    status: "draft" | "accepted" | "superseded" | "archived";
    revision: number;
    source: "ai" | "user" | "mixed";
    generatedBy: string | null;
    prompt: string | null;
    summary: string | null;
    changeSummary: string | null;
    createdAt: string;
    updatedAt: string;
    nodes: Array<{
      id: string;
      type: string;
      title: string;
      objective: string;
      description: string | null;
      status: "pending" | "in_progress" | "waiting_for_user" | "blocked" | "done" | "skipped";
      phase: string | null;
      estimatedMinutes: number | null;
      priority: string | null;
      executionMode: "automatic" | "manual" | "hybrid";
      linkedTaskId: string | null;
      requiresHumanInput: boolean;
      requiresHumanApproval: boolean;
      autoRunnable: boolean;
      blockingReason: string | null;
    }>;
    edges: Array<{
      id: string;
      fromNodeId: string;
      toNodeId: string;
      type: string;
    }>;
  };
};

function buildCockpitGraph(plan: SavedTaskAiPlanSummary["plan"] | undefined) {
  if (!plan?.nodes?.length) {
    return null;
  }

  return {
    state: "ready" as const,
    revision: typeof plan.revision === "number" ? `r${plan.revision}` : null,
    generatedBy: plan.generatedBy,
    isMock: false,
    summary: plan.summary,
    updatedAt: plan.updatedAt,
    changeSummary: plan.changeSummary,
    currentStepId:
      plan.nodes.find((node) => ["in_progress", "waiting_for_user", "blocked"].includes(node.status))?.id ?? null,
    steps: plan.nodes.map((node) => ({
      id: node.id,
      title: node.title,
      objective: node.objective,
      phase: node.phase ?? node.type,
      status: node.status === "skipped" ? "done" : node.status,
      requiresHumanInput: node.requiresHumanInput || node.status === "waiting_for_user",
      requiresHumanApproval: node.requiresHumanApproval ?? false,
      autoRunnable: node.autoRunnable ?? false,
      type: node.type,
      linkedTaskId: node.linkedTaskId,
      executionMode: node.executionMode,
      estimatedMinutes: node.estimatedMinutes,
      priority: node.priority,
    })),
    edges: plan.edges.map((edge) => ({
      id: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      type: edge.type,
    })),
  };
}

function FlowSummary({ plan }: { plan: SavedTaskAiPlanSummary["plan"] | undefined }) {
  const { messages } = useI18n();
  const copy = getAiSidebarCopy(messages.components?.taskAiSidebar as Record<string, string> | undefined);
  if (!plan?.nodes?.length) {
    return <p className="text-xs text-muted-foreground">{copy.noSavedFlow}</p>;
  }

  const titles = plan.nodes.map((node) => node.title).filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {titles.map((title, index) => (
        <div key={`${title}-${index}`} className="flex items-center gap-2">
          <span className="max-w-[180px] truncate rounded-full border border-border/60 bg-background px-2.5 py-1 text-foreground">
            {title}
          </span>
          {index < titles.length - 1 ? <span className="text-muted-foreground/60">→</span> : null}
        </div>
      ))}
    </div>
  );
}

function CompactPlanSummary({ plan }: { plan: SavedTaskAiPlanSummary | null }) {
  const { messages } = useI18n();
  const copy = getAiSidebarCopy(messages.components?.taskAiSidebar as Record<string, string> | undefined);
  return (
    <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">AI Task Plan</p>
          <p className="mt-1 text-sm text-foreground">
            {plan ? copy.savedPlanTitle : copy.noPlanYet}
          </p>
        </div>
        {plan ? (
          <span className={cn(
            "rounded-full px-2 py-1 text-[11px] font-medium",
            plan.status === "accepted" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700",
          )}>
            {plan.status === "accepted" ? "Accepted" : "Draft"}
          </span>
        ) : null}
      </div>
      {plan ? (
        <>
          <p className="text-sm font-medium text-foreground">{plan.summary ?? copy.fullTaskPlan}</p>
          <FlowSummary plan={plan.plan} />
        </>
      ) : null}
    </div>
  );
}

function TaskCockpitGraphSection({ plan }: { plan: SavedTaskAiPlanSummary | null }) {
  const { messages } = useI18n();
  const copy = getAiSidebarCopy(messages.components?.taskAiSidebar as Record<string, string> | undefined);
  const graph = buildCockpitGraph(plan?.plan);
  if (!graph) {
    return null;
  }

  return (
    <SurfaceCard className="space-y-4">
      <SurfaceCardHeader>
        <SurfaceCardTitle>Task cockpit</SurfaceCardTitle>
        <SurfaceCardDescription>
          {copy.cockpitDescription}
        </SurfaceCardDescription>
      </SurfaceCardHeader>
      <div className="px-6 pb-6">
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/70 p-4">
          <TaskPlanGraph plan={graph} />
        </div>
      </div>
    </SurfaceCard>
  );
}

type TaskAiSidebarTask = {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  dueAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  scheduleStatus: string;
  scheduleSource: string | null;
  isRunnable: boolean;
  runnabilitySummary: string;
  runnabilityState?: string;
  ownerType?: string;
  savedAiPlan?: SavedTaskAiPlanSummary | null;
};

type TaskAiSidebarProps = {
  task: TaskAiSidebarTask;
};

function formatSavedAt(value: string | null | undefined) {
  if (!value) return "";
  return value.replace("T", " ").slice(0, 16);
}

export function TaskAiSidebar({ task }: TaskAiSidebarProps) {
  const { messages } = useI18n();
  const copy = getAiSidebarCopy(messages.components?.taskAiSidebar as Record<string, string> | undefined);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [activePlan, setActivePlan] = useState<SavedTaskAiPlanSummary | null>(task.savedAiPlan ?? null);
  const [planningPrompt, setPlanningPrompt] = useState(task.savedAiPlan?.prompt ?? "");
  const [refreshToken, setRefreshToken] = useState(0);
  const [forceRefresh, setForceRefresh] = useState(task.savedAiPlan === null);
  const [isAccepting, setIsAccepting] = useState(false);

  const accepted = activePlan?.status === "accepted";
  const initialAutoRequest = useMemo(
    () => activePlan === null || forceRefresh,
    [activePlan, forceRefresh],
  );

  async function handleApplyDecomposition(result: TaskPlanGraphResponse) {
    setFeedback(null);
    const response = await fetch("/api/ai/batch-apply-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: task.id,
        replaceExisting: true,
      }),
    });

    if (!response.ok) {
      let message = copy.planGenerationFailed;
      try {
        const data = (await response.json()) as { error?: string };
        if (data.error) {
          message = data.error;
        }
      } catch {
        // ignore json parse failures and keep fallback message
      }
      setFeedback(message);
      return;
    }

    const planId = result.savedPlan?.id ?? activePlan?.id;
    if (planId) {
      try {
        setIsAccepting(true);
        const acceptResponse = await fetch("/api/ai/task-plan/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: task.id, planId }),
        });

        if (acceptResponse.ok) {
          const data = (await acceptResponse.json()) as {
            savedPlan?: SavedTaskAiPlanSummary;
          };
          if (data.savedPlan) {
            setActivePlan(data.savedPlan);
          }
        }
      } finally {
        setIsAccepting(false);
      }
    }

    setForceRefresh(false);
    setFeedback(copy.planAcceptedAndApplied);
  }

  function handlePlanLoaded(meta: SavedTaskAiPlanSummary | null) {
    if (meta) {
      setActivePlan(meta);
    }
    setForceRefresh(false);
  }

  function handleReplan() {
    setFeedback(null);
    setForceRefresh(true);
    setRefreshToken((value) => value + 1);
  }

  return (
    <div className="space-y-4">
      <TaskCockpitGraphSection plan={activePlan} />

      <SurfaceCard className="overflow-hidden border-primary/15 bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.16),_transparent_55%),linear-gradient(180deg,rgba(15,23,42,0.98),rgba(15,23,42,0.9))] text-white shadow-[0_24px_80px_-36px_rgba(79,70,229,0.75)]">
        <div className="space-y-5 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-white/80">
                <Sparkles className="size-3.5" />
                AI cockpit
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-semibold tracking-tight">{copy.aiCockpitHeading}</h2>
                <p className="text-sm leading-6 text-white/70">
                  {copy.aiCockpitDescription}
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-2 text-white/80">
              <Bot className="size-5" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <LocalizedLink
              href={`/workspaces/${task.workspaceId}/work/${task.id}`}
              className={buttonVariants({ variant: "default" })}
            >
              Open Workbench
            </LocalizedLink>
            <LocalizedLink
              href="/schedule"
              className={buttonVariants({ variant: "outline" })}
            >
              Return to Schedule
            </LocalizedLink>
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard className="sticky top-6 space-y-4">
        <SurfaceCardHeader>
          <SurfaceCardTitle>{copy.aiPlanningPanel}</SurfaceCardTitle>
          <SurfaceCardDescription>
            {copy.aiPlanningDescription}
          </SurfaceCardDescription>
        </SurfaceCardHeader>

        <div className="space-y-4 px-6 pb-6">
          {activePlan ? (
            <p className="text-xs text-muted-foreground">
              {copy.lastSaved}{formatSavedAt(activePlan.updatedAt)}
              {typeof activePlan.revision === "number" ? ` · ${copy.version}r${activePlan.revision}` : ""}
              {activePlan.prompt ? ` · ${copy.prompt}${activePlan.prompt}` : ""}
            </p>
          ) : null}

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {copy.planningPromptLabel}
            </label>
            <textarea
              value={planningPrompt}
              onChange={(event) => setPlanningPrompt(event.target.value)}
              placeholder={copy.planningPromptPlaceholder}
              rows={3}
              className="w-full resize-none rounded-xl border border-border/70 bg-background px-3 py-2 text-sm outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {activePlan ? (
              <button
                type="button"
                onClick={handleReplan}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                <RotateCcw className="mr-1 size-4" />
                {copy.replan}
              </button>
            ) : null}
            {accepted ? (
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
                <Check className="mr-1 size-3.5" />
                {copy.acceptedNoAutoRerun}
              </span>
            ) : null}
          </div>

          {activePlan && !forceRefresh ? (
            <CompactPlanSummary plan={activePlan} />
          ) : (
            <TaskDecompositionPanel
              key={`${refreshToken}:${forceRefresh ? "fresh" : activePlan?.id ?? "none"}`}
              taskId={task.id}
              title={task.title}
              description={task.description}
              priority={task.priority}
              dueAt={task.dueAt ? new Date(task.dueAt) : null}
              autoRequest={initialAutoRequest}
              planningPrompt={planningPrompt}
              forceRefresh={forceRefresh}
              onApply={handleApplyDecomposition}
              onPlanLoaded={handlePlanLoaded}
            />
          )}

          {feedback ? (
            <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {isAccepting ? copy.acceptingPlan : feedback}
            </p>
          ) : null}
        </div>
      </SurfaceCard>
    </div>
  );
}
