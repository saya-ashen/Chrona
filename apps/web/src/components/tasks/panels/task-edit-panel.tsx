"use client";

import { Card } from "shared/ui/card";
import { cn } from "@/lib/utils"
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
  actions,
  children,
  className,
}: TaskEditPanelProps) {
  return (
    <Card
     
     
      className={cn(
        "overflow-hidden rounded-[1.35rem] border-border/50 bg-background/65 shadow-none",
        className,
      )}
    >
      <div className="space-y-2.5">
        <div className="px-1">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            </div>
            {actions ? <div className="shrink-0">{actions}</div> : null}
          </div>
        </div>
        {children ? <div className="px-1">{children}</div> : null}
      </div>
    </Card>
  );
}
