"use client";

import { SurfaceCard } from "@/components/ui/surface-card";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type TaskEditPanelProps = {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function TaskEditPanel({
  title = "Edit task",
  description = "Keep edits here. Use the AI panel only for planning.",
  actions,
  children,
  className,
}: TaskEditPanelProps) {
  return (
    <SurfaceCard
      as="div"
      variant="inset"
      padding="sm"
      className={cn(
        "overflow-hidden rounded-[1.35rem] border-border/50 bg-background/65 shadow-none",
        className,
      )}
    >
      <div className="space-y-2.5">
        <div className="px-1">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
              <div className="text-xs text-muted-foreground">{description}</div>
            </div>
            {actions ? <div className="shrink-0">{actions}</div> : null}
          </div>
        </div>
        {children ? <div className="px-1">{children}</div> : null}
      </div>
    </SurfaceCard>
  );
}
