"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n, useLocale } from "@chrona/i18n/react";
import { localizeHref } from "@chrona/i18n";
import { Button } from "shared/ui/button";
import { apiJson } from "shared/http/api-client";
import { useAppRouter } from "@/lib/router";
import { listenAiClientsChanged } from "@/lib/ai-client-events";

type AiClientSummary = {
  enabled?: boolean;
};

type AiClientsResponse = {
  clients?: AiClientSummary[];
};

type TasksResponse = {
  tasks?: Array<{ id?: unknown }>;
  total?: number;
};

type TaskPresence = {
  hasTask: boolean;
  taskId: string | null;
};

const EMPTY_TASK_PRESENCE: TaskPresence = { hasTask: false, taskId: null };

function taskPresence(payload: TasksResponse): TaskPresence {
  const taskId = payload.tasks?.find((task) => typeof task.id === "string")?.id;
  return {
    hasTask: Boolean((payload.total ?? 0) > 0 || taskId),
    taskId: typeof taskId === "string" ? taskId : null,
  };
}

function tasksPath(workspaceId: string) {
  const params = new URLSearchParams({ workspaceId, pageSize: "1", sort: "updatedAt", order: "desc" });
  return `/api/tasks?${params.toString()}`;
}

type StartWithChronaProps = {
  className?: string;
  createdTaskId?: string | null;
  workspaceId?: string;
  isComplete?: boolean;
  onCreateTask?: () => void;
  onCreateSafeDemo?: () => void;
  onOpenCreatedTask?: (taskId: string) => void;
};

type OnboardingStep = {
  title: string;
  description: string;
  state: "done" | "current" | "next";
};

function hasEnabledClient(clients: AiClientsResponse["clients"]): boolean {
  return Array.isArray(clients) && clients.some((client) => client.enabled !== false);
}

function stepState(
  stepIndex: number,
  state: { hasClients: boolean; hasCreatedTask: boolean; isComplete: boolean },
): OnboardingStep["state"] {
  if (state.isComplete) return "done";
  if (stepIndex === 0) return state.hasClients ? "done" : "current";
  if (stepIndex === 1) {
    if (!state.hasClients) return "next";
    return state.hasCreatedTask ? "done" : "current";
  }
  return state.hasCreatedTask ? "current" : "next";
}

function stepClasses(state: OnboardingStep["state"]): string {
  if (state === "done") return "border-primary/35 bg-background text-foreground";
  if (state === "current") return "border-primary/50 bg-primary/10 text-foreground";
  return "border-border/70 bg-background/70 text-muted-foreground";
}

function stepBadgeClasses(state: OnboardingStep["state"]): string {
  if (state === "done") return "bg-primary text-primary-foreground";
  if (state === "current") return "bg-foreground text-background";
  return "bg-muted text-muted-foreground";
}

export function StartWithChrona({ className = "", createdTaskId = null, workspaceId, isComplete = false, onCreateTask, onCreateSafeDemo, onOpenCreatedTask }: StartWithChronaProps) {
  const { t } = useI18n();
  const locale = useLocale();
  const router = useAppRouter();
  const [hasClients, setHasClients] = useState<boolean | null>(null);
  const aiClientsRequestId = useRef(0);
  const [storedTask, setStoredTask] = useState<TaskPresence | null>(workspaceId ? null : EMPTY_TASK_PRESENCE);
  const currentTaskId = createdTaskId ?? storedTask?.taskId ?? null;
  const hasCreatedTask = Boolean(createdTaskId || storedTask?.hasTask);

  useEffect(() => {
    let cancelled = false;

    const refreshClients = () => {
      const requestId = aiClientsRequestId.current + 1;
      aiClientsRequestId.current = requestId;

      apiJson<AiClientsResponse>("/api/ai/clients")
        .then((payload) => {
          if (cancelled || requestId !== aiClientsRequestId.current) return;
          setHasClients(hasEnabledClient(payload.clients));
        })
        .catch(() => {
          if (!cancelled && requestId === aiClientsRequestId.current) setHasClients(true);
        });
    };

    refreshClients();
    const stopListening = listenAiClientsChanged(refreshClients);

    return () => {
      cancelled = true;
      stopListening();
    };
  }, []);

  useEffect(() => {
    if (!workspaceId) {
      setStoredTask(EMPTY_TASK_PRESENCE);
      return;
    }

    let cancelled = false;
    setStoredTask(null);

    apiJson<TasksResponse>(tasksPath(workspaceId))
      .then((payload) => {
        if (!cancelled) setStoredTask(taskPresence(payload));
      })
      .catch(() => {
        if (!cancelled) setStoredTask(EMPTY_TASK_PRESENCE);
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (isComplete) return null;
  if (hasClients === null || storedTask === null) return null;

  const steps: OnboardingStep[] = [
    {
      title: t("components.schedulePage.firstRunStepConnectAiTitle"),
      description: hasClients ? t("components.schedulePage.firstRunStepConnectAiDone") : t("components.schedulePage.firstRunStepConnectAi"),
      state: stepState(0, { hasClients, hasCreatedTask, isComplete }),
    },
    {
      title: t("components.schedulePage.firstRunStepCreateTaskTitle"),
      description: t("components.schedulePage.firstRunStepCreateTask"),
      state: stepState(1, { hasClients, hasCreatedTask, isComplete }),
    },
    {
      title: t("components.schedulePage.firstRunStepReviewPlanTitle"),
      description: t("components.schedulePage.firstRunStepReviewPlan"),
      state: stepState(2, { hasClients, hasCreatedTask, isComplete }),
    },
  ];

  const handlePrimaryAction = () => {
    if (!hasClients) {
      router.push(localizeHref(locale, "/settings?panel=ai-clients"));
      return;
    }

    if (currentTaskId) {
      if (onOpenCreatedTask) {
        onOpenCreatedTask(currentTaskId);
        return;
      }
      router.push(localizeHref(locale, `/tasks/${currentTaskId}`));
      return;
    }

    if (hasCreatedTask) {
      router.push(localizeHref(locale, "/tasks"));
      return;
    }

    onCreateTask?.();
  };

  return (
    <section className={`rounded-3xl border border-primary/20 bg-primary-soft/70 p-4 text-sm shadow-sm ${className}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-2">
            <h2 className="text-base font-semibold text-foreground">
              {t("components.schedulePage.firstRunTitle")}
            </h2>
            <p className="max-w-3xl text-muted-foreground">
              {t("components.schedulePage.firstRunDescription")}
            </p>
          </div>
          <ol className="grid gap-2 sm:grid-cols-3" aria-label={t("components.schedulePage.firstRunTitle")}>
            {steps.map((step, index) => (
              <li key={step.title} aria-current={step.state === "current" ? "step" : undefined} className={`rounded-2xl border p-3 ${stepClasses(step.state)}`}>
                <div className="flex items-start gap-2.5">
                  <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${stepBadgeClasses(step.state)}`}>
                    {step.state === "done" ? "✓" : index + 1}
                  </span>
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium leading-snug text-foreground">{step.title}</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">{step.description}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" size="default" onClick={handlePrimaryAction}>
            {hasClients ? t(hasCreatedTask ? "components.schedulePage.firstRunOpenCreatedTask" : "components.schedulePage.firstRunCreateTask") : t("components.schedulePage.firstRunConnectAi")}
          </Button>
          {!hasCreatedTask && onCreateSafeDemo ? (
            <Button type="button" variant="outline" size="default" onClick={onCreateSafeDemo}>
              {t("components.schedulePage.firstRunCreateSafeDemo")}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
