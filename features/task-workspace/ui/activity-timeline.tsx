import { useState, type ReactNode } from "react";
import { Bot, Check, ChevronDown, ChevronUp, Circle, FileText, GitBranch, ListTree, Sparkles, TriangleAlert, Wrench } from "lucide-react";
import { Button, cn } from "@shared/ui";
import type { WorkspaceActivityItem, WorkspaceActivityTone } from "../model/task-workspace-types";

// ─── Data model ───────────────────────────────────────────────────────────────

type Tone = WorkspaceActivityTone | undefined;

type RenderEntry =
  | { type: "run_divider"; key: string; runNumber: number; restarted: boolean; timestamp?: string | null }
  | { type: "node_header"; key: string; nodeTitle: string }
  | { type: "single"; key: string; item: WorkspaceActivityItem }
  | { type: "tool_pair"; key: string; started: WorkspaceActivityItem; progress: WorkspaceActivityItem[]; completed?: WorkspaceActivityItem }
  | { type: "plan_phase"; key: string; items: WorkspaceActivityItem[] }
  | { type: "execution_header"; key: string };

function isPlanGenerationEvent(item: WorkspaceActivityItem) {
  return item.rawEventType?.startsWith("plan_generation.") || item.id.includes("plan_generation.");
}

function planGenerationGroupKey(item: WorkspaceActivityItem) {
  if (!isPlanGenerationEvent(item)) return undefined;
  return "plan-generation";
}
function isPlanGenerationMilestone(item: WorkspaceActivityItem) {
  const text = `${item.rawEventType ?? ""} ${item.title} ${item.summary}`.toLowerCase();
  return item.tone === "success" || text.includes("plan generated") || text.includes("generated");
}

function getActivityNodeKey(item: WorkspaceActivityItem) {
  return item.sourceNodeId ?? item.sourceNodeTitle;
}

function pushNodeHeader(result: RenderEntry[], item: WorkspaceActivityItem, lastNodeId: string | undefined) {
  const nodeKey = getActivityNodeKey(item);
  if (item.sourceNodeTitle && nodeKey !== lastNodeId && item.kind !== "node") {
    result.push({ type: "node_header", key: `nh:${nodeKey}`, nodeTitle: item.sourceNodeTitle });
  }
  return nodeKey ?? lastNodeId;
}

function collectPlanGenerationGroup(items: WorkspaceActivityItem[], startIndex: number, groupKey: string) {
  const group: WorkspaceActivityItem[] = [];
  for (let index = startIndex; index < items.length; index += 1) {
    if (planGenerationGroupKey(items[index]) === groupKey) group.push(items[index]);
  }
  return group;
}

function isSameToolActivity(left: WorkspaceActivityItem, right: WorkspaceActivityItem) {
  const leftCallId = left.tool?.callId;
  const rightCallId = right.tool?.callId;
  if (leftCallId && rightCallId) return leftCallId === rightCallId;
  const sameName = left.tool?.name === right.tool?.name || !left.tool?.name;
  return left.sourceNodeId === right.sourceNodeId
    && left.runId === right.runId
    && left.nativeRunId === right.nativeRunId
    && sameName;
}

function getToolPair(items: WorkspaceActivityItem[], item: WorkspaceActivityItem, index: number) {
  if (item.kind !== "tool_started") return undefined;
  const next = items.at(index + 1);
  if (next?.kind === "tool_completed" && isSameToolActivity(item, next)) return next;
  return items.find((candidate) => candidate.kind === "tool_completed" && isSameToolActivity(item, candidate));
}

function getToolProgress(items: WorkspaceActivityItem[], started: WorkspaceActivityItem) {
  return items.filter((candidate) =>
    candidate.kind === "tool_progress" && isSameToolActivity(started, candidate)
  );
}
function findStartedTool(items: WorkspaceActivityItem[], item: WorkspaceActivityItem) {
  return items.find((candidate) =>
    candidate.kind === "tool_started" && isSameToolActivity(candidate, item)
  );
}

