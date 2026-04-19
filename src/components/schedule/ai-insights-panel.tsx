"use client";

import { useState, useMemo } from "react";
import { Bot, Scissors, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { AutomationSuggestionPanel } from "@/components/schedule/automation-suggestion-panel";
import { PreparationChecklist, type PreparationStep } from "@/components/schedule/preparation-checklist";
import { TaskDecompositionPanel } from "@/components/schedule/task-decomposition-panel";
import { useSmartAutomation } from "@/hooks/use-ai";
import type { TaskDecompositionResult } from "@/modules/ai/task-decomposer";
import type { ScheduledItem } from "@/components/schedule/schedule-page-types";

type AiTab = "automation" | "decomposition";

export function AiInsightsPanel({
  item,
  onApplyDecomposition,
}: {
  item: ScheduledItem;
  onApplyDecomposition: (result: TaskDecompositionResult) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<AiTab | null>(null);

  // Automation state — only request when tab is active
  const [automationRequested, setAutomationRequested] = useState(false);
  const { suggestion, isLoading: automationLoading } = useSmartAutomation(
    automationRequested
      ? {
          title: item.title,
          description: item.description ?? undefined,
          priority: item.priority,
          dueAt: item.dueAt,
          scheduledStartAt: item.scheduledStartAt,
          scheduledEndAt: item.scheduledEndAt,
          isRunnable: item.isRunnable,
          runnabilityState: item.runnabilityState,
          ownerType: item.ownerType,
        }
      : null,
  );

  const preparationSteps: PreparationStep[] = useMemo(() => {
    if (!suggestion) return [];
    return suggestion.preparationSteps.map((step, index) => ({
      id: `${item.taskId}-prep-${index}`,
      text: step,
      completed: false,
    }));
  }, [suggestion, item.taskId]);

  function handleTabClick(tab: AiTab) {
    if (activeTab === tab) {
      setActiveTab(null);
      return;
    }
    setActiveTab(tab);
    if (tab === "automation" && !automationRequested) {
      setAutomationRequested(true);
    }
  }

  return (
    <div className="space-y-2">
      {/* Tab buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleTabClick("automation")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition",
            activeTab === "automation"
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border/60 bg-background/50 text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-primary",
          )}
        >
          <Bot className="size-4" />
          <span>AI 建议</span>
          <Sparkles className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => handleTabClick("decomposition")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition",
            activeTab === "decomposition"
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border/60 bg-background/50 text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-primary",
          )}
        >
          <Scissors className="size-4" />
          <span>任务分解</span>
          <Sparkles className="size-3" />
        </button>
      </div>

      {/* Content */}
      {activeTab === "automation" ? (
        <div className="space-y-3">
          <AutomationSuggestionPanel
            suggestion={suggestion}
            isLoading={automationLoading}
          />
          {preparationSteps.length > 0 ? (
            <PreparationChecklist steps={preparationSteps} />
          ) : null}
        </div>
      ) : null}

      {activeTab === "decomposition" ? (
        <TaskDecompositionPanel
          taskId={item.taskId}
          title={item.title}
          description={item.description}
          priority={item.priority}
          dueAt={item.dueAt}
          autoRequest
          onApply={onApplyDecomposition}
        />
      ) : null}
    </div>
  );
}
