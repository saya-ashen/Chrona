import { useState, type ReactNode } from "react";
import { Archive, FileText, Sparkles } from "lucide-react";
import { useI18n } from "@chrona/i18n/react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
import type { ExecutionOverviewCard, WorkspaceActivityItem, WorkspaceArtifactItem } from "../model/task-workspace-types";
import { WorkspaceActivityFeed } from "./workspace-activity-feed";

type OverviewAction = (nodeId?: string) => void;
type CommandCenterTab = "actions" | "result" | "artifacts" | "activity";
type TaskWorkspaceCopy = Record<string, string | undefined>;

export type CommandCenterPrimaryAction = {
  label: string;
  description: string;
  statusLabel?: string;
  tone?: ExecutionOverviewCard["tone"];
  disabled?: boolean;
  isLoading?: boolean;
  onClick?: () => void;
  actionControls?: ReactNode;
  suppressAttentionCard?: boolean;
};

export type CommandCenterCopy = {
  actionsTab: string;
  resultTab: string;
  artifactsTab: string;
  activityTab: string;
};

const DEFAULT_COMMAND_CENTER_COPY: CommandCenterCopy = {
  actionsTab: "Actions",
  resultTab: "Result",
  artifactsTab: "Artifacts",
  activityTab: "Activity",
};

export function TaskWorkspaceExecutionOverview({
  latestResult,
  artifacts,
  activity,
  runtimeEvents = [],
  primaryAction,
  copy: copyProp,
  onAction,
}: {
  readiness: ExecutionOverviewCard;
  latestResult: ExecutionOverviewCard;
  attention: ExecutionOverviewCard | null;
  artifacts: WorkspaceArtifactItem[];
  activity: WorkspaceActivityItem[];
  runtimeEvents?: WorkspaceRuntimeEvent[];
  primaryAction?: CommandCenterPrimaryAction | null;
  copy?: Partial<CommandCenterCopy>;
  progressLabel?: string;
  taskStatus?: string;
  nextAction?: string;
  onAction?: OverviewAction;
}) {
  const [activeTab, setActiveTab] = useState<CommandCenterTab>("actions");
  const { messages } = useI18n();
  const ws = messages.components?.taskWorkspace ?? {};
  const copy = { ...DEFAULT_COMMAND_CENTER_COPY, ...copyProp };
  const tabs: Array<{ id: CommandCenterTab; label: string }> = [
    { id: "actions", label: copy.actionsTab },
    { id: "result", label: copy.resultTab },
    { id: "artifacts", label: copy.artifactsTab },
    { id: "activity", label: copy.activityTab },
  ];

  return (
    <aside aria-label={ws.executionOverviewAria ?? "Execution overview"} className="min-h-0 min-w-0 rounded-[1.15rem] bg-background/75 p-3">
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="size-3.5" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{ws.taskEyebrow ?? "Task"}</p>
              <h2 className="text-sm font-semibold text-foreground">{ws.commandCenter ?? "Command Center"}</h2>
            </div>
          </div>
        </div>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as CommandCenterTab)} className="gap-2">
          <TabsList className="grid h-auto w-full grid-cols-4 gap-1 rounded-[0.9rem] bg-muted/70 p-1">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} onClick={() => setActiveTab(tab.id)} className="rounded-[0.7rem] px-2 py-1.5 text-xs font-semibold data-active:bg-primary data-active:text-primary-foreground data-active:shadow-sm">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="actions" className="space-y-2">
            <>
              {primaryAction ? <PrimaryActionCard action={primaryAction} copy={ws} /> : null}
            </>
          </TabsContent>
          <TabsContent value="result" className="space-y-2">
            <LatestResultCard card={latestResult} onAction={onAction} copy={ws} />
          </TabsContent>
          <TabsContent value="artifacts" className="space-y-2">
            <ArtifactsCard artifacts={artifacts} onAction={onAction} copy={ws} />
          </TabsContent>
          <TabsContent value="activity" className="space-y-2">
            <WorkspaceActivityFeed activity={activity} runtimeEvents={runtimeEvents} />
          </TabsContent>
        </Tabs>
      </div>
    </aside>
  );
}

