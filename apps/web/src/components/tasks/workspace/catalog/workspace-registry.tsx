import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Archive, Bot, Check, ChevronDown, ChevronUp, Circle, FileText, Sparkles, TriangleAlert, Wrench } from "lucide-react";
import { ActivityTimeline } from "../../../../../../../features/execution-monitoring/ui/activity-timeline";
import type { WorkspaceActivityItem } from "../../../../../../../features/task-workspace";
import { defineRegistry } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { useI18n, useLocale } from "@chrona/i18n/react";
import { chronaCatalog } from "@chrona/ui-protocol";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { taskWorkspaceActivityMessages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

type OccurrenceOption = {
  value: string;
  label: string;
  taskId: string;
  date: string | null;
  workBlockId: string | null;
};

function isOccurrenceOption(value: unknown): value is OccurrenceOption {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as { value?: unknown }).value === "string"
    && typeof (value as { label?: unknown }).label === "string"
    && typeof (value as { taskId?: unknown }).taskId === "string"
    && (typeof (value as { date?: unknown }).date === "string" || (value as { date?: unknown }).date === null)
    && (typeof (value as { workBlockId?: unknown }).workBlockId === "string" || (value as { workBlockId?: unknown }).workBlockId === null);
}

function dateFromKey(date: string) {
  return new Date(`${date}T12:00:00`);
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function WorkspaceOccurrenceCalendar({ label, value, options }: { label: string; value: string; options: OccurrenceOption[] }) {
  const [open, setOpen] = useState(false);
  const locale = useLocale();
  const navigate = useNavigate();
  const current = options.find((option) => option.value === value) ?? options[0];
  const availableDates = new Set(options.flatMap((option) => option.date ? [option.date] : []));
  const selectedDate = current.date ? dateFromKey(current.date) : undefined;

  const navigateTo = (occurrence: OccurrenceOption) => {
    const search = occurrence.workBlockId ? `?workBlockId=${encodeURIComponent(occurrence.workBlockId)}` : "";
    void navigate({ pathname: `/${locale}/tasks/${occurrence.taskId}`, search });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 max-w-[20rem] rounded-full bg-background/80 px-2.5 text-xs font-medium">
          <span className="text-muted-foreground">{label}</span>
          <span className="min-w-0 truncate">{current.label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          mode="single"
          selected={selectedDate}
          defaultMonth={selectedDate}
          disabled={(date) => !availableDates.has(dateKey(date))}
          modifiers={{ occurrence: (date) => availableDates.has(dateKey(date)) }}
          modifiersClassNames={{ occurrence: "font-semibold text-primary" }}
          onSelect={(date) => {
            if (!date) return;
            const matches = options.filter((option) => option.date === dateKey(date));
            if (matches.length === 1) navigateTo(matches[0]);
          }}
        />
        <div className="max-h-40 space-y-1 overflow-y-auto border-t border-border/70 p-2">
          {options.filter((option) => option.date === (selectedDate ? dateKey(selectedDate) : current.date)).map((option) => (
            <Button key={option.value} type="button" variant={option.value === value ? "secondary" : "ghost"} size="sm" className="h-7 w-full justify-start rounded-md px-2 text-xs" onClick={() => navigateTo(option)}>
              {option.label}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
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
function formatFileSize(bytes: unknown) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function filePreviewErrorMessage(error: unknown, copy: Record<string, string | undefined>) {
  if (error === "unsafe_path") return copy.filePreviewUnsafePath ?? "File path is not allowed.";
  if (error === "not_found") return copy.filePreviewNotFound ?? "File was not found.";
  if (error === "unsupported_type") return copy.filePreviewUnsupportedType ?? "File type is not supported for preview.";
  if (error === "read_failed") return copy.filePreviewReadFailed ?? "File preview could not be loaded.";
  return null;
}
const EXPANDABLE_FILE_PREVIEW_MIN_LENGTH = 1200;


function FileView({ props }: { props: Record<string, unknown> }) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const title = typeof props.title === "string" ? props.title : undefined;
  const path = typeof props.displayPath === "string"
    ? props.displayPath
    : typeof props.uri === "string"
      ? props.uri
      : typeof props.path === "string"
        ? props.path
        : undefined;
  const content = typeof props.contentPreview === "string" ? props.contentPreview : undefined;
  const contentKind = typeof props.contentKind === "string" ? props.contentKind : undefined;
  const size = formatFileSize(props.contentBytes);
  const error = filePreviewErrorMessage(props.previewError, copy);
  const canExpand = Boolean(content && (content.length > EXPANDABLE_FILE_PREVIEW_MIN_LENGTH || props.contentTruncated));
  const [expanded, setExpanded] = useState(false);
  const previewHeightClassName = expanded ? "max-h-[70vh]" : "max-h-80";
  const expandLabel = expanded ? (copy.collapseFilePreview ?? "Collapse preview") : (copy.expandFilePreview ?? "Expand preview");

  return (
    <article className="rounded-lg border border-border bg-background px-2.5 py-2 text-sm">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <FileText className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words font-medium text-foreground">{title ?? path ?? "File"}</p>
          {path ? <p className="break-all text-xs text-muted-foreground">{path}</p> : null}
          <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
            {contentKind ? <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{contentKind}</Badge> : null}
            {size ? <span>{size}</span> : null}
            {props.contentTruncated ? <span>{copy.filePreviewTruncated ?? "Preview truncated"}</span> : null}
          </div>
        </div>
      </div>
      {error ? <p className="mt-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">{error}</p> : null}
      {content ? (
        <>
          {contentKind === "markdown" ? (
            <div className={cn("mt-2 overflow-auto rounded-lg border border-border/60 bg-background/95 px-3 py-2 text-sm leading-6 text-foreground", previewHeightClassName)}>
              <div className="max-w-none space-y-2 break-words [&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline [&_blockquote]:rounded-lg [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:bg-primary-soft/45 [&_blockquote]:px-3 [&_blockquote]:py-2 [&_blockquote]:text-foreground/80 [&_code]:rounded-md [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.82em] [&_code]:text-foreground [&_h1]:font-heading [&_h1]:text-base [&_h1]:font-semibold [&_h1]:leading-tight [&_h2]:font-heading [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:leading-tight [&_h3]:text-sm [&_h3]:font-semibold [&_hr]:border-border [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_p]:text-foreground/85 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:text-xs [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border/60 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border/60 [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            </div>
          ) : (
            <pre className={cn("mt-2 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-muted/50 p-2 text-xs leading-5 text-foreground/80", previewHeightClassName)}>{content}</pre>
          )}
          {canExpand ? (
            <Button type="button" variant="ghost" size="sm" className="mt-1 h-7 rounded-full px-2 text-[11px]" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
              {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              {expandLabel}
            </Button>
          ) : null}
        </>
      ) : null}
    </article>
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
function WorkspaceActionGroup({ label, layout = "inline", children }: { label?: string; layout?: "inline" | "stack"; children?: ReactNode }) {
  return (
    <section className="rounded-xl border border-border/60 bg-background/70 p-2.5 shadow-sm">
      {label ? <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p> : null}
      <div className={cn(layout === "inline" ? "flex flex-wrap gap-2" : "space-y-2")}>{children}</div>
    </section>
  );
}

function WorkspaceActionCard({ title, tone, children }: { title?: string; tone?: Tone; children?: ReactNode }) {
  return (
    <div className={cn("min-w-0 rounded-lg border bg-card/80 p-2.5 shadow-xs", panelToneClassName(tone))}>
      {title ? <p className="mb-2 text-xs font-semibold text-foreground">{title}</p> : null}
      <div className="space-y-2 [&_button]:h-8 [&_button]:rounded-lg [&_button]:px-3 [&_textarea]:min-h-20 [&_textarea]:text-sm">{children}</div>
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
    heading: shadcnComponents.Heading,
    DropdownMenu: shadcnComponents.DropdownMenu,
    paragraph: ({ props }) => <p className="text-sm leading-6 text-foreground/85">{props.text ?? props.content}</p>,
    table: shadcnComponents.Table,
    section: ({ props, children }) => (
      <section className="space-y-2 rounded-xl border border-border/60 bg-background/70 p-3">
        {props.title ? <h3 className="font-heading text-sm font-semibold text-foreground">{props.title}</h3> : null}
        {children}
      </section>
    ),

    WorkspaceOccurrenceCalendar: ({ props }) => {
      const rawOptions = Array.isArray(props.options) ? props.options : [];
      const options = rawOptions.filter(isOccurrenceOption);
      if (options.length <= 1) return null;
      return <WorkspaceOccurrenceCalendar label={typeof props.label === "string" ? props.label : "Occurrence"} value={typeof props.value === "string" ? props.value : options[0]?.value ?? ""} options={options} />;
    },

    WorkspaceActionGroup: ({ props, children }) => <WorkspaceActionGroup label={props.label} layout={props.layout}>{children}</WorkspaceActionGroup>,
    WorkspaceActionCard: ({ props, children }) => <WorkspaceActionCard title={props.title} tone={props.tone as Tone}>{children}</WorkspaceActionCard>,
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
    FileRef: ({ props }) => <FileView props={props} />,
    FileView: ({ props }) => <FileView props={props} />,
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
            {(props.sourceNodeTitle || props.provider) ? (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {props.sourceNodeTitle ? <Badge variant="outline" className="max-w-full truncate bg-background/80 text-[10px]">{props.sourceNodeTitle}</Badge> : null}
                {props.provider ? <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary">{props.provider}</span> : null}
              </div>
            ) : null}
            {props.text ? <CollapsibleText text={props.text} threshold={compact ? 220 : undefined} /> : null}
            {children ? <div className="mt-1.5">{children}</div> : null}
          </div>
        </article>
      );
    },
    ActivityStream: ({ props }) => {
      const items = Array.isArray(props.items) ? props.items as WorkspaceActivityItem[] : [];
      const liveCount = typeof props.liveCount === "number" ? props.liveCount : 0;
      const savedCount = typeof props.savedCount === "number" ? props.savedCount : items.length;
      return (
        <section>
          <div className="mb-3 text-xs text-muted-foreground">
            {items.length} shown · {liveCount} live · {savedCount} saved
          </div>
          {items.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-border/70 bg-background/70 px-3 py-4 text-center">
              <p className="text-sm font-medium text-foreground">{props.emptyMessage}</p>
              <p className="mt-1 text-xs text-muted-foreground">{taskWorkspaceActivityMessages.emptyHint}</p>
            </div>
          ) : (
            <div className={props.density === "rail" ? "mt-3" : "mt-4 pl-1"}>
              <ActivityTimeline items={items} density={props.density === "rail" ? "rail" : undefined} active={props.active === true} />
            </div>
          )}
        </section>
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
          <FileView props={props} />
          {locate.bound ? (
            <div className="mt-1 pl-9 text-xs">
              <button type="button" className="font-semibold text-primary" onClick={() => emit("locate")}>
                {props.locateLabel}
              </button>
            </div>
          ) : null}
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
    "command-center-primary": async () => {
      throw new Error('[ui-protocol] action "command-center-primary" requires a host handler.');
    },
    "accept-plan": async () => {
      throw new Error('[ui-protocol] action "accept-plan" requires a host handler.');
    },
    "regenerate-plan": async () => {
      throw new Error('[ui-protocol] action "regenerate-plan" requires a host handler.');
    },
    "dispatch-execution": async () => {
      throw new Error('[ui-protocol] action "dispatch-execution" is wired in Phase 3 (Node action).');
    },
    "submit-checkpoint": async () => {
      throw new Error('[ui-protocol] action "submit-checkpoint" is wired in Phase 3 (Node action).');
    },
    "locate-workspace-node": async () => {
      throw new Error('[ui-protocol] action "locate-workspace-node" requires a host handler.');
    },
    "recovery-retry": async () => {
      throw new Error('[ui-protocol] action "recovery-retry" requires a host handler.');
    },
    "recovery-edit-instruction": async () => {
      throw new Error('[ui-protocol] action "recovery-edit-instruction" requires a host handler.');
    },
    "recovery-cancel": async () => {
      throw new Error('[ui-protocol] action "recovery-cancel" requires a host handler.');
    },
  },
});