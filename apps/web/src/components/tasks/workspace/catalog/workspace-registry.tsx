import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Archive, Bot, Check, ChevronDown, ChevronUp, Circle, FileText, Sparkles, TriangleAlert, Wrench } from "lucide-react";
import { defineRegistry } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { chronaCatalog } from "@chrona/ui-protocol";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | undefined;

function toneBadgeVariant(tone: Tone) {
  if (tone === "danger") return "destructive" as const;
  if (tone === "success" || tone === "info") return "secondary" as const;
  return "outline" as const;
}

function panelToneClassName(tone: Tone) {
  if (tone === "danger") return "border-destructive/40 bg-destructive/15";
  if (tone === "warning") return "border-warning/50 bg-warning/15";
  if (tone === "success") return "border-success/40 bg-success/15";
  if (tone === "info") return "border-info/40 bg-info/15";
  return "border-border bg-muted/60";
}

function workspaceIcon(icon: string | undefined) {
  if (icon === "archive") return Archive;
  if (icon === "file") return FileText;
  if (icon === "warning") return TriangleAlert;
  if (icon === "check") return Check;
  return Sparkles;
}

function activityIcon(kind: string | undefined, tone: Tone) {
  if (tone === "danger" || kind === "approval") return TriangleAlert;
  if (tone === "success") return Check;
  if (kind?.startsWith("tool_")) return Wrench;
  if (kind === "assistant_message" || kind === "reasoning") return Bot;
  if (kind === "artifact") return FileText;
  return Circle;
}

function activityIconClassName(tone: Tone) {
  if (tone === "danger") return "bg-destructive text-destructive-foreground ring-destructive/20";
  if (tone === "warning") return "bg-warning text-warning-foreground ring-warning/20";
  if (tone === "success") return "bg-success text-success-foreground ring-success/20";
  if (tone === "info") return "bg-primary text-primary-foreground ring-primary/20";
  return "bg-muted-foreground/80 text-background ring-muted-foreground/20";
}

const COLLAPSE_THRESHOLD = 360;
const PREVIEW_LENGTH = 280;

function CollapsibleText({ text, threshold = COLLAPSE_THRESHOLD }: { text: string; threshold?: number }) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = text.length > threshold;
  const visible = shouldCollapse && !expanded ? `${text.slice(0, PREVIEW_LENGTH).trimEnd()}...` : text;
  return (
    <div className="text-xs leading-[1.35] text-muted-foreground">
      <p className="whitespace-pre-wrap break-words">{visible}</p>
      {shouldCollapse ? (
        <Button type="button" variant="ghost" size="sm" className="mt-1 h-6 rounded-full px-2 text-[11px]" onClick={() => setExpanded((v) => !v)}>
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {expanded ? "Hide" : "Show more"}
        </Button>
      ) : null}
    </div>
  );
}

