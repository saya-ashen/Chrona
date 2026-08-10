"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useRevalidator, type NavigateFunction } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  History,
  ListChecks,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Target,
} from "lucide-react";
import { localizeHref, useLocale } from "@chrona/i18n";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  TabsList,
  TabsTrigger,
} from "@shared/ui";
import {
  runGoalAction,
} from "../browser-api";
import type {
  GoalCopy,
  GoalData,
} from "../model/goal-types";
type PrimaryActionChoiceProps = {
  goal: GoalData;
  copy: GoalCopy;
  pending: boolean;
  locale: "en" | "zh";
  navigate: NavigateFunction;
  onStartReview: () => void;
  onAddTask: () => void;
  onAchieve: () => void;
  onResume: () => void;
};

function PrimaryActionChoice({
  goal,
  copy,
  pending,
  locale,
  navigate,
  onStartReview,
  onAddTask,
  onAchieve,
  onResume,
}: PrimaryActionChoiceProps) {
  const action = goal.primaryAction.kind;
  const taskHref = goal.primaryAction.taskId
    ? localizeHref(locale, `/goals/${goal.id}/workbench/tasks/${goal.primaryAction.taskId}`)
    : null;
  if ((action === "resolve_attention" || action === "continue_work") && taskHref) {
    return (
      <Button onClick={() => void navigate(taskHref)}>
        {action === "resolve_attention" ? <AlertTriangle className="size-4" /> : <Play className="size-4" />}
        {copy.nextAction[action]}
      </Button>
    );
  }
  if (action === "resume") return <Button disabled={pending} onClick={onResume}><Play className="size-4" />{copy.resume}</Button>;
  if (action === "review_criteria") return <Button onClick={() => void navigate(`${localizeHref(locale, `/goals/${goal.id}`)}?section=criteria`)}><CheckCircle2 className="size-4" />{copy.nextAction.review_criteria}</Button>;
  if (action === "review") return <Button onClick={onStartReview}><RefreshCw className="size-4" />{copy.startReview}</Button>;
  if (action === "confirm_outcome" && goal.outcome.criteria.length > 0 && goal.outcome.criteria.every((criterion) => criterion.satisfied)) return <Button onClick={onAchieve}><CheckCircle2 className="size-4" />{copy.achieve}</Button>;
  return <Button onClick={onAddTask}><Plus className="size-4" />{copy.addTask}</Button>;
}

export function PrimaryAction({
  goal,
  copy,
  onStartReview,
  onAddTask,
  onAchieve,
}: {
  goal: GoalData;
  copy: GoalCopy;
  onStartReview: () => void;
  onAddTask: () => void;
  onAchieve: () => void;
}) {
  const revalidator = useRevalidator();
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();
  const locale = useLocale();

  async function runLifecycle(action: "pause" | "resume" | "stop") {
    setPending(true);
    try {
      await runGoalAction(goal.id, { action });
      await revalidator.revalidate();
    } finally {
      setPending(false);
    }
  }

  const button = (
    <PrimaryActionChoice
      goal={goal}
      copy={copy}
      pending={pending}
      locale={locale}
      navigate={navigate}
      onStartReview={onStartReview}
      onAddTask={onAddTask}
      onAchieve={onAchieve}
      onResume={() => void runLifecycle("resume")}
    />
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {goal.status !== "Achieved" && goal.status !== "Stopped" ? button : null}
      {goal.status === "Active" ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Goal actions"
              />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onStartReview}>
              <RefreshCw className="size-4" />
              {copy.startReview}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onAddTask}>
              <Plus className="size-4" />
              {copy.addTask}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void runLifecycle("pause")}>
              <Pause className="size-4" />
              {copy.pause}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => void runLifecycle("stop")}
            >
              {copy.stop}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
type GoalWorkspaceSection =
  "overview" | "work" | "workbench" | "criteria" | "history";

export function GoalSectionNavigation({
  section,
  copy,
}: {
  section: GoalWorkspaceSection;
  copy: GoalCopy;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState({ start: false, end: false });
  const updateScrollEdges = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const next = {
      start: scroller.scrollLeft > 1,
      end:
        scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1,
    };
    setScrollEdges((current) =>
      current.start === next.start && current.end === next.end ? current : next,
    );
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const activeTab = scroller.querySelector<HTMLElement>(
      '[role="tab"][data-state="active"]',
    );
    activeTab?.scrollIntoView?.({ block: "nearest", inline: "center" });
    updateScrollEdges();
    window.addEventListener("resize", updateScrollEdges);
    return () => window.removeEventListener("resize", updateScrollEdges);
  }, [section, updateScrollEdges]);

  const sections = [
    { value: "overview", label: copy.overview, Icon: Target },
    { value: "work", label: copy.tasksSection, Icon: ListChecks },
    { value: "workbench", label: copy.workbench, Icon: FileCheck2 },
    { value: "criteria", label: copy.successCriteria, Icon: CheckCircle2 },
    { value: "history", label: copy.history, Icon: History },
  ] as const;

  return (
    <nav
      aria-label={copy.controlPlane}
      className="shrink-0 border-b border-border/60 bg-background pt-0.5"
    >
      <div className="relative">
        {scrollEdges.start ? (
          <span
            className="pointer-events-none absolute inset-y-px left-px z-10 w-8 rounded-l-xl bg-gradient-to-r from-muted via-muted/85 to-transparent sm:hidden"
            aria-hidden
          />
        ) : null}
        {scrollEdges.end ? (
          <span
            className="pointer-events-none absolute inset-y-px right-px z-10 w-8 rounded-r-xl bg-gradient-to-l from-muted via-muted/85 to-transparent sm:hidden"
            aria-hidden
          />
        ) : null}
        <div
          ref={scrollerRef}
          className="no-scrollbar w-fit max-w-full overflow-x-auto rounded-xl border border-border/70 bg-muted/45 p-1 shadow-xs"
          onScroll={updateScrollEdges}
        >
          <TabsList className="h-auto min-w-max justify-start gap-1 rounded-none bg-transparent p-0">
            {sections.map(({ value, label, Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="h-10 flex-none rounded-lg border-transparent px-3 text-sm text-muted-foreground shadow-none hover:bg-background/70 hover:text-foreground data-[state=active]:border-border/70 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs data-[state=active]:[&_svg]:text-primary sm:px-4"
              >
                <Icon className="size-4" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </div>
    </nav>
  );
}

// The workspace composes the four lifecycle sections at the route boundary.
