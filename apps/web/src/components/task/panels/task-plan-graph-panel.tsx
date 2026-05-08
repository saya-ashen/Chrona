"use client";

import { useEffect, useRef, useState } from "react";
import { TaskPlanGraph } from "@/components/task/plan/task-plan-graph";
import { SurfaceCard } from "@/components/ui/surface-card";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type TaskPlanGraphPanelProps = {
  label?: string;
  plan: Parameters<typeof TaskPlanGraph>[0]["plan"];
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  maxViewportHeight?: number;
  inspectorPlacement?: Parameters<typeof TaskPlanGraph>[0]["inspectorPlacement"];
  onSelectedNodeChange?: Parameters<typeof TaskPlanGraph>[0]["onSelectedNodeChange"];
  dismissSelectionOnOutsideClick?: Parameters<typeof TaskPlanGraph>[0]["dismissSelectionOnOutsideClick"];
};

export function TaskPlanGraphPanel({
  label = "Task Plan",
  plan,
  description,
  actions,
  className,
  maxViewportHeight,
  inspectorPlacement,
  onSelectedNodeChange,
  dismissSelectionOnOutsideClick,
}: TaskPlanGraphPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [resolvedViewportHeight, setResolvedViewportHeight] = useState<number | undefined>(maxViewportHeight);

  useEffect(() => {
    const panel = panelRef.current;
    const header = headerRef.current;
    if (!panel || !header || typeof ResizeObserver === "undefined") {
      setResolvedViewportHeight(maxViewportHeight);
      return;
    }

    const measure = () => {
      const panelHeight = panel.getBoundingClientRect().height;
      const headerHeight = header.getBoundingClientRect().height;
      if (panelHeight <= 0 || headerHeight <= 0) {
        setResolvedViewportHeight(maxViewportHeight);
        return;
      }

      const nextHeight = Math.floor(panelHeight - headerHeight - 8);
      setResolvedViewportHeight((current) => (current !== undefined && Math.abs(current - nextHeight) < 2 ? current : nextHeight));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    observer.observe(header);
    window.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [maxViewportHeight]);

  return (
    <div ref={panelRef} className={cn("min-w-0 h-full", className)}>
      <SurfaceCard
        as="div"
        variant="inset"
        padding="sm"
        className={cn(
          "flex min-h-0 h-full min-w-0 flex-col rounded-[1.35rem] border-border/50 bg-background/65 shadow-none ring-0",
        )}
      >
        <div ref={headerRef} className="mb-2 flex min-w-0 items-start justify-between gap-3 px-1">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/80">
              {label}
            </p>
            {description ? (
              <div className="mt-1 text-xs text-muted-foreground">{description}</div>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
        <TaskPlanGraph
          plan={plan}
          maxViewportHeight={resolvedViewportHeight ?? maxViewportHeight}
          inspectorPlacement={inspectorPlacement}
          onSelectedNodeChange={onSelectedNodeChange}
          dismissSelectionOnOutsideClick={dismissSelectionOnOutsideClick}
        />
      </SurfaceCard>
    </div>
  );
}