function WorkspaceArtifactList({
  emptyLabel,
  maxCollapsed = 4,
  showAllLabel,
  showFewerLabel,
  children,
}: {
  emptyLabel: string;
  maxCollapsed?: number;
  showAllLabel?: string;
  showFewerLabel?: string;
  children?: ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);
  const items = Array.isArray(children) ? children : children ? [children] : [];
  const hasOverflow = items.length > maxCollapsed;
  const visibleArtifacts = showAll ? items : items.slice(0, maxCollapsed);

  if (items.length === 0) {
    return <p className="mt-1.5 text-[13px] text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="mt-2 space-y-1.5">
      {visibleArtifacts.map((artifact, index) => <div key={index}>{artifact}</div>)}
      {hasOverflow ? (
        <button type="button" className="mt-1 text-xs font-semibold text-primary hover:text-primary/80" onClick={() => setShowAll((current) => !current)} aria-expanded={showAll}>
          {showAll ? (showFewerLabel ?? "Show fewer") : (showAllLabel ?? `Show all (${items.length})`)}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The Chrona workspace registry: standard primitives render with the prebuilt
 * `@json-render/shadcn` components (they inherit Chrona's Tailwind CSS-variable
 * theme); domain components (`Markdown`, `JsonView`, `FileRef`, `ResultSummary`,
 * `ActivityRow`, `ToolDetails`, `CollapsibleText`) render with Chrona JSX.
 *
 * Actions are declared required by the catalog but are only exercised by the
 * Node-action panel (Phase 3), which wires real dispatch via providers; until
 * then the handlers throw loudly if ever invoked (activity/result specs emit no
 * actions).
 */
export const { registry: workspaceRegistry } = defineRegistry(chronaCatalog, {
  components: {
    // standard primitives (shadcn)
    Card: shadcnComponents.Card,
    Stack: shadcnComponents.Stack,
    Separator: shadcnComponents.Separator,
    Text: shadcnComponents.Text,
    Heading: shadcnComponents.Heading,
    Badge: shadcnComponents.Badge,
    Alert: shadcnComponents.Alert,
    Button: shadcnComponents.Button,
    Link: shadcnComponents.Link,
    Input: shadcnComponents.Input,
    Textarea: shadcnComponents.Textarea,
    Select: shadcnComponents.Select,
    Tabs: shadcnComponents.Tabs,
    Table: shadcnComponents.Table,

    // domain components (Chrona)
    Markdown: ({ props }) => (
      <article className="rounded-xl border border-border/70 bg-background/95 px-3 py-2.5 text-sm leading-6 text-foreground shadow-sm">
        <div className="max-w-none space-y-2 break-words [&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline [&_blockquote]:rounded-lg [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:bg-primary-soft/45 [&_blockquote]:px-3 [&_blockquote]:py-2 [&_blockquote]:text-foreground/80 [&_code]:rounded-md [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.82em] [&_code]:text-foreground [&_h1]:font-heading [&_h1]:text-base [&_h1]:font-semibold [&_h1]:leading-tight [&_h2]:font-heading [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:leading-tight [&_h3]:text-sm [&_h3]:font-semibold [&_hr]:border-border [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_p]:text-foreground/85 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border/70 [&_pre]:bg-muted/70 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_strong]:text-foreground [&_table]:w-full [&_table]:overflow-hidden [&_table]:rounded-lg [&_td]:border-t [&_td]:border-border/70 [&_td]:px-2 [&_td]:py-1.5 [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.content}</ReactMarkdown>
        </div>
      </article>
    ),
    JsonView: ({ props }) => (
      <pre className="overflow-x-auto rounded-lg bg-muted/50 p-2 text-xs leading-5 text-foreground/80">
        {typeof props.value === "string" ? props.value : JSON.stringify(props.value, null, 2)}
      </pre>
    ),
    FileRef: ({ props }) => (
      <div className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm">
        <p className="font-medium text-foreground">{props.title ?? props.path}</p>
        <p className="break-all text-xs text-muted-foreground">{props.path}</p>
        {props.description ? <p className="mt-0.5 text-xs text-muted-foreground">{props.description}</p> : null}
      </div>
    ),
    ResultSummary: ({ props }) =>
      props.text ? <p className="text-sm leading-5 text-foreground/80">{props.text}</p> : null,
    ActivityRow: ({ props, children }) => {
      const tone = props.tone as Tone;
      const Icon = activityIcon(props.kind, tone);
      const compact = props.density === "compact";
      return (
        <article className="group relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3">
          <div className="relative flex justify-center">
            <span className="absolute -bottom-3 top-8 mx-auto w-px bg-border/50 group-last:hidden" />
            <span className={cn("relative z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ring-4 ring-background shadow-sm", activityIconClassName(tone))}>
              <Icon className="size-3.5" />
            </span>
          </div>
          <div className="min-w-0 pb-4 pt-0.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              {props.time ? <time className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/50">{props.time}</time> : null}
              <p className="min-w-0 break-words text-sm font-semibold leading-snug text-foreground">{props.title}</p>
              {props.toolState ? <Badge variant={toneBadgeVariant(tone)} className="gap-1 text-[10px]"><Wrench className="size-3" />{props.toolState}</Badge> : null}
            </div>
            {(props.sourceNodeTitle || props.provider || props.runtimeName) ? (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {props.sourceNodeTitle ? <Badge variant="outline" className="max-w-full truncate bg-background/80 text-[10px]">{props.sourceNodeTitle}</Badge> : null}
                {props.provider ? <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary">{props.provider}</span> : null}
                {props.runtimeName ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{props.runtimeName}</span> : null}
              </div>
            ) : null}
            {props.text ? <CollapsibleText text={props.text} threshold={compact ? 220 : undefined} /> : null}
            {children ? <div className="mt-1.5">{children}</div> : null}
          </div>
        </article>
      );
    },
    ToolDetails: ({ props }) => (
      <dl className="space-y-1.5 rounded-xl border border-border/50 bg-muted/35 p-2 text-xs">
        {props.rows.map((row) => (
          <div key={row.label} className="grid gap-1 sm:grid-cols-[72px_minmax(0,1fr)]">
            <dt className="font-semibold text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 break-words text-foreground/80">{row.value}</dd>
          </div>
        ))}
      </dl>
    ),
    CollapsibleText: ({ props }) => <CollapsibleText text={props.text} threshold={props.threshold} />,
    WorkspaceSummaryCard: ({ props, children }) => {
      const Icon = workspaceIcon(props.icon);
      return (
        <section className={cn("rounded-[1rem] border p-3 shadow-sm", panelToneClassName(props.tone as Tone))}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0">
                {props.eyebrow ? <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{props.eyebrow}</p> : null}
                <p className="break-words text-sm font-semibold text-foreground">{props.title}</p>
              </div>
            </div>
            {props.statusLabel ? <span className="shrink-0 rounded-full bg-background/85 px-2 py-0.5 text-xs font-medium text-muted-foreground">{props.statusLabel}</span> : null}
          </div>
          {props.sourceLabel ? <p className="mt-2 text-xs font-medium text-muted-foreground">{props.sourceLabel}</p> : null}
          {props.description ? <div className="mt-2 line-clamp-3 break-words rounded-xl bg-muted/50 px-2.5 py-2 text-[13px] leading-[1.45] text-foreground/80">{props.description}</div> : null}
          {children ? <div className="mt-2">{children}</div> : null}
        </section>
      );
    },
    WorkspaceArtifactList: ({ props, children }) => (
      <WorkspaceArtifactList emptyLabel={props.emptyLabel} maxCollapsed={props.maxCollapsed} showAllLabel={props.showAllLabel} showFewerLabel={props.showFewerLabel}>
        {children}
      </WorkspaceArtifactList>
    ),
    WorkspaceArtifactItem: ({ props, emit, on }) => {
      const locate = on("locate");
      return (
        <div className="rounded-xl bg-muted/45 px-2 py-1.5">
          <div className="flex w-full items-center gap-2 text-left">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <FileText className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block break-words text-sm font-medium text-foreground">{props.title}</span>
              <span className="block break-words text-xs text-muted-foreground">{props.type}</span>
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 pl-9 text-xs text-muted-foreground">
            {props.uri ? <span className="break-all">{props.uri}</span> : null}
            {locate.bound ? (
              <button type="button" className="font-semibold text-primary" onClick={() => emit("locate")}>
                {props.locateLabel}
              </button>
            ) : null}
          </div>
        </div>
      );
    },
    WorkspaceDiffPreview: ({ props }) => (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-foreground">Proposed Changes</h3>
            <p className="mt-1 text-sm text-muted-foreground">{props.summary}</p>
          </div>
          <Badge variant={props.confidence === "low" ? "outline" : "secondary"}>{props.confidence} confidence</Badge>
        </div>
        {props.risks.length > 0 ? (
          <div className="rounded-2xl border border-warning/30 bg-warning/15 px-4 py-3">
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
              <div>
                <p className="text-sm font-medium text-warning-foreground">High Risk Changes</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-warning-foreground/90">
                  {props.risks.map((risk, index) => <li key={`${risk}:${index}`}>{risk}</li>)}
                </ul>
              </div>
            </div>
          </div>
        ) : null}
        {props.warnings.length > 0 ? (
          <div className="space-y-1.5 rounded-2xl border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
            {props.warnings.map((warning, index) => (
              <div key={`${warning}:${index}`} className="flex items-start gap-1.5">
                <TriangleAlert className="mt-0.5 size-3 shrink-0 text-warning-foreground" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        ) : null}
        {props.taskDiffs.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Task Changes ({props.taskDiffs.length})</p>
            <div className="rounded-2xl border border-border/60 bg-background/80 p-3">
              {props.taskDiffs.map((diff) => {
                const changed = diff.original !== diff.proposed;
                return (
                  <div key={diff.key} className={cn("grid grid-cols-1 gap-2 border-b border-border/30 py-1.5 text-xs last:border-b-0 sm:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)]", changed && "-mx-2 bg-warning/10 px-2")}>
                    <span className="font-medium text-muted-foreground">{diff.label}</span>
                    <span className={cn("text-muted-foreground/70 line-through", changed && "text-destructive/60")}>{diff.original || <em>empty</em>}</span>
                    <span className={cn(changed && "font-medium text-success")}>{diff.proposed || <em>empty</em>}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {props.planSummary.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Plan Changes</p>
            <div className="space-y-2 rounded-2xl border border-border/60 bg-background/80 p-4">
              <Badge variant="secondary">plan patch</Badge>
              <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                {props.planSummary.map((point, index) => <li key={`${point}:${index}`}>{point}</li>)}
              </ul>
              {props.addedNodes.length > 0 ? (
                <div className="mt-2 space-y-1">
                  <p className="text-xs font-medium text-foreground">Nodes:</p>
                  {props.addedNodes.map((node, index) => (
                    <div key={`${node.title}:${index}`} className="rounded-lg border border-border/40 bg-muted/20 px-3 py-1.5 text-xs">
                      <span className="font-medium text-foreground">{node.title}</span>
                      {node.estimatedMinutes ? <span className="ml-2 text-muted-foreground">({node.estimatedMinutes}m)</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {props.deletedNodeIds.length > 0 ? (
                <div className="mt-2 text-xs text-destructive">
                  <span className="font-medium">To delete: </span>
                  {props.deletedNodeIds.join(", ")}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    ),
  },
  actions: {
    "dispatch-execution": async () => {
      throw new Error('[ui-protocol] action "dispatch-execution" is wired in Phase 3 (Node action).');
    },
    "submit-checkpoint": async () => {
      throw new Error('[ui-protocol] action "submit-checkpoint" is wired in Phase 3 (Node action).');
    },
    "locate-workspace-node": async () => {
      throw new Error('[ui-protocol] action "locate-workspace-node" requires a host handler.');
    },
  },
});
