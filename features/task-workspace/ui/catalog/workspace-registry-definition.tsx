import { Wrench } from "lucide-react";
import { ActivityTimeline } from "../activity-timeline";
import type { WorkspaceActivityItem } from "../../model/task-workspace-types";
import { MarkdownContent } from "../../../../shared/ui/markdown-content";
import { defineRegistry } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { taskWorkspaceActivityMessages } from "@chrona/i18n";
import { chronaCatalog } from "@chrona/ui-protocol";
import { Badge, cn } from "@shared/ui";
import { WorkspaceOccurrenceCalendar, isOccurrenceOption } from "./workspace-registry-catalog";
import { WorkspaceTable } from "./workspace-table";
import { WorkspaceDiffPreview } from "./workspace-diff-preview";
import { ResultActionPlan, ResultCaveats, ResultEvidence, ResultHero, ResultInsight, ResultOverview, ResultReadiness, ResultSummary } from "./workspace-result-components";
import { ResultMetricGrid, ResultSection } from "./workspace-result-sections";
import { ResultChangeSummary, ResultChecklist, ResultComparison, ResultTimeline } from "./workspace-result-views";
import { ResultDeliverable } from "./workspace-deliverable";
import { FileView } from "./workspace-file-view";
import { activityIcon, activityIconClassName, CheckpointChoiceField, CollapsibleBlock, CollapsibleText, contentPropsWithoutTitle, horizontalStackChildrenClass, MaybeCollapsible, panelToneClassName, shouldWrapCollapsible, toneBadgeVariant, type Tone, WorkspaceActionCard, WorkspaceActionGroup, WorkspaceArtifactList, WorkspaceButton, WorkspaceDropdownMenu, workspaceIcon } from "./workspace-catalog-components";
import { boolProp, stringProp } from "./workspace-registry-utilities";
import { collapseStorageIdFromProps, shouldCollapseByDefault } from "./workspace-collapse";

const AUTO_COLLAPSE_MARKDOWN_LENGTH = 4000;
const AUTO_COLLAPSE_FILE_BYTES = 32 * 1024;

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
        const summary = stringProp(input.props.description);
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
            horizontal && horizontalStackChildrenClass(input.props.className),
          ),
        },
      });
    },
    Separator: shadcnComponents.Separator,
    Text: shadcnComponents.Text,
    Heading: shadcnComponents.Heading,
    Badge: shadcnComponents.Badge,
    Alert: shadcnComponents.Alert,
    Button: WorkspaceButton,
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
    DropdownMenu: WorkspaceDropdownMenu,
    ResultOverview: ({ props }) => <ResultOverview props={props} />,
    ResultReadiness: ({ props }) => <ResultReadiness props={props} />,
    ResultSection: ({ props, children }) => (
      <ResultSection props={props}>{children}</ResultSection>
    ),
    ResultMetricGrid: ({ props }) => <ResultMetricGrid props={props} />,
    ResultComparison: ({ props }) => <ResultComparison props={props} />,
    ResultTimeline: ({ props }) => <ResultTimeline props={props} />,
    ResultChecklist: ({ props }) => <ResultChecklist props={props} />,
    ResultChangeSummary: ({ props }) => <ResultChangeSummary props={props} />,
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
      const contentProps = contentPropsWithoutTitle(props);
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
      return <MaybeCollapsible props={props} fallbackCollapsed={jsonText.length > 2000} fallbackTitle={typeof props.title === "string" ? props.title : "JSON"}>{contentNode}</MaybeCollapsible>;
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
    WorkspaceDiffPreview,
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