function PrimaryActionCard({ action, copy }: { action: CommandCenterPrimaryAction; copy: TaskWorkspaceCopy }) {
  return (
    <section className={cn("rounded-[1rem] border p-3", cardToneClass(action.tone ?? "info"))}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{copy.currentOperation ?? "Current operation"}</p>
          <p className="mt-0.5 break-words text-sm font-semibold text-foreground">{action.label}</p>
        </div>
        {action.statusLabel ? <span className="shrink-0 rounded-full bg-background/85 px-2 py-0.5 text-xs font-medium text-muted-foreground">{action.statusLabel}</span> : null}
      </div>
      <p className="mt-2 break-words text-[13px] leading-[1.4] text-foreground/80">{action.description}</p>
      {action.actionControls ? <div className="mt-3">{action.actionControls}</div> : null}
      {action.onClick ? (
        <Button
          type="button"
          size="sm"
          className="mt-3 h-8 rounded-full px-3 text-xs shadow-sm"
          disabled={action.disabled || action.isLoading}
          onClick={action.onClick}
        >
          {action.isLoading ? (copy.generating ?? "Generating...") : action.label}
        </Button>
      ) : null}
    </section>
  );
}

function cardToneClass(tone: ExecutionOverviewCard["tone"]) {
  if (tone === "critical") return "border-destructive/30 bg-destructive/10";
  if (tone === "warning") return "border-warning/40 bg-warning/10";
  if (tone === "success") return "border-success/30 bg-success/10";
  if (tone === "info") return "border-info/30 bg-info/10";
  return "border-border bg-muted/45";
}

function LatestResultCard({ card, onAction, copy }: { card: ExecutionOverviewCard; onAction?: OverviewAction; copy: TaskWorkspaceCopy }) {
  const resultText = card.content?.trim() || card.description;

  return (
    <section className="rounded-[1rem] bg-transparent p-1">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Sparkles className="size-3.5" />
          </span>
          <p className="text-sm font-semibold text-foreground">{card.title}</p>
        </div>
        {card.statusLabel ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{card.statusLabel}</span> : null}
      </div>
      <div className="mt-2 max-h-[420px] overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-muted/50 px-2.5 py-2 text-[13px] leading-[1.45] text-foreground/80">
        {resultText === (copy.noResultYet ?? "No execution result yet.")
          ? (copy.resultPlaceholder ?? "Result summary will appear here after the current node finishes.")
          : resultText}
      </div>
      {card.actionLabel && onAction ? (
        <button type="button" className="mt-2 text-xs font-semibold text-primary hover:text-primary/80" onClick={() => onAction(card.actionNodeId)}>
          {copy.locateResultNode ?? "Locate result node"}
        </button>
      ) : null}
    </section>
  );
}

function ArtifactsCard({ artifacts, onAction, copy }: { artifacts: WorkspaceArtifactItem[]; onAction?: OverviewAction; copy: TaskWorkspaceCopy }) {
  const [expandedArtifactId, setExpandedArtifactId] = useState<string | null>(artifacts[0]?.id ?? null);
  const [showAll, setShowAll] = useState(false);
  const COLLAPSED_LIMIT = 4;
  const hasOverflow = artifacts.length > COLLAPSED_LIMIT;
  const visibleArtifacts = showAll ? artifacts : artifacts.slice(0, COLLAPSED_LIMIT);

  return (
    <section className="rounded-[1rem] bg-transparent p-1">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Archive className="size-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">{copy.artifactsLabel ?? "Artifacts"} ({artifacts.length})</p>
        </div>
      </div>
      {artifacts.length === 0 ? (
        <p className="mt-1.5 text-[13px] text-muted-foreground">{copy.noArtifacts ?? "No artifacts yet."}</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {visibleArtifacts.map((artifact) => (
            <div key={artifact.id} className="rounded-xl bg-muted/45 px-2 py-1.5">
              <button
                type="button"
                className="flex w-full items-center gap-2 text-left"
                onClick={() => setExpandedArtifactId((current) => current === artifact.id ? null : artifact.id)}
                aria-expanded={expandedArtifactId === artifact.id}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <FileText className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-medium text-foreground">{artifact.title}</span>
                  <span className="block break-words text-xs text-muted-foreground">{artifact.type}</span>
                </span>
              </button>
              {expandedArtifactId === artifact.id ? (
                <div className="mt-2 rounded-lg bg-background/80 p-2">
                  {artifact.content ? (
                    <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-foreground/80">{artifact.content}</pre>
                  ) : (
                    <p className="text-xs text-muted-foreground">{copy.noInlinePreview ?? "No inline preview is available for this artifact."}</p>
                  )}
                  {artifact.sourceNodeId && onAction ? (
                    <button type="button" className="mt-2 text-xs font-semibold text-primary" onClick={() => onAction(artifact.sourceNodeId)}>
                      {copy.locateSourceNode ?? "Locate source node"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
          {hasOverflow ? (
            <button
              type="button"
              className="mt-1 text-xs font-semibold text-primary hover:text-primary/80"
              onClick={() => setShowAll((current) => !current)}
              aria-expanded={showAll}
            >
              {showAll
                ? (copy.showFewerArtifacts ?? "Show fewer")
                : `${copy.showAllArtifacts ?? "Show all"} (${artifacts.length})`}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
