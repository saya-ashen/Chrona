"use client";

import { useCallback, useState } from "react";
import { Bot, Check, Clock, Loader2, Network, Sparkles } from "lucide-react";
import {
  SurfaceCard,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/ui/surface-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { TaskPlanGraph } from "@/components/work/task-plan-graph";

type PlanData = {
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
      status: "pending" | "in_progress" | "waiting_for_user" | "waiting_for_child" | "waiting_for_approval" | "blocked" | "done" | "skipped";
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
} | null;

type Props = {
  plan: PlanData | null;
  taskId: string;
  workspaceId: string;
  aiPlanGenerationStatus?: "idle" | "generating" | "waiting_acceptance" | "accepted";
  copy: Record<string, string>;
  onPlanAccepted?: () => void;
};

function formatDate(iso: string) {
  return iso.replace("T", " ").slice(0, 16);
}

function planStatusTone(status: string) {
  if (status === "accepted") return "success" as const;
  if (status === "draft") return "warning" as const;
  if (status === "superseded") return "neutral" as const;
  return "neutral" as const;
}

function toGraphPlan(plan: NonNullable<PlanData>["plan"]) {
  if (!plan?.nodes?.length) return null;

  const steps = plan.nodes.map((node) => ({
    id: node.id,
    title: node.title,
    objective: node.objective,
    phase: node.phase ?? node.type,
    status: (node.status === "skipped" ? "done" : node.status) as
      | "pending"
      | "in_progress"
      | "waiting_for_user"
      | "done"
      | "blocked",
    requiresHumanInput: node.requiresHumanInput || node.status === "waiting_for_user",
    type: node.type,
    linkedTaskId: node.linkedTaskId,
    executionMode: node.executionMode,
    estimatedMinutes: node.estimatedMinutes,
    priority: node.priority,
  }));

  const currentStepId =
    steps.find((s) => ["in_progress", "waiting_for_user", "blocked"].includes(s.status))?.id ?? null;

  return {
    state: "ready" as const,
    currentStepId,
    steps,
    edges: plan.edges.map((edge) => ({
      id: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      type: edge.type,
    })),
  };
}

function NoPlanCard({ status }: { status?: string }) {
  return (
    <SurfaceCard className="space-y-4" padding="lg">
      <SurfaceCardHeader>
        <SurfaceCardTitle>Plan</SurfaceCardTitle>
        <SurfaceCardDescription>
          {status === "generating"
            ? "An AI plan is being generated for this task."
            : "No plan has been created for this task yet. Use the AI assistant in the sidebar to generate one."}
        </SurfaceCardDescription>
      </SurfaceCardHeader>
      <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/20 p-4">
        {status === "generating" ? (
          <>
            <Loader2 className="size-5 animate-spin text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">Generating plan...</p>
              <p className="text-xs text-muted-foreground">This may take up to a minute.</p>
            </div>
          </>
        ) : (
          <>
            <Network className="size-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">No plan available</p>
              <p className="text-xs text-muted-foreground">
                Ask the AI assistant to create an execution plan for this task.
              </p>
            </div>
          </>
        )}
      </div>
    </SurfaceCard>
  );
}

function PlanMetaCard({ plan }: { plan: NonNullable<PlanData> }) {
  const totalEst = plan.plan?.nodes.reduce((sum, n) => sum + (n.estimatedMinutes ?? 0), 0) ?? 0;
  const doneNodes = plan.plan?.nodes.filter((n) => n.status === "done" || n.status === "skipped").length ?? 0;
  const totalNodes = plan.plan?.nodes.length ?? 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Status</p>
        <div className="mt-2">
          <StatusBadge tone={planStatusTone(plan.status)}>{plan.status}</StatusBadge>
        </div>
      </div>
      <div className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Revision</p>
        <p className="mt-2 text-xl font-semibold">r{plan.revision ?? plan.plan?.revision ?? "-"}</p>
      </div>
      <div className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Progress</p>
        <p className="mt-2 text-xl font-semibold">
          {doneNodes}/{totalNodes}
        </p>
        <p className="text-xs text-muted-foreground">nodes complete</p>
      </div>
      <div className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Estimate</p>
        <p className="mt-2 text-xl font-semibold">{totalEst}m</p>
        <p className="text-xs text-muted-foreground">total estimated</p>
      </div>
    </div>
  );
}

export function TaskPlanPanel({ plan, aiPlanGenerationStatus, copy, taskId, onPlanAccepted }: Props) {
  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const handleAcceptPlan = useCallback(async () => {
    if (!plan?.id) return;
    setIsAccepting(true);
    setAcceptError(null);
    try {
      const res = await fetch("/api/ai/task-plan/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, planId: plan.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to accept plan" }));
        throw new Error((err as { error?: string }).error ?? "Failed to accept plan");
      }
      onPlanAccepted?.();
    } catch (cause) {
      setAcceptError(cause instanceof Error ? cause.message : "Failed to accept plan");
    } finally {
      setIsAccepting(false);
    }
  }, [plan?.id, taskId, onPlanAccepted]);

  if (!plan) {
    return <NoPlanCard status={aiPlanGenerationStatus} />;
  }

  const graphPlan = toGraphPlan(plan.plan);

  return (
    <SurfaceCard className="space-y-4" padding="lg">
      <SurfaceCardHeader>
        <SurfaceCardTitle>{copy.planPanelTitle ?? "Plan"}</SurfaceCardTitle>
        <SurfaceCardDescription>
          {copy.planPanelDescription ?? "Task execution plan with nodes, dependencies, and status."}
          {plan.plan?.summary ? (
            <>
              {" — "}
              <span className="font-medium text-foreground">{plan.plan.summary}</span>
            </>
          ) : null}
        </SurfaceCardDescription>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {plan.plan?.generatedBy ? (
            <span className="inline-flex items-center gap-1">
              <Bot className="size-3" />
              Generated by {plan.plan.generatedBy}
            </span>
          ) : null}
          {plan.plan?.source ? (
            <span className="inline-flex items-center gap-1">
              <Sparkles className="size-3" />
              Source: {plan.plan.source}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" />
            Updated: {formatDate(plan.updatedAt)}
          </span>
        </div>
      </SurfaceCardHeader>

      <PlanMetaCard plan={plan} />

      {aiPlanGenerationStatus === "waiting_acceptance" ? (
        <div className="space-y-2">
          <button
            type="button"
            disabled={isAccepting}
            onClick={handleAcceptPlan}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
          >
            {isAccepting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            {isAccepting ? "Accepting..." : "Accept Plan"}
          </button>
          {acceptError ? (
            <p className="text-xs text-red-600">{acceptError}</p>
          ) : null}
        </div>
      ) : null}

      {plan.plan?.changeSummary ? (
        <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Latest change: </span>
          {plan.plan.changeSummary}
        </div>
      ) : null}

      {graphPlan ? (
        <TaskPlanGraph mode="auto" plan={graphPlan} />
      ) : (
        <p className="text-sm text-muted-foreground">No plan nodes available.</p>
      )}
    </SurfaceCard>
  );
}
