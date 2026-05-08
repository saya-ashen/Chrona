import { Activity, ChevronDown, ChevronUp } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { WorkbenchComposerCard } from "./workbench-composer-card";
import type { WorkbenchComposer, WorkbenchCopy, WorkPageData } from "./work-page-types";

type WorkPageComposerDockProps = {
  isComposerExpanded: boolean;
  onExpandChange: (next: boolean) => void;
  dockSummary: string;
  workbenchComposer: WorkbenchComposer | null;
  data: WorkPageData;
  currentStepTitle: string | null;
  composerValue: string;
  onComposerChange: (value: string) => void;
  onSubmit: (value: string) => Promise<boolean>;
  quickPrompts: string[];
  errorMessage: string | null;
  isPending: boolean;
  passiveDescription: string;
  passiveActions: string;
  copy: WorkbenchCopy;
  composerResetKey: number;
  runId: string | null;
  executionStatus: WorkPageData["planExecution"] extends infer T ? T extends { status: infer S } ? S : never : never | string;
  onStartExecution: () => void | Promise<unknown>;
};

export function WorkPageComposerDock({
  isComposerExpanded,
  onExpandChange,
  dockSummary,
  workbenchComposer,
  data,
  currentStepTitle,
  composerValue,
  onComposerChange,
  onSubmit,
  quickPrompts,
  errorMessage,
  isPending,
  passiveDescription,
  passiveActions,
  copy,
  composerResetKey,
  runId,
  executionStatus,
  onStartExecution,
}: WorkPageComposerDockProps) {
  return (
    <>
      <div className="pointer-events-none fixed bottom-3 left-4 right-4 z-40 xl:left-[268px] xl:right-7">
        <div className="mx-auto w-full max-w-[1180px]">
          {isComposerExpanded ? (
            <div className="pointer-events-auto rounded-[26px] border border-border/80 bg-white/96 p-3 shadow-[0_24px_70px_rgba(15,23,42,0.16)] supports-[backdrop-filter]:backdrop-blur">
              <div className="mb-3 flex items-center justify-between gap-3 px-1">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">Add Input</p>
                  <p className="truncate text-xs text-muted-foreground">{dockSummary}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onExpandChange(false)}
                  className="inline-flex h-8 items-center gap-1 rounded-xl border border-border/70 bg-background px-3 text-sm text-muted-foreground hover:bg-muted/40"
                >
                  Collapse
                  <ChevronDown className="size-4" />
                </button>
              </div>
              <WorkbenchComposerCard
                className="border-border/80 bg-white shadow-none"
                composer={workbenchComposer}
                currentIntervention={data.currentIntervention}
                currentStepTitle={currentStepTitle}
                composerValue={composerValue}
                onComposerChange={onComposerChange}
                onSubmit={onSubmit}
                quickPrompts={quickPrompts}
                errorMessage={errorMessage}
                isPending={isPending}
                passiveDescription={passiveDescription}
                passiveActions={passiveActions}
                copy={copy}
                composerResetKey={composerResetKey}
                runId={runId}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onExpandChange(true)}
              className="pointer-events-auto flex w-full items-center justify-between gap-3 rounded-[22px] border border-border/80 bg-white/96 px-4 py-3 text-left shadow-[0_18px_40px_rgba(15,23,42,0.14)] supports-[backdrop-filter]:backdrop-blur"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">Add Input</p>
                  <StatusBadge tone={workbenchComposer ? "warning" : "info"}>{workbenchComposer ? "Needed" : "Standby"}</StatusBadge>
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">{dockSummary}</p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-border/70 bg-background px-3 py-1.5 text-sm text-muted-foreground">
                Expand
                <ChevronUp className="size-4" />
              </span>
            </button>
          )}
        </div>
      </div>

      {executionStatus === "no_plan" ? (
        <section className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          <div className="flex items-center justify-between gap-3">
            <span>No plan yet. Create or accept a plan before execution.</span>
            {data.taskPlan.nodes.length > 0 ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => void onStartExecution()}
                className={buttonVariants({ variant: "default", size: "sm", className: "rounded-xl shrink-0" })}
              >
                <Activity className="mr-1.5 size-3.5" />
                Start Execution
              </button>
            ) : null}
          </div>
        </section>
      ) : executionStatus !== "completed" && executionStatus !== "running" ? (
        <section className="rounded-2xl border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
          <div className="flex items-center justify-between gap-3">
            <span>
              Execution is {executionStatus}. {executionStatus === "waiting_for_user" ? "Provide input to continue." : executionStatus === "waiting_for_approval" ? "Review and approve pending actions." : executionStatus === "blocked" ? "Resolve the blocking issue to resume." : "Start or resume execution."}
            </span>
            <button
              type="button"
              disabled={isPending}
              onClick={() => void onStartExecution()}
              className={buttonVariants({ variant: "default", size: "sm", className: "rounded-xl shrink-0" })}
            >
              <Activity className="mr-1.5 size-3.5" />
              Resume
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