function hasCompletedTool(items: WorkspaceActivityItem[], item: WorkspaceActivityItem) {
  return items.some((candidate) =>
    candidate.kind === "tool_completed" && isSameToolActivity(candidate, item)
  );
}

function hasToolProgress(items: WorkspaceActivityItem[], item: WorkspaceActivityItem) {
  return items.some((candidate) =>
    candidate.kind === "tool_progress" && isSameToolActivity(candidate, item)
  );
}

const TRANSCRIPT_HIDDEN_EVENTS = new Set([
  "plan_generation.status",
  "plan_execution.executable_path_computed",
  "plan_execution.plan_output_updated",
  "turn_start",
  "turn_end",
]);


function executionSessionId(item: WorkspaceActivityItem) {
  return item.executionSessionId;
}

function executionSessionOrder(items: WorkspaceActivityItem[]) {
  const sessions: string[] = [];
  for (const item of [...items].reverse()) {
    const sessionId = executionSessionId(item);
    if (sessionId && !sessions.includes(sessionId)) sessions.push(sessionId);
  }
  return sessions;
}
/**
 * Flattens items into a render list, grouping plan and tool lifecycles.
 */
export function buildRenderList(items: WorkspaceActivityItem[], transcript = false): RenderEntry[] {
  const visibleItems = transcript
    ? items.filter((item) => !TRANSCRIPT_HIDDEN_EVENTS.has(item.rawEventType ?? ""))
    : items;
  const result: RenderEntry[] = [];
  let lastNodeId: string | undefined = undefined;
  const groupedPlanGenerationKeys = new Set<string>();
  const sessionOrder = executionSessionOrder(visibleItems);
  let previousSessionId: string | undefined;
  let executionHeaderSessionId: string | undefined;

  for (let i = 0; i < visibleItems.length; i++) {
    const item = visibleItems[i];
    const sessionId = executionSessionId(item);
    if (sessionId && sessionId !== previousSessionId) {
      const runNumber = sessionOrder.indexOf(sessionId) + 1;
      result.push({
        type: "run_divider",
        key: `run:${sessionId}`,
        runNumber,
        restarted: item.executionTrigger === "restart" || runNumber > 1,
        timestamp: item.timestamp,
      });
      previousSessionId = sessionId;
      lastNodeId = undefined;
    }
    lastNodeId = pushNodeHeader(result, item, lastNodeId);

    const planGroupKey = planGenerationGroupKey(item);
    if (planGroupKey) {
      if (groupedPlanGenerationKeys.has(planGroupKey)) continue;
      const group = collectPlanGenerationGroup(visibleItems, i, planGroupKey);
      groupedPlanGenerationKeys.add(planGroupKey);
      result.push({ type: "plan_phase", key: `plan:${planGroupKey}:${group[0]?.id ?? item.id}:${group.length}`, items: group });
      continue;
    }

    if (transcript && executionHeaderSessionId !== sessionId) {
      result.push({ type: "execution_header", key: `execution-phase:${sessionId ?? "unscoped"}:${item.id}` });
      executionHeaderSessionId = sessionId;
    }
    if (transcript && item.kind === "tool_completed") {
      const startedTool = findStartedTool(visibleItems, item);
      if (startedTool) {
        result.push({
          type: "tool_pair",
          key: startedTool.id,
          started: startedTool,
          progress: getToolProgress(visibleItems, startedTool),
          completed: item,
        });
        continue;
      }
    }
    if (transcript && item.kind === "tool_progress") {
      const startedTool = findStartedTool(visibleItems, item);
      if (startedTool && !hasCompletedTool(visibleItems, item)) {
        const latestProgress = getToolProgress(visibleItems, startedTool)[0];
        if (latestProgress?.id === item.id) {
          result.push({
            type: "tool_pair",
            key: startedTool.id,
            started: startedTool,
            progress: getToolProgress(visibleItems, startedTool),
          });
        }
        continue;
      }
    }
    const completedTool = getToolPair(visibleItems, item, i);
    if (item.kind === "tool_started") {
      if (transcript && (completedTool || hasToolProgress(visibleItems, item))) continue;
      result.push({
        type: "tool_pair",
        key: item.id,
        started: item,
        progress: getToolProgress(visibleItems, item),
        completed: completedTool,
      });
      continue;
    }

    if (item.kind === "tool_progress" && visibleItems.some((candidate) =>
      candidate.kind === "tool_started" && isSameToolActivity(candidate, item)
    )) continue;
    if (item.kind === "tool_completed" && visibleItems.some((candidate) =>
      candidate.kind === "tool_started" && isSameToolActivity(candidate, item)
    )) continue;
    result.push({ type: "single", key: item.id, item });
  }

  return result;
}

