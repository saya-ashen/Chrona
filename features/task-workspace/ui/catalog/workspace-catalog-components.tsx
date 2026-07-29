import { useState, type ReactNode } from "react";
import { Archive, Bot, Check, ChevronDown, ChevronUp, Circle, FileText, MoreHorizontal, Sparkles, TriangleAlert, Wrench } from "lucide-react";
import { useBoundProp } from "@json-render/react";
import { Badge, Button, Checkbox, cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Field, FieldDescription, FieldLabel, Label } from "@shared/ui";
export { CollapsibleBlock } from "./workspace-collapse";
import { CollapsibleBlock, collapseStorageIdFromProps, shouldCollapseByDefault } from "./workspace-collapse";
import { stringProp } from "./workspace-registry-utilities";
import { WorkspaceTable } from "./workspace-table";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | undefined;

export function toneBadgeVariant(tone: Tone) {
  if (tone === "danger") return "destructive" as const;
  if (tone === "success" || tone === "info") return "secondary" as const;
  return "outline" as const;
}

export function panelToneClassName(tone: Tone) {
  if (tone === "danger") return "border-destructive/40 bg-destructive/15";
  if (tone === "warning") return "border-warning/50 bg-warning/15";
  if (tone === "success") return "border-success/40 bg-success/15";
  if (tone === "info") return "border-info/40 bg-info/15";
  return "border-border bg-muted/60";
}

export function workspaceIcon(icon: string | undefined) {
  if (icon === "archive") return Archive;
  if (icon === "file") return FileText;
  if (icon === "warning") return TriangleAlert;
  if (icon === "check") return Check;
  return Sparkles;
}

export function activityIcon(kind: string | undefined, tone: Tone) {
  if (tone === "danger" || kind === "approval") return TriangleAlert;
  if (tone === "success") return Check;
  if (kind?.startsWith("tool_")) return Wrench;
  if (kind === "assistant_message" || kind === "reasoning") return Bot;
  if (kind === "artifact") return FileText;
  return Circle;
}

export function activityIconClassName(tone: Tone) {
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

export function CollapsibleText({
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
export function shouldWrapCollapsible(
  props: Record<string, unknown>,
  fallbackCollapsed?: boolean,
) {
  const explicit =
    props.collapsible === true ? true : props.collapsible === false ? false : undefined;
  const hasDefaultCollapsedPreference =
    props.defaultCollapsed === true || props.defaultCollapsed === false;
  return explicit ?? Boolean(fallbackCollapsed || hasDefaultCollapsedPreference);
}

export function contentPropsWithoutTitle(
  props: Record<string, unknown>,
  fallbackCollapsed?: boolean,
): Record<string, unknown> {
  if (!shouldWrapCollapsible(props, fallbackCollapsed)) return props;
  const { title: _title, ...contentProps } = props;
  return contentProps;
}

export function MaybeCollapsible({
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

export function WorkspaceArtifactList({
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
export function WorkspaceActionGroup({
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

export function WorkspaceActionCard({
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

export function VirtualizedCsvPreview({
  content,
  contentBytes,
}: {
  content: string;
  contentBytes?: number | null;
}) {
  return <WorkspaceTable props={{ contentKind: "csv", contentPreview: content, contentBytes, wide: true }} />;
}

export function CheckpointChoiceField({
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
  const propValue =
    typeof props.value === "object" && !Array.isArray(props.value)
      ? undefined
      : props.value;
  const [value, setValue] = useBoundProp<string | string[]>(
    propValue,
    bindings?.value,
  );
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const selectOption = (optionValue: string, checked: boolean) => {
    if (props.selection === "single") {
      setValue(checked ? optionValue : "");
      return;
    }
    setValue(
      checked
        ? [...new Set([...selected, optionValue])]
        : selected.filter((entry) => entry !== optionValue),
    );
  };

  return (
    <Field className="min-w-0 gap-2">
      <FieldLabel>
        {props.label}
        {props.required ? <span aria-hidden="true"> *</span> : null}
      </FieldLabel>
      {props.description ? (
        <FieldDescription>{props.description}</FieldDescription>
      ) : null}
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        {props.options.map((option) => (
          <Label
            key={option.value}
            className="flex min-w-0 items-start gap-2 rounded-lg border border-border/60 p-2.5 font-normal"
          >
            <Checkbox
              checked={selected.includes(option.value)}
              onCheckedChange={(next) =>
                selectOption(option.value, next === true)
              }
              aria-label={option.label}
            />
            <span className="min-w-0 space-y-0.5">
              <span className="flex flex-wrap items-center gap-1 text-sm font-medium leading-5">
                {option.label}
                {option.recommended ? (
                  <Badge variant="secondary">Recommended</Badge>
                ) : null}
              </span>
              {option.description ? (
                <span className="block text-xs leading-4 text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </span>
          </Label>
        ))}
      </div>
    </Field>
  );
}
export function horizontalStackChildrenClass(className?: string | null) {
  if (className?.includes("children-intrinsic")) {
    return "[&>*]:min-w-0 [&>*]:flex-none";
  }
  return "[&>*]:min-w-0 [&>*]:flex-[1_1_18rem]";
}


export function WorkspaceButton({
  props,
  emit,
}: {
  props: {
    label: string;
    variant?: "primary" | "secondary" | "danger" | null;
    size?: "sm" | "md" | "lg" | null;
    disabled?: boolean | null;
  };
  emit: (event: string) => void;
}) {
  const variant = props.variant === "danger"
    ? "destructive"
    : props.variant === "secondary"
      ? "secondary"
      : "default";
  const size = props.size === "lg" ? "lg" : props.size === "sm" ? "sm" : "default";
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={props.disabled ?? false}
      onClick={() => emit("press")}
    >
      {props.label}
    </Button>
  );
}

export function WorkspaceDropdownMenu({
  props,
  bindings,
  emit,
}: {
  props: {
    label: string;
    value?: string | null;
    items?: Array<{ label: string; value: string }> | null;
  };
  bindings?: Record<string, string>;
  emit: (event: string) => void;
}) {
  const [, setBoundValue] = useBoundProp(props.value ?? undefined, bindings?.value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/90 bg-background/80 text-foreground shadow-xs outline-none transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/25"
        aria-label={props.label === "..." ? "More task actions" : props.label}
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(props.items ?? []).map((item) => (
          <DropdownMenuItem
            key={item.value}
            onClick={() => {
              setBoundValue(item.value);
              emit("select");
            }}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
