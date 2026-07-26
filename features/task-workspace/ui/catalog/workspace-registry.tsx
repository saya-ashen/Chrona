import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  Bot,
  ArrowRight,
  BookOpenText,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock3,
  Copy,
  Download,
  FileText,
  Eye,
  LockKeyhole,
  FileArchive,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  Sparkles,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import { ActivityTimeline } from "../activity-timeline";
import type { WorkspaceActivityItem } from "../../model/task-workspace-types";
import { MarkdownContent } from "../../../../shared/ui/markdown-content";
import { defineRegistry } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { useI18n, useLocale } from "@chrona/i18n";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useBoundProp } from "@json-render/react";
import { chronaCatalog } from "@chrona/ui-protocol";
import {
  Badge,
  Button,
  Checkbox,
  Field,
  FieldDescription,
  FieldLabel,
  Label,
  Calendar,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@shared/ui";
import { taskWorkspaceActivityMessages } from "@chrona/i18n";
import {
  approveResultFileAccess,
  requestResultFileAccess,
  type ResultFileAccessRequest,
} from "../../model/task-actions-client";

type OccurrenceOption = {
  value: string;
  label: string;
  taskId: string;
  date: string | null;
  workBlockId: string | null;
};

function isOccurrenceOption(value: unknown): value is OccurrenceOption {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { value?: unknown }).value === "string" &&
    typeof (value as { label?: unknown }).label === "string" &&
    typeof (value as { taskId?: unknown }).taskId === "string" &&
    (typeof (value as { date?: unknown }).date === "string" ||
      (value as { date?: unknown }).date === null) &&
    (typeof (value as { workBlockId?: unknown }).workBlockId === "string" ||
      (value as { workBlockId?: unknown }).workBlockId === null)
  );
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

function WorkspaceOccurrenceCalendar({
  label,
  value,
  options,
}: {
  label: string;
  value: string;
  options: OccurrenceOption[];
}) {
  const [open, setOpen] = useState(false);
  const locale = useLocale();
  const navigate = useNavigate();
  const current =
    options.find((option) => option.value === value) ?? options[0];
  const availableDates = new Set(
    options.flatMap((option) => (option.date ? [option.date] : [])),
  );
  const selectedDate = current.date ? dateFromKey(current.date) : undefined;

  const navigateTo = (occurrence: OccurrenceOption) => {
    const search = occurrence.workBlockId
      ? `?workBlockId=${encodeURIComponent(occurrence.workBlockId)}`
      : "";
    void navigate({
      pathname: `/${locale}/tasks/${occurrence.taskId}`,
      search,
    });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 max-w-[20rem] rounded-full bg-background/80 px-2.5 text-xs font-medium"
        >
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
          modifiers={{
            occurrence: (date) => availableDates.has(dateKey(date)),
          }}
          modifiersClassNames={{ occurrence: "font-semibold text-primary" }}
          onSelect={(date) => {
            if (!date) return;
            const matches = options.filter(
              (option) => option.date === dateKey(date),
            );
            if (matches.length === 1) navigateTo(matches[0]);
          }}
        />
        <div className="max-h-40 space-y-1 overflow-y-auto border-t border-border/70 p-2">
          {options
            .filter(
              (option) =>
                option.date ===
                (selectedDate ? dateKey(selectedDate) : current.date),
            )
            .map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={option.value === value ? "secondary" : "ghost"}
                size="sm"
                className="h-7 w-full justify-start rounded-md px-2 text-xs"
                onClick={() => navigateTo(option)}
              >
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
  if (tone === "danger")
    return "bg-destructive text-destructive-foreground ring-destructive/20";
  if (tone === "warning")
    return "bg-warning text-warning-foreground ring-warning/20";
  if (tone === "success")
    return "bg-success text-success-foreground ring-success/20";
  if (tone === "info")
    return "bg-primary text-primary-foreground ring-primary/20";
  return "bg-muted-foreground/80 text-background ring-muted-foreground/20";
}

const COLLAPSE_THRESHOLD = 360;
const PREVIEW_LENGTH = 280;

function CollapsibleText({
  text,
  threshold = COLLAPSE_THRESHOLD,
}: {
  text: string;
  threshold?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = text.length > threshold;
  const visible =
    shouldCollapse && !expanded
      ? `${text.slice(0, PREVIEW_LENGTH).trimEnd()}...`
      : text;
  return (
    <div className="text-xs leading-[1.35] text-muted-foreground">
      <p className="whitespace-pre-wrap break-words">{visible}</p>
      {shouldCollapse ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 h-6 rounded-full px-2 text-[11px]"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
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

function filePreviewErrorMessage(
  error: unknown,
  copy: Record<string, string | undefined>,
) {
  if (error === "unsafe_path")
    return copy.filePreviewUnsafePath ?? "File path is not allowed.";
  if (error === "not_found")
    return copy.filePreviewNotFound ?? "File was not found.";
  if (error === "unsupported_type")
    return (
      copy.filePreviewUnsupportedType ??
      "File type is not supported for preview."
    );
  if (error === "read_failed")
    return copy.filePreviewReadFailed ?? "File preview could not be loaded.";
  return null;
}
const EXPANDABLE_FILE_PREVIEW_MIN_LENGTH = 1200;
type CollapsibleProps = {
  title?: string | null;
  summary?: string | null;
  defaultCollapsed?: boolean | null;
};

function stringProp(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

const AUTO_COLLAPSE_MARKDOWN_LENGTH = 4000;
const AUTO_COLLAPSE_JSON_LENGTH = 2000;
const AUTO_COLLAPSE_FILE_BYTES = 32 * 1024;

function boolProp(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

export type ResultCollapseCommand = {
  mode: "collapse" | "expand";
  revision: number;
};

type ResultCollapseContextValue = {
  command: ResultCollapseCommand | null;
  storageKey: string | null;
};

const ResultCollapseContext = createContext<ResultCollapseContextValue>({
  command: null,
  storageKey: null,
});

const RESULT_COLLAPSE_STORAGE_PREFIX = "chrona.resultCollapse";

function collapseStorageKey(storageKey: string) {
  return `${RESULT_COLLAPSE_STORAGE_PREFIX}:${storageKey}`;
}

function readStoredCollapseState(
  storageKey: string | null,
  storageId: string | undefined,
) {
  if (!storageKey || !storageId || typeof window === "undefined")
    return undefined;
  try {
    const raw = window.localStorage.getItem(collapseStorageKey(storageKey));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed[storageId];
    return typeof value === "boolean" ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredCollapseState(
  storageKey: string | null,
  storageId: string | undefined,
  collapsed: boolean,
) {
  if (!storageKey || !storageId || typeof window === "undefined") return;
  try {
    const key = collapseStorageKey(storageKey);
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.localStorage.setItem(
      key,
      JSON.stringify({ ...parsed, [storageId]: collapsed }),
    );
  } catch {
    // Storage is best-effort; the in-memory collapsed state still updates.
  }
}

export function ResultCollapseProvider({
  command,
  storageKey,
  children,
}: {
  command?: ResultCollapseCommand | null;
  storageKey?: string | null;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ command: command ?? null, storageKey: storageKey ?? null }),
    [command, storageKey],
  );
  return (
    <ResultCollapseContext.Provider value={value}>
      {children}
    </ResultCollapseContext.Provider>
  );
}

function collapseStorageIdFromProps(props: Record<string, unknown>) {
  return stringProp(props.__chronaCollapseStorageId);
}

function shouldCollapseByDefault(
  props: Record<string, unknown>,
  fallback: boolean,
) {
  return boolProp(props.defaultCollapsed) ?? fallback;
}
function CollapsibleBlock({
  title,
  summary,
  defaultCollapsed,
  storageId,
  subtle = false,
  children,
}: CollapsibleProps & {
  storageId?: string;
  subtle?: boolean;
  children?: ReactNode;
}) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const { command, storageKey } = useContext(ResultCollapseContext);
  const defaultState = Boolean(defaultCollapsed);
  const [collapsed, setCollapsedState] = useState(
    () => readStoredCollapseState(storageKey, storageId) ?? defaultState,
  );
  const setCollapsed = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      setCollapsedState((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        writeStoredCollapseState(storageKey, storageId, resolved);
        return resolved;
      });
    },
    [storageKey, storageId],
  );
  useEffect(() => {
    setCollapsedState(
      readStoredCollapseState(storageKey, storageId) ?? defaultState,
    );
  }, [storageKey, storageId, defaultState]);
  useEffect(() => {
    if (!command) return;
    setCollapsed(command.mode === "collapse");
  }, [command?.mode, command?.revision, setCollapsed]);
  const label = title || (copy.resultDetailsLabel ?? "Details");

  return (
    <section
      className={cn(
        "min-w-0 w-full max-w-full overflow-hidden text-sm",
        subtle
          ? "border-t border-border/60 py-3 first:border-t-0 first:pt-0"
          : "rounded-xl border border-border/70 bg-muted/45 px-3 py-2.5",
      )}
    >
      <button
        type="button"
        className="flex w-full min-w-0 max-w-full items-center justify-between gap-2 text-left"
        onClick={() => setCollapsed((current) => !current)}
        aria-expanded={!collapsed}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">
            {label}
          </span>
          {summary ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {summary}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-muted-foreground">
          {collapsed
            ? (copy.showResultDetails ?? "Show")
            : (copy.hideResultDetails ?? "Hide")}
          {collapsed ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronUp className="size-3.5" />
          )}
        </span>
      </button>
      {collapsed ? null : (
        <div
          className={cn(
            "min-w-0 w-full max-w-full overflow-hidden space-y-2",
            subtle ? "mt-3" : "mt-2",
          )}
        >
          {children}
        </div>
      )}
    </section>
  );
}

function shouldWrapCollapsible(
  props: Record<string, unknown>,
  fallbackCollapsed?: boolean,
) {
  const explicit = boolProp(props.collapsible);
  const hasDefaultCollapsedPreference =
    props.defaultCollapsed === true || props.defaultCollapsed === false;
  return (
    explicit ?? Boolean(fallbackCollapsed || hasDefaultCollapsedPreference)
  );
}

function contentPropsWithoutTitle(
  props: Record<string, unknown>,
  fallbackCollapsed?: boolean,
): Record<string, unknown> {
  if (!shouldWrapCollapsible(props, fallbackCollapsed)) return props;
  const { title: _title, ...contentProps } = props;
  return contentProps;
}

function MaybeCollapsible({
  props,
  fallbackCollapsed,
  fallbackTitle,
  children,
}: {
  props: Record<string, unknown>;
  fallbackCollapsed?: boolean;
  fallbackTitle?: string;
  children: ReactNode;
}) {
  if (!shouldWrapCollapsible(props, fallbackCollapsed)) return <>{children}</>;
  const title =
    stringProp(props.collapseTitle) ?? stringProp(props.title) ?? fallbackTitle;
  const summary = stringProp(props.collapsedSummary);
  return (
    <CollapsibleBlock
      title={title}
      summary={summary}
      defaultCollapsed={shouldCollapseByDefault(
        props,
        Boolean(fallbackCollapsed),
      )}
      storageId={collapseStorageIdFromProps(props)}
    >
      {children}
    </CollapsibleBlock>
  );
}

function ResultSummary({
  props,
}: {
  props: { text?: string | null; copyText?: string | null };
}) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const [copied, setCopied] = useState(false);
  const text = typeof props.text === "string" ? props.text.trim() : "";
  const copyText =
    typeof props.copyText === "string" && props.copyText.trim()
      ? props.copyText
      : text;
  if (!text) return null;

  const copyLabel = copied
    ? (copy.resultSummaryCopied ?? "Copied")
    : (copy.copyResultSummary ?? "Copy summary");

  return (
    <section
      aria-label={copy.resultSummaryLabel ?? "Result summary"}
      className="space-y-2.5 border-b border-border/70 pb-3.5 text-foreground"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary ring-1 ring-primary/20">
            <Check className="size-3.5" aria-hidden="true" />
          </span>
          <h2 className="font-heading text-[1.05rem] font-semibold leading-none tracking-[-0.01em] text-foreground sm:text-lg">
            {copy.resultSummaryLabel ?? "Result summary"}
          </h2>
        </div>
        {copyText ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 rounded-full px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => {
              void navigator.clipboard?.writeText(copyText).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1400);
              });
            }}
          >
            <Copy className="size-3.5" aria-hidden="true" />
            {copyLabel}
          </Button>
        ) : null}
      </div>
      <p className="max-w-3xl text-[15px] font-normal leading-7 text-foreground/80 tracking-[-0.005em]">
        {text}
      </p>
    </section>
  );
}

