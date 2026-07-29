"use client";

import { useLocale } from "@chrona/i18n";
import { Badge, Button } from "@shared/ui";

import type { GoalCopy, GoalData } from "../model/goal-types";
import { LocalizedLink } from "./localized-link";
import { formatDate } from "./goal-workspace-shared";

export function GoalHistory({
  goal,
  copy,
  isArchive,
}: {
  goal: GoalData;
  copy: GoalCopy;
  isArchive: boolean;
}) {
  const locale = useLocale();
  return (
    <section className="space-y-5">
      <div className="border-b pb-5">
        <p className="text-sm font-medium text-muted-foreground">
          {copy.history}
        </p>
        <h2 className="mt-1 max-w-3xl text-2xl font-semibold tracking-tight">
          {isArchive ? copy.archiveDescription : copy.workspaceDescription}
        </h2>
      </div>
      <ol className="relative ml-1 max-w-4xl space-y-0 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-border">
        {goal.activity.map((item) => {
          const isAchievement = item.type === "goal_achieved";
          const isResult = item.type === "result_accepted";
          return (
            <li key={item.id} className="relative flex gap-4 pb-7 last:pb-0">
              <span
                className={`relative z-10 mt-1.5 size-[15px] shrink-0 rounded-full border-[3px] border-background ${isAchievement ? "bg-success" : isResult ? "bg-info" : "bg-muted-foreground/50"}`}
              />
              <article
                className={`min-w-0 flex-1 ${isAchievement ? "-mt-2 rounded-xl border border-success/20 bg-success/[0.035] p-4" : "pb-1"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <Badge
                      variant="outline"
                      className={`mt-1.5 text-[10px] uppercase tracking-wide ${isAchievement ? "border-success/25 text-success" : isResult ? "border-info/25 text-info" : "text-muted-foreground"}`}
                    >
                      {item.type.replaceAll("_", " ")}
                    </Badge>
                  </div>
                  <time className="text-xs text-muted-foreground">
                    {formatDate(item.occurredAt, locale)}
                  </time>
                </div>
                {item.detail ? (
                  <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {item.detail}
                  </p>
                ) : null}
                {item.taskId ? (
                  <Button
                    asChild
                    variant="link"
                    size="sm"
                    className="mt-1 h-auto px-0"
                  >
                    <LocalizedLink
                      href={`/goals/${goal.id}/workbench/tasks/${item.taskId}`}
                    >
                      {copy.openTask}
                    </LocalizedLink>
                  </Button>
                ) : null}
              </article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
