import { Sparkles } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

type TaskPlanEmptyStateProps = {
  onGenerate: () => void;
};

export function TaskPlanEmptyState({ onGenerate }: TaskPlanEmptyStateProps) {
  return (
    <div className="space-y-3 rounded-xl border border-transparent bg-transparent p-0">
      <div className="flex items-center justify-end gap-3">
        <span className="sr-only">AI Task Planning</span>
        <button
          type="button"
          onClick={onGenerate}
          className={buttonVariants({
            variant: "soft",
            size: "sm",
            className: "rounded-full",
          })}
        >
          <Sparkles className="size-3.5" />
          Generate plan
        </button>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border/60 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.08),transparent_42%),hsl(var(--background)/0.78)] px-3 py-3 text-sm text-muted-foreground">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground ring-1 ring-border/60">
          <Sparkles className="size-4" />
        </span>
        <span className="font-medium text-foreground">No plan yet</span>
      </div>
    </div>
  );
}