type ResultMetric = { label: string; value: string };
type ResultActionPhase = {
  timeframe: "now" | "this_week" | "later";
  title: string;
  actions: string[];
};

const readinessPresentation = {
  ready: {
    messageKey: "resultReadinessReady",
    fallback: "Ready",
    className: "border-success/30 bg-success/10 text-success dark:text-success-foreground",
    iconClassName: "bg-success/15 text-success",
  },
  ready_with_caveats: {
    messageKey: "resultReadinessReadyWithCaveats",
    fallback: "Ready with caveats",
    className: "border-warning/35 bg-warning/10 text-warning dark:text-warning-foreground",
    iconClassName: "bg-warning/15 text-warning",
  },
  partial: {
    messageKey: "resultReadinessPartial",
    fallback: "Partially ready",
    className: "border-info/30 bg-info/10 text-info dark:text-info-foreground",
    iconClassName: "bg-info/15 text-info",
  },
  blocked: {
    messageKey: "resultReadinessBlocked",
    fallback: "Blocked",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    iconClassName: "bg-destructive/10 text-destructive",
  },
} as const;

function ResultHero({
  props,
}: {
  props: {
    title: string;
    summary: string;
    readiness: keyof typeof readinessPresentation;
    readinessSummary: string;
    metrics?: ResultMetric[];
  };
}) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const presentation = readinessPresentation[props.readiness];
  const readinessLabel = {
    ready: copy.resultReadinessReady ?? "Ready",
    ready_with_caveats:
      copy.resultReadinessReadyWithCaveats ?? "Ready with caveats",
    partial: copy.resultReadinessPartial ?? "Partially ready",
    blocked: copy.resultReadinessBlocked ?? "Blocked",
  }[props.readiness];
  const metrics = Array.isArray(props.metrics) ? props.metrics.slice(0, 4) : [];
  return (
    <section
      aria-label={copy.resultOverviewLabel ?? "Result overview"}
      className="min-w-0 overflow-hidden rounded-2xl border border-primary/15 bg-primary-soft/25 p-5 shadow-sm sm:p-6"
    >
      <div className="min-w-0">
        <Badge
          variant="outline"
          className={cn(
            "mb-4 gap-1.5 rounded-full px-2.5 py-1 text-xs",
            presentation.className,
          )}
        >
          <Check className="size-3.5" aria-hidden />
          {readinessLabel}
        </Badge>
        <h2 className="w-full font-heading text-2xl font-semibold leading-tight tracking-[-0.025em] text-foreground sm:text-[1.75rem]">
          {props.title}
        </h2>
        <p className="mt-3 w-full text-sm leading-6 text-foreground/75 sm:text-[15px] sm:leading-7">
          {props.summary}
        </p>
        <div className="mt-5 flex flex-col gap-4 border-t border-border/60 pt-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg",
                presentation.iconClassName,
              )}
            >
              {props.readiness === "blocked" ? (
                <TriangleAlert className="size-4" aria-hidden />
              ) : (
                <Check className="size-4" aria-hidden />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {copy.resultReadinessLabel ?? "Readiness"}
              </p>
              <p className="mt-1 text-sm leading-6 text-foreground/80">
                {props.readinessSummary}
              </p>
            </div>
          </div>
          {metrics.length > 0 ? (
            <dl className="grid shrink-0 grid-cols-2 gap-x-5 gap-y-3 sm:max-w-xl sm:grid-cols-4">
              {metrics.map((metric) => (
                <div key={`${metric.label}:${metric.value}`} className="min-w-0">
                  <dd className="truncate font-heading text-lg font-semibold tracking-[-0.02em] text-foreground">
                    {metric.value}
                  </dd>
                  <dt className="mt-0.5 text-xs leading-4 text-muted-foreground">
                    {metric.label}
                  </dt>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function deliverableIcon(kind: string) {
  if (kind === "table" || kind === "dataset") return FileSpreadsheet;
  if (kind === "image") return FileImage;
  if (kind === "archive") return FileArchive;
  if (kind === "code") return FileCode2;
  return FileText;
}

function ResultDeliverable({ props }: { props: Record<string, unknown> }) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const title = stringProp(props.title) ?? "Deliverable";
  const summary = stringProp(props.summary);
  const role = stringProp(props.role) ?? "supporting";
  const kind = stringProp(props.kind) ?? "other";
  const formatLabel = stringProp(props.formatLabel) ?? kind;
  const Icon = deliverableIcon(kind);
  const [previewOpen, setPreviewOpen] = useState(false);
  const preview = stringProp(props.contentPreview);
  const downloadHref = stringProp(props.downloadHref);
  const isPrimary = role === "primary";
  const roleLabel = isPrimary
    ? (copy.resultPrimaryDeliverable ?? "Primary deliverable")
    : role === "evidence"
      ? (copy.resultEvidenceMaterial ?? "Evidence")
      : (copy.resultSupportingMaterial ?? "Supporting material");
  return (
    <>
      <article
        data-result-deliverable-role={role}
        className={cn(
          "group min-w-0 overflow-hidden rounded-xl border transition-colors",
          isPrimary
            ? "border-primary/25 bg-primary-soft/45 p-5 sm:p-6"
            : "border-border/70 bg-background p-4 hover:border-primary/25",
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "flex shrink-0 items-center justify-center rounded-lg",
              isPrimary
                ? "size-10 bg-primary text-primary-foreground"
                : "size-9 bg-muted text-muted-foreground",
            )}
          >
            <Icon className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {roleLabel} · {formatLabel}
            </p>
            <h3
              className={cn(
                "mt-1.5 break-words font-heading font-semibold leading-snug tracking-[-0.015em] text-foreground",
                isPrimary ? "text-xl sm:text-2xl" : "text-base",
              )}
            >
              {title}
            </h3>
            {summary ? (
              <p
                className={cn(
                  "mt-2 text-foreground/70",
                  isPrimary
                    ? "max-w-2xl text-sm leading-6"
                    : "text-xs leading-5",
                )}
              >
                {summary}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              {preview ? (
                <Button
                  type="button"
                  size="sm"
                  variant={isPrimary ? "default" : "outline"}
                  onClick={() => setPreviewOpen(true)}
                >
                  <Eye className="size-3.5" aria-hidden />
                  {copy.artifactPreview ?? "Preview"}
                </Button>
              ) : null}
              {downloadHref ? (
                <Button
                  asChild
                  size="sm"
                  variant={isPrimary ? "outline" : "ghost"}
                >
                  <a href={downloadHref} download>
                    <Download className="size-3.5" aria-hidden />
                    {copy.downloadArtifact ?? "Download"}
                  </a>
                </Button>
              ) : null}
            </div>
          </div>
          {!isPrimary ? (
            <ArrowRight
              className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
              aria-hidden
            />
          ) : null}
        </div>
      </article>
      {preview ? (
        <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
          <SheetContent
            side="right"
            showCloseButton={false}
            className="inset-y-4! left-0! right-0! mx-auto flex h-auto! w-[calc(100vw-2rem)]! max-w-[70rem]! flex-col gap-0 overflow-hidden rounded-2xl border p-0 shadow-2xl sm:inset-y-6! sm:w-[calc(100vw-3rem)]!"
            data-result-content-preview
          >
            <SheetHeader className="shrink-0 border-b px-4 py-3 sm:px-5">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <SheetTitle className="truncate">{title}</SheetTitle>
                    <SheetDescription className="flex flex-wrap items-center gap-1.5">
                      <span>{copy.resultContentPreview ?? "Content preview"}</span>
                      <span aria-hidden>·</span>
                      <span>{formatLabel}</span>
                    </SheetDescription>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {downloadHref ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={downloadHref} download>
                        <Download className="size-3.5" aria-hidden />
                        <span className="hidden sm:inline">
                          {copy.downloadArtifact ?? "Download"}
                        </span>
                      </a>
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={copy.closeResultPreview ?? "Close preview"}
                    onClick={() => setPreviewOpen(false)}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            </SheetHeader>
            <main className="min-h-0 flex-1 overflow-y-auto bg-background p-4 sm:p-6 xl:p-8">
              <div className="mx-auto w-full max-w-4xl">
                {summary ? (
                  <p className="mb-5 border-b border-border/60 pb-4 text-sm leading-6 text-muted-foreground">
                    {summary}
                  </p>
                ) : null}
                {props.contentKind === "markdown" ? (
                  <MarkdownContent className="py-0">{preview}</MarkdownContent>
                ) : (
                  <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground/85">
                    {preview}
                  </pre>
                )}
              </div>
            </main>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}

function ResultInsight({
  props,
}: {
  props: {
    title: string;
    summary: string;
    emphasis?: "lead" | "supporting";
    points?: string[];
  };
}) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const lead = props.emphasis === "lead";
  if (lead) {
    return (
      <article
        data-result-insight-emphasis="lead"
        className="min-w-0 overflow-hidden rounded-2xl border border-info/30 bg-info/10"
      >
        <div className="grid min-w-0 gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(22rem,1.1fr)]">
          <div className="min-w-0 p-5 sm:p-7 lg:border-r lg:border-info/20">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-info">
              <span className="flex size-7 items-center justify-center rounded-full bg-info/15">
                <Sparkles className="size-3.5" aria-hidden />
              </span>
              {copy.resultKeyStrategy ?? "Key strategy"}
            </p>
            <h2 className="mt-5 font-heading text-2xl font-semibold leading-tight tracking-[-0.025em] text-foreground sm:text-[1.75rem]">
              {props.title}
            </h2>
            <p className="mt-3 text-sm leading-6 text-foreground/75 sm:text-[15px] sm:leading-7">
              {props.summary}
            </p>
          </div>
          {props.points?.length ? (
            <ol className="grid content-center gap-0 border-t border-info/20 px-5 py-3 sm:px-7 lg:border-t-0">
              {props.points.slice(0, 4).map((point, index) => (
                <li
                  key={point}
                  className="flex gap-3 border-t border-info/20 py-3.5 text-sm leading-6 text-foreground/80 first:border-t-0"
                >
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-info/30 bg-background/70 text-[11px] font-semibold text-info">
                    {index + 1}
                  </span>
                  <span>{point}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </article>
    );
  }
  return (
    <article className="min-w-0 rounded-xl border border-border/70 bg-background p-4 sm:p-5">
      <h3 className="font-heading text-base font-semibold leading-snug tracking-[-0.015em] text-foreground">
        {props.title}
      </h3>
      <p className="mt-2 text-sm leading-6 text-foreground/70">
        {props.summary}
      </p>
      {props.points?.length ? (
        <ul className="mt-4 space-y-2 text-xs leading-5 text-foreground/75">
          {props.points.slice(0, 4).map((point) => (
            <li key={point} className="flex gap-2">
              <Check
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function ResultActionPlan({
  props,
}: {
  props: { title?: string; summary?: string; phases: ResultActionPhase[] };
}) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const timeframeLabels = {
    now: copy.resultTimeframeNow ?? "Now",
    this_week: copy.resultTimeframeThisWeek ?? "This week",
    later: copy.resultTimeframeLater ?? "Later",
  };
  return (
    <section
      aria-label={props.title ?? copy.resultActionPlan ?? "Action plan"}
      className="min-w-0"
    >
      {props.title ? (
        <h2 className="font-heading text-xl font-semibold tracking-[-0.02em] text-foreground">
          {props.title}
        </h2>
      ) : null}
      {props.summary ? (
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
          {props.summary}
        </p>
      ) : null}
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {props.phases.slice(0, 3).map((phase, index) => (
          <article
            key={phase.timeframe}
            className="rounded-xl border border-border/70 bg-background p-4"
          >
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-primary">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary-soft text-[11px]">
                {index + 1}
              </span>
              {timeframeLabels[phase.timeframe]}
            </p>
            <h3 className="mt-3 font-heading text-base font-semibold text-foreground">
              {phase.title}
            </h3>
            <ul className="mt-3 space-y-2 text-sm leading-5 text-foreground/75">
              {phase.actions.slice(0, 5).map((action) => (
                <li key={action} className="flex gap-2">
                  <Clock3
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span>{action}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

function ResultCaveats({
  props,
}: {
  props: { title?: string; items: string[] };
}) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const title = props.title ?? copy.resultCaveats ?? "Before accepting";
  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col gap-4 rounded-xl border border-warning/30 bg-warning/10 p-4 sm:flex-row sm:items-start"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
        <TriangleAlert className="size-4.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <h2 className="font-heading text-base font-semibold text-foreground">
          {title}
        </h2>
        <ul className="mt-2 grid gap-1.5 text-sm leading-5 text-foreground/80 sm:grid-cols-2 lg:grid-cols-3">
          {props.items.slice(0, 3).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ResultEvidence({
  props,
}: {
  props: {
    title?: string;
    summary?: string;
    items: string[];
    defaultCollapsed?: boolean;
  };
}) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  return (
    <div data-result-evidence-footnote className="text-muted-foreground">
      <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em]">
        <BookOpenText className="size-3.5" aria-hidden />
        {copy.resultEvidenceFootnote ?? "Result notes"}
      </div>
      <CollapsibleBlock
        title={
          props.title ??
          copy.resultEvidenceAndSources ??
          "Evidence and source boundaries"
        }
        summary={props.summary}
        defaultCollapsed={props.defaultCollapsed ?? true}
        subtle
      >
        <ul className="space-y-1.5 text-xs leading-5 text-muted-foreground">
          {props.items.map((item) => (
            <li key={item} className="flex gap-2">
              <span
                aria-hidden
                className="mt-[0.45rem] size-1 shrink-0 rounded-full bg-muted-foreground/60"
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </CollapsibleBlock>
    </div>
  );
}

function FileView({ props }: { props: Record<string, unknown> }) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const title = typeof props.title === "string" ? props.title : undefined;
  const path =
    typeof props.displayPath === "string"
      ? props.displayPath
      : typeof props.uri === "string"
        ? props.uri
        : typeof props.path === "string"
          ? props.path
          : undefined;
  const content =
    typeof props.contentPreview === "string" ? props.contentPreview : undefined;
  const contentKind =
    typeof props.contentKind === "string" ? props.contentKind : undefined;
  const error = filePreviewErrorMessage(props.previewError, copy);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const accessTaskId =
    typeof props.accessTaskId === "string" ? props.accessTaskId : null;
  const accessRequestedPath =
    typeof props.accessRequestedPath === "string"
      ? props.accessRequestedPath
      : null;
  const [accessRequest, setAccessRequest] =
    useState<ResultFileAccessRequest | null>(null);
  const [accessState, setAccessState] = useState<
    "idle" | "requesting" | "approving" | "granted" | "error"
  >("idle");
  const [accessError, setAccessError] = useState<string | null>(null);
  const [authorizedPreview, setAuthorizedPreview] = useState<{
    displayPath?: string;
    contentKind?: "markdown" | "json" | "text" | "csv";
    contentPreview?: string;
    contentTruncated?: boolean;
    contentBytes?: number;
    previewError?: string;
  } | null>(null);
  const visibleContent = authorizedPreview?.contentPreview ?? content;
  const visibleContentKind = authorizedPreview?.contentKind ?? contentKind;
  const visibleSize = formatFileSize(
    authorizedPreview?.contentBytes ?? props.contentBytes,
  );
  const visibleError = authorizedPreview
    ? filePreviewErrorMessage(authorizedPreview.previewError, copy)
    : error;
  const requestAccess = async () => {
    if (!accessTaskId || !accessRequestedPath) return;
    setAccessState("requesting");
    setAccessError(null);
    try {
      const request = await requestResultFileAccess({
        taskId: accessTaskId,
        path: accessRequestedPath,
      });
      setAccessRequest(request);
      setAccessState(request.status === "already_allowed" ? "granted" : "idle");
    } catch (cause) {
      setAccessState("error");
      setAccessError(
        cause instanceof Error
          ? cause.message
          : (copy.fileAccessRequestFailed ?? "Failed to request file access."),
      );
    }
  };
  const approveAccess = async () => {
    if (!accessTaskId || !accessRequest?.requestId) return;
    setAccessState("approving");
    setAccessError(null);
    try {
      const result = await approveResultFileAccess({
        taskId: accessTaskId,
        requestId: accessRequest.requestId,
      });
      setAuthorizedPreview(result.preview);
      setAccessState("granted");
      setPreviewOpen(true);
    } catch (cause) {
      setAccessState("error");
      setAccessError(
        cause instanceof Error
          ? cause.message
          : (copy.fileAccessApprovalFailed ??
              "Failed to read the approved file."),
      );
    }
  };
  const canExpand = Boolean(
    visibleContent &&
    (visibleContent.length > EXPANDABLE_FILE_PREVIEW_MIN_LENGTH ||
      authorizedPreview?.contentTruncated ||
      props.contentTruncated),
  );
  const previewHeightClassName =
    canExpand && previewOpen ? "max-h-[70vh]" : "max-h-80";
  const previewLabel = previewOpen
    ? (copy.artifactHidePreview ?? "Hide preview")
    : (copy.artifactPreview ?? "Preview");
  const copyPathLabel = copied
    ? (copy.artifactPathCopied ?? "Copied")
    : (copy.copyArtifactPath ?? "Copy path");

  return (
    <article className="min-w-0 w-full max-w-full border-t border-border/60 py-2 text-sm first:border-t-0">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words font-medium text-foreground">
            {title ?? path ?? "File"}
          </p>
          {path ? (
            <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
              {path}
            </p>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
            {visibleContentKind ? (
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                {visibleContentKind}
              </Badge>
            ) : null}
            {visibleSize ? <span>{visibleSize}</span> : null}
            {props.contentTruncated ? (
              <span>{copy.filePreviewTruncated ?? "Preview truncated"}</span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {visibleContent ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-full px-2 text-[11px]"
              onClick={() => setPreviewOpen((current) => !current)}
              aria-expanded={previewOpen}
            >
              {previewOpen ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
              {previewLabel}
            </Button>
          ) : null}
          {props.previewError === "permission_required" &&
          accessTaskId &&
          accessRequestedPath ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 rounded-full px-2 text-[11px]"
              disabled={
                accessState === "requesting" || accessState === "approving"
              }
              onClick={() => void requestAccess()}
            >
              <LockKeyhole className="size-3.5" aria-hidden />
              {accessState === "requesting"
                ? (copy.fileAccessChecking ?? "Checking...")
                : (copy.fileAccessRequest ?? "Request access")}
            </Button>
          ) : null}
          {typeof props.downloadHref === "string" ? (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-7 rounded-full px-2 text-[11px]"
            >
              <a href={props.downloadHref} download>
                {copy.downloadArtifact ?? "Download"}
              </a>
            </Button>
          ) : null}
          {path ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-full px-2 text-[11px]"
              onClick={() => {
                void navigator.clipboard?.writeText(path).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1400);
                });
              }}
            >
              {copyPathLabel}
            </Button>
          ) : null}
        </div>
      </div>
      {visibleError && props.previewError !== "permission_required" ? (
        <p className="mt-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
          {visibleError}
        </p>
      ) : null}
      {props.previewError === "permission_required" && !accessRequest ? (
        <p className="mt-2 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-xs text-foreground/80">
          {copy.fileAccessRequired ??
            "This file is outside Chrona's generated-file directory. Review the path before allowing a one-time read."}
        </p>
      ) : null}
      {accessRequest?.status === "permission_required" &&
      accessState !== "granted" ? (
        <div
          className="mt-2 space-y-2 rounded-lg border border-warning/35 bg-warning/10 p-3 text-xs"
          role="group"
          aria-label={copy.fileAccessReviewLabel ?? "File access review"}
        >
          <p className="font-medium text-foreground">
            {copy.fileAccessReviewTitle ??
              "Allow Chrona to read this file once?"}
          </p>
          <p className="break-all font-mono text-[11px] text-muted-foreground">
            {accessRequest.canonicalPath}
          </p>
          <div className="flex flex-wrap gap-2 text-muted-foreground">
            {accessRequest.extension ? (
              <span>{accessRequest.extension}</span>
            ) : null}
            {typeof accessRequest.size === "number" ? (
              <span>{formatFileSize(accessRequest.size)}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={accessState === "approving"}
              onClick={() => void approveAccess()}
            >
              {accessState === "approving"
                ? (copy.fileAccessReading ?? "Reading...")
                : (copy.fileAccessAllowOnce ?? "Allow once")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={accessState === "approving"}
              onClick={() => {
                setAccessRequest(null);
                setAccessState("idle");
              }}
            >
              {copy.fileAccessCancel ?? "Cancel"}
            </Button>
          </div>
        </div>
      ) : null}
      {accessError ? (
        <p className="mt-2 text-xs font-medium text-destructive" role="alert">
          {accessError}
        </p>
      ) : null}
      {visibleContent && previewOpen ? (
        visibleContentKind === "markdown" ? (
          <div
            className={cn(
              "mt-2 min-w-0 max-w-full overflow-auto rounded-lg bg-muted/25 px-3 py-2 text-sm leading-6 text-foreground",
              previewHeightClassName,
            )}
          >
            <MarkdownContent className="py-0">{visibleContent}</MarkdownContent>
          </div>
        ) : (
          <pre
            className={cn(
              "mt-2 min-w-0 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/35 p-2 text-xs leading-5 text-foreground/80",
              previewHeightClassName,
            )}
          >
            {visibleContent}
          </pre>
        )
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
    return (
      <p className="mt-1.5 text-[13px] text-muted-foreground">{emptyLabel}</p>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      {visibleArtifacts.map((artifact, index) => (
        <div key={index}>{artifact}</div>
      ))}
      {hasOverflow ? (
        <button
          type="button"
          className="mt-1 text-xs font-semibold text-primary hover:text-primary/80"
          onClick={() => setShowAll((current) => !current)}
          aria-expanded={showAll}
        >
          {showAll
            ? (showFewerLabel ?? "Show fewer")
            : (showAllLabel ?? `Show all (${items.length})`)}
        </button>
      ) : null}
    </div>
  );
}
function WorkspaceActionGroup({
  label,
  layout = "inline",
  children,
}: {
  label?: string;
  layout?: "inline" | "stack";
  children?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/60 bg-background/70 p-2.5 shadow-sm">
      {label ? (
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
      ) : null}
      <div
        className={cn(
          layout === "inline" ? "flex flex-wrap gap-2" : "space-y-2",
        )}
      >
        {children}
      </div>
    </section>
  );
}

function WorkspaceActionCard({
  title,
  tone,
  children,
}: {
  title?: string;
  tone?: Tone;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border bg-card/80 p-2.5 shadow-xs",
        panelToneClassName(tone),
      )}
    >
      {title ? (
        <p className="mb-2 text-xs font-semibold text-foreground">{title}</p>
      ) : null}
      <div className="space-y-2 [&_button]:h-8 [&_button]:rounded-lg [&_button]:px-3 [&_textarea]:min-h-20 [&_textarea]:text-sm">
        {children}
      </div>
    </div>
  );
}

type WorkspaceTableColumn = {
  key: string;
  label: string;
  type?: "text" | "number" | "link";
  hrefKey?: string;
};

type WorkspaceTableRow = Record<string, unknown>;

type WorkspaceTableProps = {
  title?: string | null;
  description?: string | null;
  uri?: string | null;
  path?: string | null;
  displayPath?: string | null;
  columns?: Array<
    | string
    | { key?: unknown; label?: unknown; type?: unknown; hrefKey?: unknown }
  > | null;
  pageSize?: number | null;
  contentKind?: string | null;
  contentPreview?: string | null;
  contentTruncated?: boolean | null;
  contentBytes?: number | null;
  previewError?: string | null;
  collapsible?: boolean | null;
  defaultCollapsed?: boolean | null;
  collapseTitle?: string | null;
  collapsedSummary?: string | null;
};

function tableCellText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function safeExternalHref(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "mailto:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function csvRows(content: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"') {
      if (quoted && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && content[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim()));
}

function recordsFromRows(matrix: unknown[][]) {
  if (matrix.length === 0)
    return { rows: [] as WorkspaceTableRow[], inferredColumns: [] as string[] };
  const inferredColumns = matrix[0]!.map(
    (value, index) => tableCellText(value).trim() || `Column ${index + 1}`,
  );
  const rows = matrix
    .slice(1)
    .map((values) =>
      Object.fromEntries(
        inferredColumns.map((key, index) => [key, values[index] ?? ""]),
      ),
    );
  return { rows, inferredColumns };
}

function recordsFromObjects(items: Array<Record<string, unknown>>) {
  const inferredColumns: string[] = [];
  const rows = items.map((item) => {
    const row: WorkspaceTableRow = {};
    for (const [key, value] of Object.entries(item)) {
      if (!inferredColumns.includes(key)) inferredColumns.push(key);
      row[key] = value;
    }
    return row;
  });
  return { rows, inferredColumns };
}

function tableSourceRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.rows)) return record.rows;
    if (Array.isArray(record.data)) return record.data;
  }
  return [];
}

function parseTablePreview(
  kind: string | null | undefined,
  preview: string | null | undefined,
) {
  if (!preview)
    return {
      rows: [] as WorkspaceTableRow[],
      inferredColumns: [] as string[],
      parseError: false,
    };
  try {
    const rawRows =
      kind === "csv" ? csvRows(preview) : tableSourceRows(JSON.parse(preview));
    if (rawRows.every(Array.isArray))
      return { ...recordsFromRows(rawRows as unknown[][]), parseError: false };
    if (
      rawRows.every(
        (row) => row && typeof row === "object" && !Array.isArray(row),
      )
    ) {
      return {
        ...recordsFromObjects(rawRows as Array<Record<string, unknown>>),
        parseError: false,
      };
    }
  } catch {
    return { rows: [], inferredColumns: [], parseError: true };
  }
  return { rows: [], inferredColumns: [], parseError: true };
}

function normalizeTableColumns(
  propsColumns: WorkspaceTableProps["columns"],
  inferredColumns: string[],
): WorkspaceTableColumn[] {
  const columns =
    propsColumns?.flatMap<WorkspaceTableColumn>((column) => {
      if (typeof column === "string") return [{ key: column, label: column }];
      if (
        !column ||
        typeof column !== "object" ||
        typeof column.key !== "string"
      )
        return [];
      return [
        {
          key: column.key,
          label: typeof column.label === "string" ? column.label : column.key,
          type:
            column.type === "number" || column.type === "link"
              ? column.type
              : "text",
          hrefKey:
            typeof column.hrefKey === "string" ? column.hrefKey : undefined,
        },
      ];
    }) ?? [];
  return columns.length > 0
    ? columns
    : inferredColumns.map((key) => ({ key, label: key }));
}

function WorkspaceTableCell({
  column,
  row,
  value,
}: {
  column: WorkspaceTableColumn;
  row: WorkspaceTableRow;
  value: unknown;
}) {
  const text = tableCellText(value);
  const href = column.hrefKey
    ? safeExternalHref(tableCellText(row[column.hrefKey]))
    : column.type === "link"
      ? safeExternalHref(text)
      : null;
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="block min-w-0 whitespace-normal break-words font-medium text-primary underline-offset-4 [overflow-wrap:anywhere] hover:underline"
      >
        {text}
      </a>
    );
  }
  return (
    <span className="block min-w-0 whitespace-normal break-words [overflow-wrap:anywhere] leading-5">
      {text}
    </span>
  );
}

function WorkspaceTable({ props }: { props: WorkspaceTableProps }) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const [sorting, setSorting] = useState<SortingState>([]);
  const parsed = useMemo(
    () => parseTablePreview(props.contentKind, props.contentPreview),
    [props.contentKind, props.contentPreview],
  );
  const tableColumns = useMemo(
    () => normalizeTableColumns(props.columns, parsed.inferredColumns),
    [props.columns, parsed.inferredColumns],
  );
  const pageSize =
    typeof props.pageSize === "number" && Number.isFinite(props.pageSize)
      ? Math.max(1, Math.min(100, Math.floor(props.pageSize)))
      : 10;
  const columnDefs = useMemo<ColumnDef<WorkspaceTableRow>[]>(
    () =>
      tableColumns.map((column, index) => ({
        id: `${column.key}:${index}`,
        accessorFn: (row) => row[column.key],
        header: column.label,
        cell: ({ getValue, row }) => (
          <WorkspaceTableCell
            column={column}
            row={row.original}
            value={getValue()}
          />
        ),
      })),
    [tableColumns],
  );
  const table = useReactTable({
    data: parsed.rows,
    columns: columnDefs,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });
  const path = props.displayPath ?? props.uri ?? props.path;
  const size = formatFileSize(props.contentBytes);
  const error = filePreviewErrorMessage(props.previewError, copy);

  const fallbackCollapsed =
    props.contentTruncated === true || parsed.rows.length > 25;
  const collapsibleProps = props as unknown as Record<string, unknown>;
  const tableContent = contentPropsWithoutTitle(
    collapsibleProps,
    fallbackCollapsed,
  ) as WorkspaceTableProps;

  const contentNode = (
    <section className="min-w-0 w-full max-w-full space-y-2 overflow-hidden text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {tableContent.title ? (
            <p className="font-medium text-foreground">{tableContent.title}</p>
          ) : null}
          {tableContent.description ? (
            <p className="text-xs text-muted-foreground">
              {tableContent.description}
            </p>
          ) : null}
          {path ? (
            <p className="break-all text-xs text-muted-foreground">{path}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5 text-[10px] text-muted-foreground">
          {props.contentKind ? (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              {props.contentKind}
            </Badge>
          ) : null}
          {size ? <span>{size}</span> : null}
          {props.contentTruncated ? (
            <span>{copy.filePreviewTruncated ?? "Preview truncated"}</span>
          ) : null}
        </div>
      </div>
      {error ? (
        <p className="rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
          {error}
        </p>
      ) : null}
      {parsed.parseError ? (
        <p className="rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
          Table preview could not be parsed.
        </p>
      ) : null}
      {!error && !parsed.parseError && parsed.rows.length === 0 ? (
        <p className="rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
          No table rows in preview.
        </p>
      ) : null}
      {parsed.rows.length > 0 && tableColumns.length > 0 ? (
        <>
          <div className="min-w-0 w-full max-w-full overflow-hidden rounded-md border border-border/80 bg-background">
            <table className="w-full table-fixed caption-bottom text-sm">
              <thead className="bg-muted/55 [&_tr]:border-b">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr
                    key={headerGroup.id}
                    className="border-b transition-colors hover:bg-muted/50"
                  >
                    {headerGroup.headers.map((header) => {
                      const sorted = header.column.getIsSorted();
                      return (
                        <th
                          key={header.id}
                          aria-sort={
                            sorted === "asc"
                              ? "ascending"
                              : sorted === "desc"
                                ? "descending"
                                : "none"
                          }
                          className={`h-10 min-w-0 px-1 align-middle font-medium text-foreground ${tableColumns[header.index]?.type === "number" ? "text-right" : "text-left"}`}
                        >
                          <button
                            type="button"
                            title="Click to sort"
                            aria-label={`Sort by ${tableColumns[header.index]?.label ?? "column"}`}
                            className={`flex w-full cursor-pointer items-center gap-1 rounded-sm px-1.5 py-1 text-left leading-snug transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tableColumns[header.index]?.type === "number" ? "justify-end text-right" : "justify-start"}`}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            <span className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">
                              {flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                            </span>
                            <span
                              aria-hidden="true"
                              className="shrink-0 text-muted-foreground"
                            >
                              {sorted === "asc"
                                ? "↑"
                                : sorted === "desc"
                                  ? "↓"
                                  : "↕"}
                            </span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b transition-colors hover:bg-muted/50"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={`min-w-0 p-2 align-top text-foreground/80 ${tableColumns[cell.column.getIndex()]?.type === "number" ? "text-right tabular-nums" : ""}`}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {parsed.rows.length} rows ·{" "}
              {table.getPageCount() > 1
                ? `page ${table.getState().pagination.pageIndex + 1} of ${table.getPageCount()}`
                : "1 page"}
            </span>
            {table.getPageCount() > 1 ? (
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={!table.getCanPreviousPage()}
                  onClick={() => table.previousPage()}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={!table.getCanNextPage()}
                  onClick={() => table.nextPage()}
                >
                  Next
                </Button>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
  return (
    <MaybeCollapsible
      props={collapsibleProps}
      fallbackCollapsed={fallbackCollapsed}
      fallbackTitle={props.title ?? "Table"}
    >
      {contentNode}
    </MaybeCollapsible>
  );
}


/**
 * The Chrona workspace registry: standard primitives render with the prebuilt
 * `@json-render/shadcn` components (they inherit Chrona's Tailwind CSS-variable
 * theme); domain components (`RichMarkdown`, `JsonView`, `FileRef`, `ResultSummary`,
 * `ActivityRow`, `ToolDetails`, `CollapsibleText`) render with Chrona JSX.
 * Actions are declared required by the catalog but are only exercised by the
 * Node-action panel, which wires real dispatch via providers.
 */
function CheckpointChoiceField({
  props,
  bindings,
}: {
  props: {
    label: string;
    name: string;
    description?: string;
    selection: "single" | "multiple";
    options: Array<{
      value: string;
      label: string;
      description?: string;
      recommended?: boolean;
    }>;
    value?: string | string[] | { $bindState: string };
    required?: boolean;
  };
  bindings?: Record<string, string>;
}) {
  const propValue = typeof props.value === "object" && !Array.isArray(props.value) ? undefined : props.value;
  const [value, setValue] = useBoundProp<string | string[]>(propValue, bindings?.value);
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const selectOption = (optionValue: string, checked: boolean) => {
    if (props.selection === "single") {
      setValue(checked ? optionValue : "");
      return;
    }
    setValue(checked
      ? [...new Set([...selected, optionValue])]
      : selected.filter((entry) => entry !== optionValue));
  };

  return (
    <Field className="min-w-0 gap-2">
      <FieldLabel>{props.label}{props.required ? <span aria-hidden="true"> *</span> : null}</FieldLabel>
      {props.description ? <FieldDescription>{props.description}</FieldDescription> : null}
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        {props.options.map((option) => (
          <Label key={option.value} className="flex min-w-0 items-start gap-2 rounded-lg border border-border/60 p-2.5 font-normal">
            <Checkbox
              checked={selected.includes(option.value)}
              onCheckedChange={(next) => selectOption(option.value, next === true)}
              aria-label={option.label}
            />
            <span className="min-w-0 space-y-0.5">
              <span className="flex flex-wrap items-center gap-1 text-sm font-medium leading-5">
                {option.label}
                {option.recommended ? <Badge variant="secondary">Recommended</Badge> : null}
              </span>
              {option.description ? <span className="block text-xs leading-4 text-muted-foreground">{option.description}</span> : null}
            </span>
          </Label>
        ))}
      </div>
    </Field>
  );
}

export const { registry: workspaceRegistry } = defineRegistry(chronaCatalog, {
  components: {
    // standard primitives (shadcn)
    Card: (input) => {
      const props = {
        ...input.props,
        className: cn(input.props.className, "min-w-0 w-full max-w-none"),
      };
      if (shouldWrapCollapsible(input.props)) {
        const title =
          stringProp(input.props.collapseTitle) ??
          stringProp(input.props.title) ??
          "Result";
        const summary =
          stringProp(input.props.collapsedSummary) ??
          stringProp(input.props.description);
        return (
          <CollapsibleBlock
            title={title}
            summary={summary}
            defaultCollapsed={shouldCollapseByDefault(input.props, false)}
            storageId={collapseStorageIdFromProps(input.props)}
          >
            {input.children}
          </CollapsibleBlock>
        );
      }
      return shadcnComponents.Card({ ...input, props });
    },
    Stack: (input) => {
      const horizontal = input.props.direction === "horizontal";
      return shadcnComponents.Stack({
        ...input,
        props: {
          ...input.props,
          className: cn(
            input.props.className,
            "min-w-0 max-w-full",
            !input.props.className?.includes("w-auto") && "w-full",
            !input.props.align && "items-stretch",
            horizontal && "[&>*]:min-w-0 [&>*]:flex-[1_1_18rem]",
          ),
        },
      });
    },
    Separator: shadcnComponents.Separator,
    Text: shadcnComponents.Text,
    Heading: shadcnComponents.Heading,
    Badge: shadcnComponents.Badge,
    Alert: shadcnComponents.Alert,
    Button: shadcnComponents.Button,
    CheckpointChoiceField,
    Link: shadcnComponents.Link,
    Input: shadcnComponents.Input,
    Textarea: shadcnComponents.Textarea,
    Select: shadcnComponents.Select,
    Checkbox: shadcnComponents.Checkbox,
    Radio: shadcnComponents.Radio,
    Tabs: shadcnComponents.Tabs,
    Table: WorkspaceTable,
    heading: shadcnComponents.Heading,
    DropdownMenu: shadcnComponents.DropdownMenu,
    ResultHero: ({ props }) => <ResultHero props={props} />,
    ResultDeliverable: ({ props }) => <ResultDeliverable props={props} />,
    ResultInsight: ({ props }) => <ResultInsight props={props} />,
    ResultActionPlan: ({ props }) => <ResultActionPlan props={props} />,
    ResultCaveats: ({ props }) => <ResultCaveats props={props} />,
    ResultEvidence: ({ props }) => <ResultEvidence props={props} />,
    paragraph: ({ props }) => (
      <p className="text-sm leading-6 text-foreground/85">
        {props.text ?? props.content}
      </p>
    ),
    table: WorkspaceTable,
    section: ({ props, children }) => (
      <section className="min-w-0 w-full max-w-full space-y-2 overflow-hidden rounded-xl border border-border/60 bg-background/70 p-3">
        {props.title ? (
          <h3 className="font-heading text-sm font-semibold text-foreground">
            {props.title}
          </h3>
        ) : null}
        {children}
      </section>
    ),

    WorkspaceOccurrenceCalendar: ({ props }) => {
      const rawOptions = Array.isArray(props.options) ? props.options : [];
      const options = rawOptions.filter(isOccurrenceOption);
      if (options.length <= 1) return null;
      return (
        <WorkspaceOccurrenceCalendar
          label={typeof props.label === "string" ? props.label : "Occurrence"}
          value={
            typeof props.value === "string"
              ? props.value
              : (options[0]?.value ?? "")
          }
          options={options}
        />
      );
    },

    WorkspaceActionGroup: ({ props, children }) => (
      <WorkspaceActionGroup label={props.label} layout={props.layout}>
        {children}
      </WorkspaceActionGroup>
    ),
    WorkspaceActionCard: ({ props, children }) => (
      <WorkspaceActionCard title={props.title} tone={props.tone as Tone}>
        {children}
      </WorkspaceActionCard>
    ),
    // domain components (Chrona)
    RichMarkdown: ({ props }) => {
      const content = typeof props.content === "string" ? props.content : "";
      const contentNode = <MarkdownContent>{content}</MarkdownContent>;
      return (
        <MaybeCollapsible
          props={props}
          fallbackCollapsed={content.length > AUTO_COLLAPSE_MARKDOWN_LENGTH}
          fallbackTitle={
            typeof props.title === "string" ? props.title : "Rich text"
          }
        >
          {contentNode}
        </MaybeCollapsible>
      );
    },
    JsonView: ({ props }) => {
      const jsonText =
        typeof props.value === "string"
          ? props.value
          : JSON.stringify(props.value, null, 2);
      const fallbackCollapsed = jsonText.length > AUTO_COLLAPSE_JSON_LENGTH;
      const contentProps = contentPropsWithoutTitle(props, fallbackCollapsed);
      const contentNode = (
        <section className="min-w-0 w-full max-w-full overflow-hidden px-0.5 py-1 text-sm text-foreground">
          {typeof contentProps.title === "string" ? (
            <p className="mb-2 truncate text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {contentProps.title}
            </p>
          ) : null}
          <pre className="max-h-96 max-w-full overflow-x-auto rounded-lg bg-muted/60 p-2 text-xs leading-5 text-foreground/80">
            {jsonText}
          </pre>
        </section>
      );
      return (
        <MaybeCollapsible
          props={props}
          fallbackCollapsed={fallbackCollapsed}
          fallbackTitle={typeof props.title === "string" ? props.title : "JSON"}
        >
          {contentNode}
        </MaybeCollapsible>
      );
    },
    FileRef: ({ props }) => (
      <MaybeCollapsible
        props={props}
        fallbackCollapsed={
          props.contentTruncated === true ||
          (typeof props.contentBytes === "number" &&
            props.contentBytes > AUTO_COLLAPSE_FILE_BYTES)
        }
        fallbackTitle={typeof props.title === "string" ? props.title : "File"}
      >
        <FileView
          props={contentPropsWithoutTitle(
            props,
            props.contentTruncated === true ||
              (typeof props.contentBytes === "number" &&
                props.contentBytes > AUTO_COLLAPSE_FILE_BYTES),
          )}
        />
      </MaybeCollapsible>
    ),
    FileView: ({ props }) => (
      <MaybeCollapsible
        props={props}
        fallbackCollapsed={
          props.contentTruncated === true ||
          (typeof props.contentBytes === "number" &&
            props.contentBytes > AUTO_COLLAPSE_FILE_BYTES)
        }
        fallbackTitle={typeof props.title === "string" ? props.title : "File"}
      >
        <FileView
          props={contentPropsWithoutTitle(
            props,
            props.contentTruncated === true ||
              (typeof props.contentBytes === "number" &&
                props.contentBytes > AUTO_COLLAPSE_FILE_BYTES),
          )}
        />
      </MaybeCollapsible>
    ),
    ResultSummary: ({ props }) => <ResultSummary props={props} />,
    CollapsibleBlock: ({ props, children }) => (
      <CollapsibleBlock
        title={stringProp(props.title)}
        summary={stringProp(props.summary)}
        defaultCollapsed={boolProp(props.defaultCollapsed)}
        storageId={collapseStorageIdFromProps(props)}
      >
        {children}
      </CollapsibleBlock>
    ),
    NodeResultSection: ({ props, children }) => (
      <CollapsibleBlock
        title={stringProp(props.nodeTitle)}
        summary={
          typeof props.itemCount === "number"
            ? `${props.itemCount} result${props.itemCount === 1 ? "" : "s"}`
            : stringProp(props.status)
        }
        defaultCollapsed={boolProp(props.defaultCollapsed)}
        storageId={collapseStorageIdFromProps(props)}
        subtle
      >
        {children}
      </CollapsibleBlock>
    ),
    ActivityRow: ({ props, children }) => {
      const tone = props.tone as Tone;
      const Icon = activityIcon(props.kind, tone);
      const compact = props.density === "compact";
      return (
        <article className="group relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3">
          <div className="relative flex justify-center">
            <span className="absolute -bottom-3 top-8 mx-auto w-px bg-border/50 group-last:hidden" />
            <span
              className={cn(
                "relative z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ring-4 ring-background shadow-sm",
                activityIconClassName(tone),
              )}
            >
              <Icon className="size-3.5" />
            </span>
          </div>
          <div className="min-w-0 pb-4 pt-0.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              {props.time ? (
                <time className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/50">
                  {props.time}
                </time>
              ) : null}
              <p className="min-w-0 break-words text-sm font-semibold leading-snug text-foreground">
                {props.title}
              </p>
              {props.toolState ? (
                <Badge
                  variant={toneBadgeVariant(tone)}
                  className="gap-1 text-[10px]"
                >
                  <Wrench className="size-3" />
                  {props.toolState}
                </Badge>
              ) : null}
            </div>
            {props.sourceNodeTitle || props.provider ? (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {props.sourceNodeTitle ? (
                  <Badge
                    variant="outline"
                    className="max-w-full truncate bg-background/80 text-[10px]"
                  >
                    {props.sourceNodeTitle}
                  </Badge>
                ) : null}
                {props.provider ? (
                  <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary">
                    {props.provider}
                  </span>
                ) : null}
              </div>
            ) : null}
            {props.text ? (
              <CollapsibleText
                text={props.text}
                threshold={compact ? 220 : undefined}
              />
            ) : null}
            {children ? <div className="mt-1.5">{children}</div> : null}
          </div>
        </article>
      );
    },
    ActivityStream: ({ props }) => {
      const items = Array.isArray(props.items)
        ? (props.items as WorkspaceActivityItem[])
        : [];
      const liveCount =
        typeof props.liveCount === "number" ? props.liveCount : 0;
      const savedCount =
        typeof props.savedCount === "number" ? props.savedCount : items.length;
      return (
        <section>
          <div className="mb-3 text-xs text-muted-foreground">
            {items.length} shown · {liveCount} live · {savedCount} saved
          </div>
          {items.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-border/70 bg-background/70 px-3 py-4 text-center">
              <p className="text-sm font-medium text-foreground">
                {props.emptyMessage}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {taskWorkspaceActivityMessages.emptyHint}
              </p>
            </div>
          ) : (
            <div className={props.density === "rail" ? "mt-3" : "mt-4 pl-1"}>
              <ActivityTimeline
                items={items}
                density={props.density === "rail" ? "rail" : undefined}
                active={props.active === true}
              />
            </div>
          )}
        </section>
      );
    },
    ToolDetails: ({ props }) => (
      <dl className="space-y-1.5 rounded-xl border border-border/50 bg-muted/35 p-2 text-xs">
        {props.rows.map((row) => (
          <div
            key={row.label}
            className="grid gap-1 sm:grid-cols-[72px_minmax(0,1fr)]"
          >
            <dt className="font-semibold text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 break-words text-foreground/80">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    ),
    CollapsibleText: ({ props }) => (
      <CollapsibleText text={props.text} threshold={props.threshold} />
    ),
    WorkspaceSummaryCard: ({ props, children }) => {
      const Icon = workspaceIcon(props.icon);
      return (
        <section
          className={cn(
            "rounded-[1rem] border p-3 shadow-sm",
            panelToneClassName(props.tone as Tone),
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0">
                {props.eyebrow ? (
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                    {props.eyebrow}
                  </p>
                ) : null}
                <p className="break-words text-sm font-semibold text-foreground">
                  {props.title}
                </p>
              </div>
            </div>
            {props.statusLabel ? (
              <span className="shrink-0 rounded-full bg-background/85 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {props.statusLabel}
              </span>
            ) : null}
          </div>
          {props.sourceLabel ? (
            <p className="mt-2 text-xs font-medium text-muted-foreground">
              {props.sourceLabel}
            </p>
          ) : null}
          {props.description ? (
            <div className="mt-2 line-clamp-3 break-words rounded-xl bg-muted/50 px-2.5 py-2 text-[13px] leading-[1.45] text-foreground/80">
              {props.description}
            </div>
          ) : null}
          {children ? <div className="mt-2">{children}</div> : null}
        </section>
      );
    },
    WorkspaceArtifactList: ({ props, children }) => (
      <WorkspaceArtifactList
        emptyLabel={props.emptyLabel}
        maxCollapsed={props.maxCollapsed}
        showAllLabel={props.showAllLabel}
        showFewerLabel={props.showFewerLabel}
      >
        {children}
      </WorkspaceArtifactList>
    ),
    WorkspaceArtifactItem: ({ props, emit, on }) => {
      const locate = on("locate");
      return (
        <div className="min-w-0 w-full max-w-full">
          <FileView props={props} />
          {locate.bound ? (
            <div className="mt-0.5 text-xs">
              <button
                type="button"
                className="font-semibold text-primary"
                onClick={() => emit("locate")}
              >
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
            <h3 className="text-base font-semibold text-foreground">
              Proposed Changes
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {props.summary}
            </p>
          </div>
          <Badge variant={props.confidence === "low" ? "outline" : "secondary"}>
            {props.confidence} confidence
          </Badge>
        </div>
        {props.risks.length > 0 ? (
          <div className="rounded-2xl border border-warning/30 bg-warning/15 px-4 py-3">
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  High Risk Changes
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-foreground/80">
                  {props.risks.map((risk, index) => (
                    <li key={`${risk}:${index}`}>{risk}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : null}
        {props.warnings.length > 0 ? (
          <div className="space-y-1.5 rounded-2xl border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
            {props.warnings.map((warning, index) => (
              <div
                key={`${warning}:${index}`}
                className="flex items-start gap-1.5"
              >
                <TriangleAlert className="mt-0.5 size-3 shrink-0 text-warning" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        ) : null}
        {props.taskDiffs.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Task Changes ({props.taskDiffs.length})
            </p>
            <div className="rounded-2xl border border-border/60 bg-background/80 p-3">
              {props.taskDiffs.map((diff) => {
                const changed = diff.original !== diff.proposed;
                return (
                  <div
                    key={diff.key}
                    className={cn(
                      "grid grid-cols-1 gap-2 border-b border-border/30 py-1.5 text-xs last:border-b-0 sm:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)]",
                      changed && "-mx-2 bg-warning/10 px-2",
                    )}
                  >
                    <span className="font-medium text-muted-foreground">
                      {diff.label}
                    </span>
                    <span
                      className={cn(
                        "text-muted-foreground/70 line-through",
                        changed && "text-destructive/60",
                      )}
                    >
                      {diff.original || <em>empty</em>}
                    </span>
                    <span className={cn(changed && "font-medium text-success")}>
                      {diff.proposed || <em>empty</em>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {props.planSummary.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Plan Changes
            </p>
            <div className="space-y-2 rounded-2xl border border-border/60 bg-background/80 p-4">
              <Badge variant="secondary">plan patch</Badge>
              <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                {props.planSummary.map((point, index) => (
                  <li key={`${point}:${index}`}>{point}</li>
                ))}
              </ul>
              {props.addedNodes.length > 0 ? (
                <div className="mt-2 space-y-1">
                  <p className="text-xs font-medium text-foreground">Nodes:</p>
                  {props.addedNodes.map((node, index) => (
                    <div
                      key={`${node.title}:${index}`}
                      className="rounded-lg border border-border/40 bg-muted/20 px-3 py-1.5 text-xs"
                    >
                      <span className="font-medium text-foreground">
                        {node.title}
                      </span>
                      {node.estimatedMinutes ? (
                        <span className="ml-2 text-muted-foreground">
                          ({node.estimatedMinutes}m)
                        </span>
                      ) : null}
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
      throw new Error(
        '[ui-protocol] action "command-center-primary" requires a host handler.',
      );
    },
    "accept-plan": async () => {
      throw new Error(
        '[ui-protocol] action "accept-plan" requires a host handler.',
      );
    },
    "generate-plan": async () => {
      throw new Error(
        '[ui-protocol] action "generate-plan" requires a host handler.',
      );
    },
    "dispatch-execution": async () => {
      throw new Error(
        '[ui-protocol] action "dispatch-execution" is wired in Phase 3 (Node action).',
      );
    },
    "submit-checkpoint": async () => {
      throw new Error(
        '[ui-protocol] action "submit-checkpoint" is wired in Phase 3 (Node action).',
      );
    },
    "locate-workspace-node": async () => {
      throw new Error(
        '[ui-protocol] action "locate-workspace-node" requires a host handler.',
      );
    },
    "recovery-retry": async () => {
      throw new Error(
        '[ui-protocol] action "recovery-retry" requires a host handler.',
      );
    },
    "recovery-edit-instruction": async () => {
      throw new Error(
        '[ui-protocol] action "recovery-edit-instruction" requires a host handler.',
      );
    },
    "recovery-cancel": async () => {
      throw new Error(
        '[ui-protocol] action "recovery-cancel" requires a host handler.',
      );
    },
  },
});
