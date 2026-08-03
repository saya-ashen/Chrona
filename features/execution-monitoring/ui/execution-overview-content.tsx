import { Activity, LoaderCircle, TerminalSquare } from "lucide-react";
import type { ReactNode } from "react";
import type { UiDocument } from "@chrona/ui-protocol";
import {
  ActivityTimeline,
  SpecRenderer,
  type WorkspaceActivityItem,
} from "@features/task-workspace/public/workspace-integration";
import type { ResultNodeFilter, ResultNodeOption } from "./build-execution-overview-spec";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@shared/ui";
type CommandCenterCopy = Record<string, string | undefined>;

type WorkspaceCopy = Record<string, string | undefined>;
type ResultStatus = "active" | "failed" | "running" | "ready" | "unavailable";
type ResultCollapseCommand = { mode: "collapse" | "expand"; revision: number } | null;

type ResultStatusInfoProps = {
  status: ResultStatus;
  hasAvailableResult: boolean;
  copy: WorkspaceCopy;
  isProducingOutput: boolean;
};

function resultStatusLabel(status: ResultStatus, hasAvailableResult: boolean, copy: WorkspaceCopy) {
  if (status === "active") return hasAvailableResult ? (copy.resultsAvailableBadge ?? "Results available") : (copy.resultsPendingBadge ?? "No result yet");
  if (status === "failed") return copy.finalizationFailedBadge ?? "Finalization failed";
  if (status === "running") return copy.finalizationRunningBadge ?? "Preparing";
  return status === "ready" ? (copy.aiGeneratedBadge ?? "AI generated") : (copy.finalizationUnavailableBadge ?? "Artifacts only");
}

function resultStatusDescription(status: ResultStatus, hasAvailableResult: boolean, copy: WorkspaceCopy) {
  if (status === "active") return hasAvailableResult ? (copy.resultsAvailableDescription ?? "Current output and completed step results collected during this run.") : (copy.resultsPendingDescription ?? "The current step has not produced viewable output yet. Follow execution activity for live progress.");
  if (status === "failed") return copy.finalizationFailedDescription ?? "Chrona could not assemble the final result. Generated files remain available below.";
  if (status === "running") return copy.finalizationRunningDescription ?? "Chrona is assembling and validating the final result.";
  return status === "ready" ? (copy.validatedOutputDescription ?? "Validated output from task execution.") : (copy.finalizationUnavailableDescription ?? "The final result is unavailable. Generated files are shown below.");
}

function resultStatusTitle(status: ResultStatus, copy: WorkspaceCopy) {
  if (status === "active") return copy.stageResultsTitle ?? "Stage results";
  if (status === "failed") return copy.finalizationFailedTitle ?? "Final result unavailable";
  if (status === "running") return copy.finalizationRunningTitle ?? "Preparing final result";
  return copy.finalResultTitle ?? "Final result";
}

function resultStatusClassName(status: ResultStatus) {
  if (status === "active") return "bg-sky-500/10 text-sky-700 dark:text-sky-200";
  if (status === "failed") return "border-destructive/30 bg-destructive/10 text-destructive";
  if (status === "running") return "bg-amber-500/10 text-amber-700 dark:text-amber-200";
  return "bg-violet-500/10 text-violet-700 dark:text-violet-200";
}

function ResultStatusInfo({ status, hasAvailableResult, copy, isProducingOutput }: ResultStatusInfoProps) {
  return (
    <div className="min-w-0 space-y-1">
      <h3 id="task-workspace-results-heading" className="font-heading text-base font-semibold text-foreground">
        {resultStatusTitle(status, copy)}
      </h3>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {status === "active" && isProducingOutput ? (
          <span role="status" aria-label="Execution is producing output" className="inline-flex items-center">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            {!hasAvailableResult ? <span className="sr-only">{resultStatusLabel(status, false, copy)}</span> : null}
          </span>
        ) : null}
        <Badge variant="outline" className={resultStatusClassName(status)}>{resultStatusLabel(status, hasAvailableResult, copy)}</Badge>
        <span>{resultStatusDescription(status, hasAvailableResult, copy)}</span>
      </div>
    </div>
  );
}


type FinalizationRetryProps = {
  copy: WorkspaceCopy;
  error: string | null | undefined;
  isRetrying: boolean;
  onRetry: (() => Promise<void> | void) | undefined;
};