// ─── Visual helpers ────────────────────────────────────────────────────────────

function entryIcon(kind: string | undefined, tone: Tone) {
  if (tone === "danger" || kind === "approval") return TriangleAlert;
  if (kind === "node") return GitBranch;
  if (kind === "provider_run") return Sparkles;
  if (kind?.startsWith("tool_")) return Wrench;
  if (kind === "assistant_message" || kind === "reasoning") return Bot;
  if (kind === "artifact") return FileText;
  if (tone === "success") return Check;
  return Circle;
}

function toneIconClass(tone: Tone): string {
  if (tone === "danger") return "bg-destructive text-destructive-foreground ring-destructive/20";
  if (tone === "warning") return "bg-warning text-warning-foreground ring-warning/20";
  if (tone === "success") return "bg-success text-success-foreground ring-success/20";
  if (tone === "info") return "bg-primary text-primary-foreground ring-primary/20";
  return "bg-muted-foreground/80 text-background ring-muted-foreground/20";
}

export function formatActivityTime(ts: string | null | undefined, timeZone?: string): string | undefined {
  if (!ts) return undefined;
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone,
  }).format(date);
}

function fmtDuration(ms?: number): string | undefined {
  if (ms === undefined) return undefined;
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatPhaseDuration(items: WorkspaceActivityItem[]) {
  const times = items
    .map((item) => item.timestamp ? Date.parse(item.timestamp) : Number.NaN)
    .filter((time) => Number.isFinite(time));
  if (times.length < 2) return undefined;
  return fmtDuration(Math.max(...times) - Math.min(...times));
}

function summarizePlanPhase(items: WorkspaceActivityItem[]) {
  const hasFailure = items.some((item) => item.tone === "danger");
  const hasSuccess = items.some((item) => isPlanGenerationMilestone(item));
  if (hasFailure) return "failed";
  if (hasSuccess) return "completed";
  return "running";
}

const COLLAPSE_THRESHOLD = 360;
const PREVIEW_LEN = 280;

function CollapsibleText({ text, compact }: { text: string; compact: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const limit = compact ? 220 : COLLAPSE_THRESHOLD;
  const shouldCollapse = text.length > limit;
  const shown = shouldCollapse && !expanded ? `${text.slice(0, PREVIEW_LEN).trimEnd()}…` : text;
  return (
    <div className="mt-0.5 text-xs leading-[1.35] text-muted-foreground">
      <p className="whitespace-pre-wrap break-words">{shown}</p>
      {shouldCollapse && (
        <Button type="button" variant="ghost" size="sm" className="mt-1 h-6 rounded-full px-2 text-[11px]" onClick={() => setExpanded((v) => !v)}>
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {expanded ? "Hide" : "Show more"}
        </Button>
      )}
    </div>
  );
}

// ─── Spine column ─────────────────────────────────────────────────────────────

function SpineIcon({
  tone,
  shape = "rounded-full",
  isLast,
  children,
}: {
  tone: Tone;
  shape?: string;
  isLast: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative flex justify-center">
      {!isLast && <span className="absolute -bottom-3 top-8 mx-auto w-px bg-border/50" />}
      <span className={cn("relative z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center ring-4 ring-background shadow-sm", shape, toneIconClass(tone))}>
        {children}
      </span>
    </div>
  );
}

// ─── Row: synthetic node section header ───────────────────────────────────────

function NodeHeaderRow({ nodeTitle, isLast }: { nodeTitle: string; isLast: boolean }) {
  return (
    <div className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2">
      <SpineIcon tone="info" shape="rounded-md" isLast={isLast}>
        <GitBranch className="size-3" />
      </SpineIcon>
      <div className="flex min-w-0 items-center pb-2 pt-1">
        <span className="min-w-0 truncate text-[11px] font-semibold text-primary">
          {nodeTitle}
        </span>
      </div>
    </div>
  );
}

// ─── Row: single event ────────────────────────────────────────────────────────

function SingleEventRow({ item, isLast, compact }: { item: WorkspaceActivityItem; isLast: boolean; compact: boolean }) {
  const tone = item.tone as Tone;
  const Icon = entryIcon(item.kind, tone);
  const time = formatActivityTime(item.timestamp);
  const text = item.kind === "provider_run" && item.summary === item.provider
    ? undefined
    : item.assistant?.text ?? (item.summary && item.summary !== item.title ? item.summary : undefined);
  const isNodeEvent = item.kind === "node";
  const iconTone: Tone = isNodeEvent ? "info" : tone;
  const tool = item.tool;
  const toolState = tool?.state;
  const hasToolDetails = !compact && !!(tool?.inputSummary || tool?.preview || tool?.error);

  return (
    <article className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2">
      <SpineIcon tone={iconTone} shape={isNodeEvent ? "rounded-md" : "rounded-full"} isLast={isLast}>
        <Icon className="size-3" />
      </SpineIcon>
      <div className="min-w-0 pb-2.5 pt-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {time && <time className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/50">{time}</time>}
          <p className="min-w-0 break-words text-xs font-medium leading-snug text-foreground">{item.title}</p>
          {toolState && (
            <span className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
              toolState === "completed" && "bg-success/15 text-success",
              toolState === "failed" && "bg-destructive/15 text-destructive",
              toolState === "started" && "bg-muted text-muted-foreground",
            )}>
              {toolState}
            </span>
          )}
          {toolState === "completed" && tool?.durationMs !== undefined && (
            <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
              {fmtDuration(tool.durationMs)}
            </span>
          )}
        </div>
        {item.provider && item.kind === "provider_run" ? (
          <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{item.provider}</p>
        ) : null}
        {text && <CollapsibleText text={text} compact={compact || (item.kind !== "assistant_message" && item.kind !== "reasoning")} />}
        {hasToolDetails && (
          <dl className="mt-1.5 space-y-1.5 rounded-xl border border-border/50 bg-muted/35 p-2 text-xs">
            {tool?.inputSummary && (
              <div className="grid gap-1 sm:grid-cols-[4rem_minmax(0,1fr)]">
                <dt className="font-semibold text-muted-foreground">Input</dt>
                <dd className="min-w-0 break-words text-foreground/80">{tool.inputSummary}</dd>
              </div>
            )}
            {tool?.preview && (
              <div className="grid gap-1 sm:grid-cols-[4rem_minmax(0,1fr)]">
                <dt className="font-semibold text-muted-foreground">Preview</dt>
                <dd className="min-w-0 break-words text-foreground/80">{tool.preview}</dd>
              </div>
            )}
            {tool?.error && (
              <div className="grid gap-1 sm:grid-cols-[4rem_minmax(0,1fr)]">
                <dt className="font-semibold text-destructive/70">Error</dt>
                <dd className="min-w-0 break-words text-destructive/80">{tool.error}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </article>
  );
}

// ─── Row: merged tool start + end ─────────────────────────────────────────────

function ToolPairRow({
  started,
  progress,
  completed,
  isLast,
  compact,
}: {
  started: WorkspaceActivityItem;
  progress: WorkspaceActivityItem[];
  completed?: WorkspaceActivityItem;
  isLast: boolean;
  compact: boolean;
}) {
  const tool = completed?.tool ?? started.tool;
  const failed = completed?.tone === "danger" || tool?.state === "failed";
  const [detailsOpen, setDetailsOpen] = useState(failed);
  const done = !!completed;
  const duration = fmtDuration(tool?.durationMs);
  const time = formatActivityTime(started.timestamp);
  const iconTone: Tone = failed ? "danger" : done ? "success" : "neutral";
  const latestUpdate = progress.findLast((item) => item.tool?.preview)?.tool?.preview;
  const detailPreviews = [
    { label: "Intent", value: started.tool?.preview },
    { label: "Input", value: started.tool?.inputSummary },
    { label: "Update", value: latestUpdate },
    { label: failed ? "Error" : "Result", value: tool?.error ?? tool?.resultPreview },
  ].filter((detail): detail is { label: string; value: string } => !!detail.value).slice(0, 2);
  const hasDetails = !compact && detailPreviews.length > 0;

  return (
    <article className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2">
      <SpineIcon tone={iconTone} isLast={isLast}>
        <Wrench className="size-3" />
      </SpineIcon>
      <div className="min-w-0 pb-2.5 pt-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {time && <time className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/50">{time}</time>}
          <p className="min-w-0 flex-1 break-words text-xs font-medium leading-snug text-foreground">
            {tool?.label ?? tool?.name ?? started.title}
          </p>
          {done && !failed && (
            <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
              ✓{duration ? ` ${duration}` : ""}
            </span>
          )}
          {failed && (
            <span className="shrink-0 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive">
              ✗ failed
            </span>
          )}
          {!done && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              running
            </span>
          )}
        </div>
        {!done && (progress.at(-1)?.summary || started.summary) ? (
          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            {progress.at(-1)?.summary ?? started.summary}
          </p>
        ) : null}
        {hasDetails && (
          <div className="mt-2 rounded-xl border border-border/50 bg-muted/25 p-2">
            {!detailsOpen ? (
              <dl className="space-y-1 text-[11px]">
                {detailPreviews.map((detail) => (
                  <div key={detail.label} className="grid gap-1 sm:grid-cols-[4rem_minmax(0,1fr)]">
                    <dt className="font-semibold text-muted-foreground">{detail.label}</dt>
                    <dd className="min-w-0 truncate font-mono text-foreground/75">{detail.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <dl className="space-y-1.5 text-xs">
                {started.tool?.inputSummary && (
                  <div className="grid gap-1 sm:grid-cols-[4rem_minmax(0,1fr)]">
                    <dt className="font-semibold text-muted-foreground">Input</dt>
                    <dd className="min-w-0 whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/80">{started.tool.inputSummary}</dd>
                  </div>
                )}
                {tool?.resultPreview && (
                  <div className="grid gap-1 sm:grid-cols-[4rem_minmax(0,1fr)]">
                    <dt className="font-semibold text-muted-foreground">Result</dt>
                    <dd className="min-w-0 whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/80">{tool.resultPreview}</dd>
                  </div>
                )}
                {started.tool?.preview && (
                  <div className="grid gap-1 sm:grid-cols-[4rem_minmax(0,1fr)]">
                    <dt className="font-semibold text-muted-foreground">Intent</dt>
                    <dd className="min-w-0 break-words text-foreground/80">{started.tool.preview}</dd>
                  </div>
                )}
                {progress.map((item) => item.tool?.preview ? (
                  <div key={item.id} className="grid gap-1 sm:grid-cols-[4rem_minmax(0,1fr)]">
                    <dt className="font-semibold text-muted-foreground">Update</dt>
                    <dd className="min-w-0 whitespace-pre-wrap break-words text-foreground/80">{item.tool.preview}</dd>
                  </div>
                ) : null)}
                {tool?.error && (
                  <div className="grid gap-1 sm:grid-cols-[4rem_minmax(0,1fr)]">
                    <dt className="font-semibold text-destructive/70">Error</dt>
                    <dd className="min-w-0 break-words text-destructive/80">{tool.error}</dd>
                  </div>
                )}
              </dl>
            )}
            <button
              type="button"
              className="mt-1.5 flex min-h-7 items-center gap-1 rounded-md px-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setDetailsOpen((value) => !value)}
              aria-expanded={detailsOpen}
            >
              {detailsOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              {detailsOpen ? "Show less" : "View all technical details"}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function PlanPhaseEvent({ item, compact }: { item: WorkspaceActivityItem; compact: boolean }) {
  const milestone = isPlanGenerationMilestone(item);
  const text = getPlanPhaseEventText(item);
  const time = formatActivityTime(item.timestamp);
  const title = milestone ? item.title : text;
  const detail = getPlanPhaseEventDetail(item, text, milestone, compact);

  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className={cn(
        "mt-1.5 flex size-3 shrink-0 items-center justify-center rounded-full",
        milestone ? "bg-success text-success-foreground" : "bg-primary/40",
      )}>
        {milestone ? <Check className="size-2.5" /> : null}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {time && <time className="font-mono text-[10px] tabular-nums text-muted-foreground/50">{time}</time>}
          <p className={cn(
            "min-w-0 break-words text-xs leading-snug",
            milestone ? "font-medium text-foreground" : "text-muted-foreground",
          )}>
            {title}
          </p>
        </div>
        {detail ? <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">{detail}</p> : null}
      </div>
    </div>
  );
}

function getPlanPhaseEventText(item: WorkspaceActivityItem) {
  return item.assistant?.text ?? (item.summary && item.summary !== item.title ? item.summary : item.title);
}

function getPlanPhaseEventDetail(item: WorkspaceActivityItem, text: string, milestone: boolean, compact: boolean) {
  if (!milestone || compact || text === item.title) return undefined;
  return text;
}

function PlanGenerationPhaseRow({
  items,
  isLast,
  compact,
  transcript = false,
}: {
  items: WorkspaceActivityItem[];
  isLast: boolean;
  compact: boolean;
  transcript?: boolean;
}) {
  const [expanded, setExpanded] = useState(transcript ? summarizePlanPhase(items) !== "completed" : true);
  const status = summarizePlanPhase(items);
  const duration = formatPhaseDuration(items);
  const statusTone: Tone = status === "failed" ? "danger" : status === "completed" ? "success" : "info";
  const eventLabel = `${items.length} ${items.length === 1 ? "event" : "events"}`;

  return (
    <article className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3">
      <SpineIcon tone="info" shape="rounded-md" isLast={isLast}>
        <ListTree className="size-3.5" />
      </SpineIcon>
      <div className="min-w-0 pb-4 pt-0.5">
        <div className="rounded-2xl border border-primary/20 bg-primary-soft/40 px-3 py-2.5 shadow-sm">
          <button
            type="button"
            className="flex w-full items-start justify-between gap-3 text-left"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="inline-flex size-5 items-center justify-center rounded-md bg-primary/15 text-primary">
                  <ListTree className="size-3" />
                </span>
                <span className="text-sm font-semibold leading-snug text-foreground">Planning phase</span>
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  statusTone === "success" && "bg-success/15 text-success",
                  statusTone === "danger" && "bg-destructive/15 text-destructive",
                  statusTone === "info" && "bg-primary/15 text-primary",
                )}>
                  {status}
                </span>
              </span>
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {eventLabel}{duration ? ` · ${duration}` : ""}
              </span>
            </span>
            <span className="mt-0.5 shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground">
              {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </span>
          </button>
          {expanded && (
            <div className="mt-3 space-y-2 border-l border-primary/25 pl-3">
              {items.map((item) => <PlanPhaseEvent key={item.id} item={item} compact={compact} />)}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function ExecutionHeaderRow() {
  return (
    <div className="mb-2 mt-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      Execution
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function RunDividerRow({ runNumber, restarted, timestamp }: { runNumber: number; restarted: boolean; timestamp?: string | null }) {
  const time = formatActivityTime(timestamp);
  return (
    <div className="my-3 flex items-center gap-2" role="separator" aria-label={`${restarted ? "Run restarted from beginning" : "Execution started"} · Run ${runNumber}`}>
      <span className="h-px flex-1 bg-border" />
      <span className="shrink-0 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[11px] font-semibold text-foreground">
        {restarted ? "Run restarted from beginning" : "Execution started"} · Run {runNumber}{time ? ` · ${time}` : ""}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function railTitle(entry: RenderEntry) {
  switch (entry.type) {
    case "run_divider":
      return `Run ${entry.runNumber}`;
    case "node_header":
      return entry.nodeTitle;
    case "tool_pair":
      return entry.completed?.tool?.label ?? entry.started.tool?.label ?? entry.completed?.tool?.name ?? entry.started.tool?.name ?? entry.started.title;
    case "plan_phase":
      return "Planning phase";
    case "execution_header":
      return "Execution";
    case "single":
      return entry.item.title;
  }
}

function railDetail(entry: RenderEntry) {
  switch (entry.type) {
    case "run_divider":
      return entry.restarted ? "Restarted" : "Started";
    case "node_header":
      return "Node";
    case "tool_pair": {
      const tool = entry.completed?.tool ?? entry.started.tool;
      const duration = fmtDuration(tool?.durationMs);
      if (entry.completed?.tone === "danger" || tool?.state === "failed") return "failed";
      if (entry.completed) return duration ? `done · ${duration}` : "done";
      return entry.progress.at(-1)?.summary ?? entry.started.summary ?? "running";
    }
    case "plan_phase": {
      const duration = formatPhaseDuration(entry.items);
      const status = summarizePlanPhase(entry.items);
      return duration ? `${status} · ${duration}` : status;
    }
    case "execution_header":
      return "Stage";
    case "single": {
      const item = entry.item;
      if (item.tool?.state === "failed") return "failed";
      if (item.tool?.state === "completed") {
        const duration = fmtDuration(item.tool.durationMs);
        return duration ? `done · ${duration}` : "done";
      }
      if (item.tool?.state === "started" || item.tool?.state === "progress") return item.summary || "running";
      return item.assistant?.text ?? (item.summary && item.summary !== item.title ? item.summary : item.provider ?? formatActivityTime(item.timestamp));
    }
  }
}

function railTone(entry: RenderEntry): Tone {
  switch (entry.type) {
    case "run_divider":
      return "neutral";
    case "node_header":
      return "info";
    case "tool_pair": {
      const tool = entry.completed?.tool ?? entry.started.tool;
      if (entry.completed?.tone === "danger" || tool?.state === "failed") return "danger";
      return entry.completed ? "success" : "info";
    }
    case "plan_phase": {
      const status = summarizePlanPhase(entry.items);
      return status === "failed" ? "danger" : status === "completed" ? "success" : "info";
    }
    case "execution_header":
      return "neutral";
    case "single":
      if (entry.item.kind === "node") return "info";
      if (entry.item.tool?.state === "failed") return "danger";
      if (entry.item.tool?.state === "completed") return "success";
      if (entry.item.tool?.state === "started") return "info";
      if (entry.item.tool?.state === "progress") return "info";
      return entry.item.tone;
  }
}

function railDotClass(tone: Tone) {
  if (tone === "danger") return "border-destructive bg-destructive shadow-[0_0_0_4px_color-mix(in_oklab,var(--destructive)_18%,transparent)]";
  if (tone === "warning") return "border-warning bg-warning shadow-[0_0_0_4px_color-mix(in_oklab,var(--warning)_18%,transparent)]";
  if (tone === "success") return "border-success bg-success shadow-[0_0_0_4px_color-mix(in_oklab,var(--success)_16%,transparent)]";
  if (tone === "info") return "border-primary bg-primary shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_18%,transparent)]";
  return "border-muted-foreground/50 bg-muted-foreground/70";
}
function isConcreteRunningEntry(entry: RenderEntry) {
  if (entry.type === "tool_pair") return !entry.completed;
  if (entry.type === "plan_phase") return summarizePlanPhase(entry.items) === "running";
  if (entry.type === "single") return entry.item.tool?.state === "started" || entry.item.tool?.state === "progress";
  return false;
}

function isProviderRunFallback(entry: RenderEntry) {
  return entry.type === "single" && entry.item.kind === "provider_run" && entry.item.tone === "info";
}

function activeRailEntryIndex(entries: RenderEntry[]) {
  const concreteIndex = entries.findIndex(isConcreteRunningEntry);
  return concreteIndex >= 0 ? concreteIndex : entries.findIndex(isProviderRunFallback);
}


function railLineClass(tone: Tone) {
  if (tone === "danger") return "bg-destructive/45";
  if (tone === "warning") return "bg-warning/45";
  if (tone === "success") return "bg-success/40";
  if (tone === "info") return "bg-primary/45";
  return "bg-border/70";
}


function ActivityRailTimeline({ entries, active }: { entries: RenderEntry[]; active: boolean }) {
  const lastIdx = entries.length - 1;
  const activeIdx = active ? activeRailEntryIndex(entries) : -1;
  return (
    <div className="space-y-0.5">
      {entries.map((entry, index) => {
        const tone = railTone(entry);
        const detail = railDetail(entry);
        const isLast = index === lastIdx;
        const isActiveLatest = index === activeIdx;
        return (
          <article key={entry.key} className="relative grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 py-1.5">
            <div className="relative flex justify-center">
              {!isLast ? <span className={cn("absolute bottom-[-0.625rem] top-4 w-0.5 rounded-full", railLineClass(tone))} /> : null}
              {isActiveLatest
                ? <span aria-label="Latest activity running" className={cn("relative z-10 mt-0.5 size-3.5 rounded-full border-2 border-transparent border-t-current animate-spin", tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-primary")} />
                : <span className={cn("relative z-10 mt-1 size-2.5 rounded-full border", railDotClass(tone))} />}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold leading-snug text-foreground">{railTitle(entry)}</p>
              {detail ? <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">{detail}</p> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function ActivityTimeline({
  items,
  density = "detailed",
  active = false,
  transcript = false,
}: {
  items: WorkspaceActivityItem[];
  density?: "compact" | "detailed" | "rail";
  active?: boolean;
  transcript?: boolean;
}) {
  const renderList = buildRenderList(items, transcript);
  const rail = density === "rail";
  const compact = density === "compact";
  if (rail) return <ActivityRailTimeline entries={renderList} active={active} />;
  const lastIdx = renderList.length - 1;

  return (
    <div>
      {renderList.map((entry, idx) => {
        const isLast = idx === lastIdx;
        switch (entry.type) {
          case "run_divider":
            return <RunDividerRow key={entry.key} runNumber={entry.runNumber} restarted={entry.restarted} timestamp={entry.timestamp} />;
          case "node_header":
            return <NodeHeaderRow key={entry.key} nodeTitle={entry.nodeTitle} isLast={isLast} />;
          case "tool_pair":
            return <ToolPairRow key={entry.key} started={entry.started} progress={entry.progress} completed={entry.completed} isLast={isLast} compact={compact} />;
          case "plan_phase":
            return <PlanGenerationPhaseRow key={entry.key} items={entry.items} isLast={isLast} compact={compact} transcript={transcript} />;
          case "execution_header":
            return <ExecutionHeaderRow key={entry.key} />;
          case "single":
            return <SingleEventRow key={entry.key} item={entry.item} isLast={isLast} compact={compact} />;
        }
      })}
    </div>
  );
}
