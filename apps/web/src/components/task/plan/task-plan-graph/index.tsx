"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { X } from "lucide-react";
import { useEdgesState, useNodesState, type NodeMouseHandler } from "@xyflow/react";
import { useI18n } from "@/i18n/client";
import {
  AUTO_FULL_MODE_MIN_WIDTH,
  DEFAULT_GRAPH_COPY,
  MAX_VIEWPORT_HEIGHT,
} from "./constants";
import { buildCompactSections, CompactOutlineNode } from "./compact-view";
import { TaskPlanGraphFrame } from "./frame";
import { useGraphLegend } from "./legend";
import { buildFlowLayout, syncNodeState } from "./layout";
import type { FlowGraphNode, GraphCopy, TaskPlanGraphMode, TaskPlanGraphPlan, TaskPlanGraphProps } from "./types";

export type {
  GraphCopy,
  PlanEdge,
  PlanStep,
  TaskPlanGraphMode,
  TaskPlanGraphPlan,
  TaskPlanGraphProps,
} from "./types";

export function TaskPlanGraph({
  plan,
  mode = "full",
  maxViewportHeight = MAX_VIEWPORT_HEIGHT,
}: TaskPlanGraphProps) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [isFullDialogOpen, setIsFullDialogOpen] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const { messages } = useI18n();
  const graphCopy = useMemo(
    () => ({
      ...DEFAULT_GRAPH_COPY,
      ...(messages.components?.taskPlanGraph ?? {}),
    }) as GraphCopy,
    [messages.components],
  );

  const handleToggleNode = useCallback((nodeId: string) => {
    setSelectedStepId((current) => (current === nodeId ? null : nodeId));
  }, []);

  const allEdges = useMemo(() => plan.edges ?? [], [plan.edges]);
  const layout = useMemo(
    () =>
      buildFlowLayout({
        steps: plan.steps,
        edges: allEdges,
        currentStepId: plan.currentStepId,
        selectedStepId,
        graphCopy,
        onToggle: handleToggleNode,
        maxViewportHeight,
      }),
    [
      allEdges,
      graphCopy,
      handleToggleNode,
      maxViewportHeight,
      plan.currentStepId,
      plan.steps,
      selectedStepId,
    ],
  );

  const [nodes, setNodes] = useNodesState<FlowGraphNode>(layout.nodes);
  const [edges, setEdges] = useEdgesState(layout.edges);
  const { edgeLegend, nodeLegend } = useGraphLegend(graphCopy);
  const compactSections = useMemo(() => buildCompactSections(plan), [plan]);

  const handleNodeClick = useCallback<NodeMouseHandler<FlowGraphNode>>(
    (event, node) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("button[data-testid^='task-plan-node-']")) {
        return;
      }
      handleToggleNode(node.id);
    },
    [handleToggleNode],
  );

  const stopIfNodeButton = useCallback((event: MouseEvent<Element>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button[data-testid^='task-plan-node-']")) {
      event.preventDefault();
    }
  }, []);

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

  useEffect(() => {
    setNodes(layout.nodes);
    setEdges(layout.edges);
  }, [layout.edges, layout.nodes, setEdges, setNodes]);

  useEffect(() => {
    setNodes((current) =>
      syncNodeState(current, {
        currentStepId: plan.currentStepId,
        selectedStepId,
        graphCopy,
        onToggle: handleToggleNode,
      }),
    );
  }, [graphCopy, handleToggleNode, plan.currentStepId, selectedStepId, setNodes]);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;

    const readWidth = (element: HTMLElement | null): number => {
      if (!element) return 0;
      const direct = element.clientWidth || element.getBoundingClientRect().width || 0;
      if (direct > 0) return direct;

      const styled = Number.parseFloat(element.style.width || "0");
      if (Number.isFinite(styled) && styled > 0) return styled;

      return readWidth(element.parentElement);
    };

    const measure = () => {
      const nextWidth = readWidth(node);
      setContainerWidth((current) => (Math.abs(current - nextWidth) < 1 ? current : nextWidth));
    };

    measure();

    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(node);
  }, []);

  const resolvedMode: Exclude<TaskPlanGraphMode, "auto"> =
    mode === "auto" ? (containerWidth >= AUTO_FULL_MODE_MIN_WIDTH ? "full" : "compact") : mode;

  if (plan.state !== "ready" || plan.steps.length === 0) return null;

  if (resolvedMode === "compact") {
    return (
      <>
        <div ref={containerRef} className="w-full">
          <div
            aria-label={graphCopy.ariaLabel}
            className="rounded-[22px] border border-border/50 bg-muted/[0.16] p-3"
            data-graph-editable="false"
            data-graph-interactive="true"
            data-graph-mode="compact"
            data-testid="task-plan-graph"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">紧凑任务图</p>
                <p className="text-xs text-muted-foreground">侧边栏摘要模式，仅保留关键推进关系。</p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-foreground transition hover:bg-muted"
                onClick={() => setIsFullDialogOpen(true)}
              >
                查看完整图
              </button>
            </div>

            <div className="space-y-3 border-l border-border/60 pl-3" data-testid="task-plan-compact-groups">
              {compactSections.groups.map((group) => (
                <section key={group.id} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="h-px flex-1 bg-border/60" />
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{group.title}</p>
                  </div>
                  <div className="space-y-2">
                    {group.steps.map((step) => (
                      <CompactOutlineNode
                        key={step.id}
                        step={step}
                        incomingCount={compactSections.incomingCounts.get(step.id) ?? 0}
                        outgoingCount={compactSections.outgoingCounts.get(step.id) ?? 0}
                        graphCopy={graphCopy}
                        isCurrent={step.id === plan.currentStepId}
                        isSelected={step.id === selectedStepId}
                        onToggle={handleToggleNode}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>

        {isFullDialogOpen ? (
          <>
            <div className="fixed inset-0 z-40 bg-slate-950/35" onClick={() => setIsFullDialogOpen(false)} />
            <section
              role="dialog"
              aria-modal="true"
              aria-label="完整任务计划图"
              className="fixed left-1/2 top-1/2 z-50 flex h-[min(88vh,920px)] w-[min(1180px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[28px] border border-border/60 bg-background shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="flex items-start justify-between gap-4 border-b border-border/60 px-6 py-5">
                <div className="space-y-1">
                  <h1 className="text-lg font-semibold tracking-tight text-foreground">完整任务计划图</h1>
                  <p className="text-sm text-muted-foreground">展示完整的 DAG 关系、语义连线和节点详情。</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsFullDialogOpen(false)}
                  aria-label="关闭完整任务计划图"
                  className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-auto p-5">
                <TaskPlanGraphFrame
                  graphCopy={graphCopy}
                  layout={layout}
                  nodes={nodes}
                  edges={edges}
                  edgeLegend={edgeLegend}
                  nodeLegend={nodeLegend}
                  handleNodeClick={handleNodeClick}
                  handleNodeDragStart={stopIfNodeButton}
                  handleNodeDrag={stopIfNodeButton}
                  handleNodeDragStop={stopIfNodeButton}
                  testId="task-plan-graph-full-dialog"
                />
              </div>
            </section>
          </>
        ) : null}
      </>
    );
  }

  return (
    <div ref={containerRef} className="w-full">
      <TaskPlanGraphFrame
        graphCopy={graphCopy}
        layout={layout}
        nodes={nodes}
        edges={edges}
        edgeLegend={edgeLegend}
        nodeLegend={nodeLegend}
        handleNodeClick={handleNodeClick}
        handleNodeDragStart={stopIfNodeButton}
        handleNodeDrag={stopIfNodeButton}
        handleNodeDragStop={stopIfNodeButton}
      />
    </div>
  );
}
