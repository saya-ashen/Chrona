"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type PlanStep = {
  id: string;
  title: string;
  objective: string;
  phase: string;
  status: "pending" | "in_progress" | "waiting_for_user" | "done" | "blocked";
  needsUserInput: boolean;
  type?: string;
  linkedTaskId?: string | null;
  executionMode?: string | null;
  estimatedMinutes?: number | null;
  priority?: string | null;
};

type PlanEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: string;
};

type TaskPlanGraphProps = {
  plan: {
    state: "empty" | "ready";
    currentStepId: string | null;
    steps: PlanStep[];
    edges?: PlanEdge[];
  };
};

function getNodeTone(step: PlanStep) {
  if (step.executionMode === "child_task" || step.linkedTaskId) return "child-task";
  if (step.needsUserInput || step.status === "waiting_for_user") return "waiting";
  if (step.type === "checkpoint") return "checkpoint";
  if (step.type === "decision") return "decision";
  if (step.type === "deliverable") return "deliverable";
  if (step.type === "tool_action") return "tool-action";
  if (step.status === "done") return "done";
  if (step.status === "blocked") return "blocked";
  if (step.status === "in_progress") return "current";
  return "default";
}

function getNodeClasses(tone: string, current: boolean, selected: boolean) {
  return cn(
    "w-full rounded-2xl border px-3 py-3 text-left shadow-sm transition-colors",
    tone === "child-task" && "border-emerald-300 bg-emerald-50/90",
    tone === "waiting" && "border-amber-300 bg-amber-50/90",
    tone === "checkpoint" && "border-violet-300 bg-violet-50/90",
    tone === "decision" && "border-fuchsia-300 bg-fuchsia-50/90",
    tone === "deliverable" && "border-cyan-300 bg-cyan-50/90",
    tone === "tool-action" && "border-indigo-300 bg-indigo-50/90",
    tone === "done" && "border-slate-300 bg-slate-50/90",
    tone === "blocked" && "border-rose-300 bg-rose-50/90",
    tone === "current" && "border-sky-400 bg-sky-50/90",
    tone === "default" && "border-border/70 bg-background/80",
    current && "ring-2 ring-primary/35",
    selected && "ring-2 ring-foreground/20",
  );
}

function clampClass(lines: 1 | 2) {
  return lines === 1
    ? "overflow-hidden text-ellipsis whitespace-nowrap"
    : "overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]";
}

function getMetaChips(step: PlanStep) {
  const chips: string[] = [];

  const normalizedPhase = step.phase?.trim().toLowerCase() ?? "";
  const normalizedType = step.type?.trim().toLowerCase() ?? "";

  if (step.type && normalizedType !== normalizedPhase) {
    chips.push(step.type);
  }
  if (step.executionMode === "child_task") {
    chips.push("child task");
  }
  if (step.linkedTaskId) {
    chips.push(step.linkedTaskId);
  }
  if (step.priority) {
    chips.push(step.priority);
  }
  if (typeof step.estimatedMinutes === "number") {
    chips.push(`${step.estimatedMinutes}m`);
  }

  return chips;
}


function getStatusLabel(status: PlanStep["status"]) {
  switch (status) {
    case "in_progress":
      return "进行中";
    case "waiting_for_user":
      return "等待用户";
    case "done":
      return "已完成";
    case "blocked":
      return "已阻塞";
    default:
      return "待处理";
  }
}

function getEdgeLabel(type: string) {
  switch (type) {
    case "depends_on":
      return "依赖";
    case "branches_to":
      return "分支";
    case "unblocks":
      return "解锁";
    case "feeds_output":
      return "产出流向";
    default:
      return "顺序";
  }
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-black/5 bg-white/50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  );
}

