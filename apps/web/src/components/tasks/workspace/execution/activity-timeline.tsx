import { useState, type ReactNode } from "react";
import { Bot, Check, ChevronDown, ChevronUp, Circle, FileText, GitBranch, ListTree, Sparkles, TriangleAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkspaceActivityItem, WorkspaceActivityTone } from "../model/task-workspace-types";

// ─── Data model ───────────────────────────────────────────────────────────────

type Tone = WorkspaceActivityTone | undefined;

type RenderEntry =
  | { type: "node_header"; key: string; nodeTitle: string }
  | { type: "single"; key: string; item: WorkspaceActivityItem }
  | { type: "tool_pair"; key: string; started: WorkspaceActivityItem; completed?: WorkspaceActivityItem }
  | { type: "plan_phase"; key: string; items: WorkspaceActivityItem[] };

function isPlanGenerationEvent(item: WorkspaceActivityItem) {
  return item.rawEventType?.startsWith("plan_generation.") || item.id.includes("plan_generation.");
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

function collectPlanGenerationGroup(items: WorkspaceActivityItem[], startIndex: number) {
  const group = [items[startIndex]];
  let nextIndex = startIndex;
  while (items[nextIndex + 1] && isPlanGenerationEvent(items[nextIndex + 1])) {
    group.push(items[nextIndex + 1]);
    nextIndex++;
  }
  return { group, nextIndex };
}

function getToolPair(items: WorkspaceActivityItem[], item: WorkspaceActivityItem, index: number) {
  if (item.kind !== "tool_started") return undefined;
  const next = items.at(index + 1);
  const sameTool = next?.tool?.name === item.tool?.name || !item.tool?.name;
  if (next?.kind === "tool_completed" && next.sourceNodeId === item.sourceNodeId && sameTool) return next;
  return undefined;
}

/**
 * Flattens items into a render list:
 * - Inserts a synthetic node_header row when sourceNodeId changes (unless the
 *   item is already a "node" kind event, which serves as its own header).
 * - Merges consecutive tool_started + tool_completed pairs for the same tool.
 */
function buildRenderList(items: WorkspaceActivityItem[]): RenderEntry[] {
  const result: RenderEntry[] = [];
  let lastNodeId: string | undefined = undefined;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    lastNodeId = pushNodeHeader(result, item, lastNodeId);

    if (isPlanGenerationEvent(item)) {
      const { group, nextIndex } = collectPlanGenerationGroup(items, i);
      result.push({ type: "plan_phase", key: `plan:${group[0].id}:${group.length}`, items: group });
      i = nextIndex;
      continue;
    }

    const completedTool = getToolPair(items, item, i);
    if (completedTool) {
      result.push({ type: "tool_pair", key: item.id, started: item, completed: completedTool });
      i++;
      continue;
    }

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

function fmtTime(ts: string | null | undefined): string | undefined {
  return ts ? ts.slice(11, 19) : undefined;
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
    <div className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3">
      <SpineIcon tone="info" shape="rounded-md" isLast={isLast}>
        <GitBranch className="size-3.5" />
      </SpineIcon>
      <div className="flex min-w-0 items-center pb-3 pt-1">
        <span className="min-w-0 truncate rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
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
  const time = fmtTime(item.timestamp);
  const text = item.assistant?.text ?? (item.summary && item.summary !== item.title ? item.summary : undefined);
  const isNodeEvent = item.kind === "node";
  const iconTone: Tone = isNodeEvent ? "info" : tone;
  const tool = item.tool;
  const toolState = tool?.state;
  const hasToolDetails = !compact && !!(tool?.inputSummary || tool?.preview || tool?.error);

  return (
    <article className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3">
      <SpineIcon tone={iconTone} shape={isNodeEvent ? "rounded-md" : "rounded-full"} isLast={isLast}>
        <Icon className="size-3.5" />
      </SpineIcon>
      <div className="min-w-0 pb-4 pt-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {time && <time className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/50">{time}</time>}
          <p className="min-w-0 break-words text-sm font-semibold leading-snug text-foreground">{item.title}</p>
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
        {(item.provider || item.runtimeName) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {item.provider && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary">{item.provider}</span>}
            {item.runtimeName && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{item.runtimeName}</span>}
          </div>
        )}
        {text && <CollapsibleText text={text} compact={compact} />}
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
  completed,
  isLast,
  compact,
}: {
  started: WorkspaceActivityItem;
  completed?: WorkspaceActivityItem;
  isLast: boolean;
  compact: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const tool = completed?.tool ?? started.tool;
  const failed = completed?.tone === "danger" || tool?.state === "failed";
  const done = !!completed;
  const duration = fmtDuration(tool?.durationMs);
  const time = fmtTime(started.timestamp);
  const iconTone: Tone = failed ? "danger" : done ? "success" : "neutral";
  const hasDetails = !compact && !!(tool?.inputSummary || tool?.preview || tool?.error);

  return (
    <article className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3">
      <SpineIcon tone={iconTone} isLast={isLast}>
        <Wrench className="size-3.5" />
      </SpineIcon>
      <div className="min-w-0 pb-4 pt-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {time && <time className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/50">{time}</time>}
          <p className="min-w-0 flex-1 break-words text-sm font-semibold leading-snug text-foreground">
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
            <span className="shrink-0 animate-pulse rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              running…
            </span>
          )}
        </div>
        {hasDetails && (
          <div className="mt-1.5">
            <button
              type="button"
              className="flex items-center gap-0.5 text-[10px] text-muted-foreground/55 transition-colors hover:text-muted-foreground"
              onClick={() => setDetailsOpen((v) => !v)}
            >
              {detailsOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              details
            </button>
            {detailsOpen && (
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
        )}
      </div>
    </article>
  );
}

function PlanPhaseEvent({ item, compact }: { item: WorkspaceActivityItem; compact: boolean }) {
  const milestone = isPlanGenerationMilestone(item);
  const text = getPlanPhaseEventText(item);
  const time = fmtTime(item.timestamp);
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
}: {
  items: WorkspaceActivityItem[];
  isLast: boolean;
  compact: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
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
          {!expanded && (
            <p className="mt-2 text-xs text-muted-foreground">
              Planning phase {status} · {eventLabel}{duration ? ` · ${duration}` : ""}
            </p>
          )}
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

// ─── Main export ──────────────────────────────────────────────────────────────

export function ActivityTimeline({
  items,
  density = "detailed",
}: {
  items: WorkspaceActivityItem[];
  density?: "compact" | "detailed";
}) {
  const renderList = buildRenderList(items);
  const compact = density === "compact";
  const lastIdx = renderList.length - 1;

  return (
    <div>
      {renderList.map((entry, idx) => {
        const isLast = idx === lastIdx;
        switch (entry.type) {
          case "node_header":
            return <NodeHeaderRow key={entry.key} nodeTitle={entry.nodeTitle} isLast={isLast} />;
          case "tool_pair":
            return <ToolPairRow key={entry.key} started={entry.started} completed={entry.completed} isLast={isLast} compact={compact} />;
          case "plan_phase":
            return <PlanGenerationPhaseRow key={entry.key} items={entry.items} isLast={isLast} compact={compact} />;
          case "single":
            return <SingleEventRow key={entry.key} item={entry.item} isLast={isLast} compact={compact} />;
        }
      })}
    </div>
  );
}