function FinalizationRetry({ copy, error, isRetrying, onRetry }: FinalizationRetryProps) {
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-3 text-sm" role="alert">
      <p className="font-medium text-foreground">
        {copy.finalizationFailedActionDescription ?? "Retry finalization to assemble and validate the complete result."}
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button type="button" size="sm" onClick={() => void onRetry?.()} disabled={!onRetry || isRetrying}>
        {isRetrying ? (copy.finalizationRetrying ?? "Retrying finalization...") : (copy.finalizationRetry ?? "Retry finalization")}
      </Button>
    </div>
  );
}

type ResultsToolbarProps = {
  copy: WorkspaceCopy;
  nodeOptions: ResultNodeOption[];
  selectedNodeId: ResultNodeFilter;
  onSelectedNodeIdChange: (value: ResultNodeFilter) => void;
  onCollapseCommand: (mode: "collapse" | "expand") => void;
};

function ResultsToolbar({ copy, nodeOptions, selectedNodeId, onSelectedNodeIdChange, onCollapseCommand }: ResultsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {nodeOptions.length > 1 ? (
        <Select value={selectedNodeId} onValueChange={(value) => onSelectedNodeIdChange(value as ResultNodeFilter)}>
          <SelectTrigger aria-label={copy.resultNodeFilterLabel ?? "Filter results by node"} size="sm" className="max-w-full bg-background/90 text-xs">
            <SelectValue placeholder={copy.resultNodeFilterAll ?? "All nodes"} />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">{copy.resultNodeFilterAll ?? "All nodes"}</SelectItem>
            {nodeOptions.map((node) => <SelectItem key={node.id} value={node.id}>{node.title}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="h-8 px-2.5 text-xs" />}>
          {copy.resultOptions ?? "Result options"}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onCollapseCommand("collapse")}>{copy.collapseAllResults ?? "Collapse all"}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onCollapseCommand("expand")}>{copy.expandAllResults ?? "Expand all"}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

type ExecutionResultsProps = {
  taskId: string;
  workspaceCopy: WorkspaceCopy;
  active: boolean;
  status: ResultStatus;
  isLive: boolean;
  hasAvailableResult: boolean;
  finalizationRetryError: string | null | undefined;
  onRetryFinalization: (() => Promise<void> | void) | undefined;
  isRetryingFinalization: boolean;
  nodeOptions: ResultNodeOption[];
  selectedNodeId: ResultNodeFilter;
  onSelectedNodeIdChange: (value: ResultNodeFilter) => void;
  onCollapseCommand: (mode: "collapse" | "expand") => void;
  outputSpec: UiDocument;
  handlers: Record<string, (params: Record<string, unknown>) => void>;
  resultCollapseCommand: ResultCollapseCommand;
};

function ExecutionResults(props: ExecutionResultsProps) {
  const { taskId, workspaceCopy, active, status, hasAvailableResult, isLive, finalizationRetryError, onRetryFinalization, isRetryingFinalization, nodeOptions, selectedNodeId, onSelectedNodeIdChange, onCollapseCommand, outputSpec, handlers, resultCollapseCommand } = props;
  return (
    <section aria-label={active ? (workspaceCopy.stageResultsTitle ?? "Stage results") : (workspaceCopy.finalResultTitle ?? "Final result")} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-3">
        <div className="min-w-0 space-y-1">
          <ResultStatusInfo status={status} hasAvailableResult={hasAvailableResult} copy={workspaceCopy} isProducingOutput={isLive} />
          {status === "failed" ? <FinalizationRetry copy={workspaceCopy} error={finalizationRetryError} isRetrying={isRetryingFinalization} onRetry={onRetryFinalization} /> : null}
        </div>
        <ResultsToolbar copy={workspaceCopy} nodeOptions={nodeOptions} selectedNodeId={selectedNodeId} onSelectedNodeIdChange={onSelectedNodeIdChange} onCollapseCommand={onCollapseCommand} />
      </div>
      <SpecRenderer spec={outputSpec} handlers={handlers} resultCollapseCommand={resultCollapseCommand} resultCollapseStorageKey={`task:${taskId}:execution-result`} />
    </section>
  );
}

type TranscriptProps = {
  copy: CommandCenterCopy;
  active: boolean;
  waitingForHuman: boolean;
  isLive: boolean;
  activityItems: WorkspaceActivityItem[];
  activitySummary: string;
  provider: string | null | undefined;
};

function Transcript({ copy, active, waitingForHuman, isLive, activityItems, activitySummary, provider }: TranscriptProps) {
  const activityContent = <ActivityTimeline items={activityItems} density="detailed" active={isLive} transcript />;
  const statusLabel = isLive ? "Live" : waitingForHuman ? "Paused" : "Completed";
  const header = (
    <div className="border-b border-border/60 pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><TerminalSquare className="size-4 text-primary" aria-hidden /><h3 className="font-heading text-base font-semibold text-foreground">Agent transcript</h3><Badge variant={isLive ? "default" : "secondary"}>{statusLabel}</Badge></div>
          <p className="mt-1 text-xs text-muted-foreground">{activitySummary}</p>
        </div>
        {provider ? <span className="text-xs font-medium text-muted-foreground">{provider}</span> : null}
      </div>
    </div>
  );
  if (!active) return <CompletedTranscriptSheet count={activityItems.length} content={activityContent} />;
  return <section aria-label={copy.trailTab} className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-background/70"><div className="z-10 shrink-0 bg-background/95 p-4 pb-0 backdrop-blur supports-[backdrop-filter]:bg-background/85">{header}</div><div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">{activityContent}</div></section>;
}

function CompletedTranscriptSheet({ count, content }: { count: number; content: ReactNode }) {
  return (
    <Sheet>
      <SheetTrigger render={<Button type="button" variant="outline" size="sm" className="fixed right-0 top-1/2 z-40 h-auto min-w-11 -translate-y-1/2 touch-manipulation rounded-r-none border-r-0 bg-background/95 px-2.5 py-3 shadow-lg backdrop-blur transition-colors supports-[backdrop-filter]:bg-background/85" aria-label={`Open Agent transcript · ${count} events`} />}>
        <span className="flex flex-col items-center gap-2"><Activity className="size-4 text-primary" aria-hidden /><span className="[writing-mode:vertical-rl] text-[10px] font-semibold tracking-[0.08em]">Agent transcript</span><Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-[10px]">{count}</Badge></span>
      </SheetTrigger>
      <SheetContent className="w-[92vw] max-w-[62rem] gap-0 overflow-hidden data-[side=right]:w-[92vw] data-[side=right]:sm:w-[72vw] data-[side=right]:sm:max-w-[62rem]"><SheetHeader className="z-10 shrink-0 border-b border-border/60 bg-popover/95 backdrop-blur supports-[backdrop-filter]:bg-popover/85"><SheetTitle>Agent transcript</SheetTitle><SheetDescription>Intent, tool calls, results, and execution state. Latest activity appears first.</SheetDescription></SheetHeader><div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-4"><div className="mt-1">{content}</div></div></SheetContent>
    </Sheet>
  );
}

export type ExecutionOverviewContentProps = Omit<ExecutionResultsProps, "active" | "workspaceCopy"> & Omit<TranscriptProps, "active"> & {
  failureAlert: ReactNode;
  executionIsActive: boolean;
  workspaceCopy: WorkspaceCopy;
};

export function ExecutionOverviewContent({ failureAlert, executionIsActive, workspaceCopy, ...props }: ExecutionOverviewContentProps) {
  const results = <ExecutionResults {...props} workspaceCopy={workspaceCopy} active={executionIsActive} />;
  const transcript = <Transcript {...props} active={executionIsActive} />;
  return <section aria-label={workspaceCopy.executionOverviewAria} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{failureAlert}{executionIsActive ? <Tabs defaultValue="activity" className="min-h-0 flex-1 xl:hidden"><TabsList className="grid w-full grid-cols-2"><TabsTrigger value="results">{props.copy.outputTab}</TabsTrigger><TabsTrigger value="activity">{props.copy.trailTab}</TabsTrigger></TabsList><TabsContent value="results" className="min-h-0 overflow-y-auto pt-3">{results}</TabsContent><TabsContent value="activity" className="min-h-0 overflow-y-auto pt-3">{transcript}</TabsContent></Tabs> : null}<div className={executionIsActive ? "hidden min-h-0 flex-1 xl:grid xl:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)] xl:gap-4" : "min-h-0 flex-1"}>{results}{transcript}</div></section>;
}