export function TaskPlanGraph({ plan }: TaskPlanGraphProps) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  const edgesByFrom = useMemo(() => {
    const map = new Map<string, PlanEdge[]>();
    for (const edge of plan.edges ?? []) {
      const list = map.get(edge.fromNodeId) ?? [];
      list.push(edge);
      map.set(edge.fromNodeId, list);
    }
    return map;
  }, [plan.edges]);

  const incomingCountByNodeId = useMemo(() => {
    const map = new Map<string, number>();
    for (const edge of plan.edges ?? []) {
      map.set(edge.toNodeId, (map.get(edge.toNodeId) ?? 0) + 1);
    }
    return map;
  }, [plan.edges]);

  useEffect(() => {
    if (plan.state !== "ready" || plan.steps.length === 0) {
      setSelectedStepId(null);
      return;
    }

    if (selectedStepId && plan.steps.some((step) => step.id === selectedStepId)) {
      return;
    }

    setSelectedStepId(null);
  }, [plan.state, plan.steps, selectedStepId]);

  if (plan.state !== "ready" || plan.steps.length === 0) {
    return null;
  }

  return (
    <div
      aria-label="任务计划图"
      className="space-y-3"
      data-testid="task-plan-graph"
    >
      <div className="space-y-3">
        {plan.steps.map((step) => {
          const tone = getNodeTone(step);
          const current = step.id === plan.currentStepId;
          const selected = step.id === selectedStepId;
          const outgoing = edgesByFrom.get(step.id) ?? [];
          const dependencyCount = incomingCountByNodeId.get(step.id) ?? 0;
          const metaChips = getMetaChips(step);

          return (
            <div key={step.id} className="space-y-2">
              <button
                type="button"
                onClick={() => setSelectedStepId(selected ? null : step.id)}
                data-testid={`task-plan-node-${step.id}`}
                data-node-tone={tone}
                data-node-current={current ? "true" : "false"}
                data-node-selected={selected ? "true" : "false"}
                className={getNodeClasses(tone, current, selected)}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      <span className={clampClass(1)}>{step.phase}</span>
                      {metaChips.map((chip) => (
                        <span
                          key={`${step.id}-${chip}`}
                          className="rounded-full bg-black/5 px-2 py-0.5 normal-case tracking-normal"
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                    <p className={cn("mt-2 text-sm font-semibold text-foreground", clampClass(1))}>{step.title}</p>
                    <p className={cn("mt-1 text-sm text-muted-foreground", selected ? "" : clampClass(2))}>
                      {step.objective}
                    </p>
                  </div>
                  <div className="shrink-0 rounded-full border border-black/5 bg-white/60 px-2 py-1 text-[11px] text-muted-foreground">
                    {getStatusLabel(step.status)}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded-full bg-black/5 px-2 py-1">出边 {outgoing.length}</span>
                  <span className="rounded-full bg-black/5 px-2 py-1">入边 {dependencyCount}</span>
                  {step.needsUserInput ? <span className="rounded-full bg-black/5 px-2 py-1">需要用户输入</span> : null}
                </div>

                {selected ? (
                  <div className="mt-3 space-y-3 border-t border-black/10 pt-3 text-sm">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <DetailItem label="状态" value={getStatusLabel(step.status)} />
                      <DetailItem label="类型" value={step.type ?? "step"} />
                      <DetailItem label="执行方式" value={step.executionMode ?? "none"} />
                      <DetailItem label="优先级" value={step.priority ?? "-"} />
                      <DetailItem
                        label="预计时长"
                        value={typeof step.estimatedMinutes === "number" ? `${step.estimatedMinutes} min` : "-"}
                      />
                      <DetailItem label="关联任务" value={step.linkedTaskId ?? "-"} />
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">详细说明</p>
                      <p className="mt-1 text-sm text-muted-foreground">{step.objective}</p>
                    </div>
                  </div>
                ) : null}
              </button>
              {outgoing.length > 0 ? (
                <div className="space-y-1 pl-4 text-xs text-muted-foreground">
                  {outgoing.map((edge) => (
                    <div key={edge.id} className="flex items-center gap-2">
                      <span className="text-muted-foreground/60">↓</span>
                      <span>{getEdgeLabel(edge.type)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
