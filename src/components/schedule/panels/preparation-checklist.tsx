"use client";

import { CheckCircle2, Circle, FileText } from "lucide-react";
import { useState } from "react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { cn } from "@/lib/utils";

export type PreparationStep = {
  id: string;
  text: string;
  completed?: boolean;
  source?: string;
};

export function PreparationChecklist({
  steps,
  title = "Preparation",
  emptyMessage = "No preparation steps identified.",
  onToggle,
}: {
  steps: PreparationStep[];
  title?: string;
  emptyMessage?: string;
  onToggle?: (stepId: string, completed: boolean) => void;
}) {
  const [localSteps, setLocalSteps] = useState(steps);

  function handleToggle(stepId: string) {
    setLocalSteps((current) =>
      current.map((step) =>
        step.id === stepId ? { ...step, completed: !step.completed } : step,
      ),
    );
    const step = localSteps.find((s) => s.id === stepId);
    if (step) {
      onToggle?.(stepId, !step.completed);
    }
  }

  const completedCount = localSteps.filter((s) => s.completed).length;
  const progress = localSteps.length > 0 ? Math.round((completedCount / localSteps.length) * 100) : 0;

  if (localSteps.length === 0) {
    return (
      <SurfaceCard as="div" variant="inset" padding="sm" className="rounded-2xl border-dashed">
        <p className="text-xs text-muted-foreground">{emptyMessage}</p>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard as="div" variant="inset" padding="sm" className="space-y-3 rounded-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-primary" />
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {title}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[10px] font-medium text-muted-foreground">
            {completedCount}/{localSteps.length}
          </span>
        </div>
      </div>

      <ul className="space-y-1.5">
        {localSteps.map((step) => (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => handleToggle(step.id)}
              className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-muted/50"
            >
              {step.completed ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-500" />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm",
                    step.completed
                      ? "text-muted-foreground line-through"
                      : "text-foreground",
                  )}
                >
                  {step.text}
                </p>
                {step.source ? (
                  <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                    Source: {step.source}
                  </p>
                ) : null}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </SurfaceCard>
  );
}
