"use client";

import type { PlanNodeDataModel, TaskPlanGraphPlan } from "../plan/task-plan-graph/types";
import type { TaskPlanReadModel } from "@chrona/contracts";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Textarea } from "@shared/ui";
import type { WorkspaceCopy } from "./task-workspace-plan-utils";

export type PlanReviewDecisionPanelProps = {
  copy: WorkspaceCopy;
  plan: TaskPlanReadModel;
  graphPlan: TaskPlanGraphPlan;
  canAcceptPlan?: boolean;
  isGeneratingPlan: boolean;
  visibleGenerationInstruction: string | null;
  acceptPlanError: string | null;
  revisionInstruction: string;
  selectedNode: PlanNodeDataModel | null;
  onInstructionChange: (value: string) => void;
  onAcceptPlan: () => void;
  onRevisePlan: (selectedNodeId: string | null) => void;
};

type ReviewSummary = {
  humanSteps: number;
  estimatedMinutes: number;
};

function getReviewSummary(graphPlan: TaskPlanGraphPlan): ReviewSummary {
  return {
    humanSteps: graphPlan.nodes.filter((node) =>
      Boolean(
        node.requiresHumanInput ||
          node.checkpoint ||
          ["checkpoint", "user_input"].includes(node.type ?? node.kind ?? "task"),
      ),
    ).length,
    estimatedMinutes: graphPlan.nodes.reduce(
      (sum, node) => sum + (node.estimatedMinutes ?? 0),
      0,
    ),
  };
}

export function PlanReviewSummaryPanel({
  copy,
  plan,
  graphPlan,
  canAcceptPlan,
  isGeneratingPlan,
  acceptPlanError,
  isRevising,
  onToggleRevising,
  onAcceptPlan,
}: Pick<
  PlanReviewDecisionPanelProps,
  "copy" | "plan" | "graphPlan" | "canAcceptPlan" | "isGeneratingPlan" | "acceptPlanError" | "onAcceptPlan"
> & {
  isRevising: boolean;
  onToggleRevising: () => void;
}) {
  const { humanSteps, estimatedMinutes } = getReviewSummary(graphPlan);

  return (
    <Card
      className="gap-2 border-primary/25 bg-primary/5 py-3 shadow-sm"
      data-ui-surface-kind="runtime-control"
    >
      <CardHeader className="gap-1.5 px-3">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="secondary">Plan ready for review</Badge>
          <span className="text-xs text-muted-foreground">
            Revision {plan.revision}
          </span>
        </div>
        <CardTitle className="text-base">Review before continuing</CardTitle>
        <p className="text-xs leading-5 text-muted-foreground">
          Confirm that the steps, assumptions, and user checkpoints match your
          intent.
        </p>
      </CardHeader>
      <CardContent className="space-y-2 px-3">
        <dl className="grid grid-cols-3 gap-2 rounded-lg border border-border/60 bg-background/75 p-2 text-center">
          <ReviewMetric label="Steps" value={graphPlan.nodes.length} />
          <ReviewMetric
            label="Time"
            value={estimatedMinutes > 0 ? `~${estimatedMinutes}m` : "—"}
          />
          <ReviewMetric label="Needs you" value={humanSteps} />
        </dl>
        <div className="rounded-lg border border-border/60 bg-background/75 px-3 py-2 text-xs leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground">What happens next: </span>
          Accepting saves this plan. Execution does not start until you continue
          from the next step.
        </div>
        <div className="grid gap-2">
          <Button
            type="button"
            className="w-full"
            onClick={onAcceptPlan}
            disabled={!canAcceptPlan || isGeneratingPlan}
          >
            {copy.acceptPlan ?? copy.accept ?? "Accept plan"}
          </Button>
          <Button
            type="button"
            className="w-full"
            variant="outline"
            onClick={onToggleRevising}
            aria-expanded={isRevising}
          >
            {isRevising ? "Cancel changes" : "Request changes"}
          </Button>
        </div>
        {acceptPlanError ? (
          <p className="text-xs text-destructive" role="alert">
            {acceptPlanError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ReviewMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  );
}

export function PlanRevisionForm({
  copy,
  visibleGenerationInstruction,
  revisionInstruction,
  selectedNode,
  isGeneratingPlan,
  revisionScope,
  onRevisionScopeChange,
  onInstructionChange,
  onRevisePlan,
}: Pick<
  PlanReviewDecisionPanelProps,
  | "copy"
  | "visibleGenerationInstruction"
  | "revisionInstruction"
  | "selectedNode"
  | "isGeneratingPlan"
  | "onInstructionChange"
  | "onRevisePlan"
> & {
  revisionScope: "plan" | "step";
  onRevisionScopeChange: (scope: "plan" | "step") => void;
}) {
  return (
    <Card
      size="sm"
      className="border-border bg-background py-3"
      role="region"
      aria-label={copy.planRevisionTitle ?? "Plan revision"}
    >
      <CardHeader className="gap-1 px-3">
        <CardTitle className="text-sm">What should Chrona change?</CardTitle>
        <p className="text-xs text-muted-foreground">
          Choose the scope explicitly. Selecting a step for inspection does not
          change it.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 px-3">
        {visibleGenerationInstruction ? (
          <div className="rounded-lg border border-border/60 bg-muted/35 px-2.5 py-2 text-xs">
            <div className="font-medium text-muted-foreground">
              {copy.instructionLabel ?? "Last revision request"}
            </div>
            <div className="mt-1 text-foreground">
              {visibleGenerationInstruction}
            </div>
          </div>
        ) : null}
        <RevisionScopeSelector
          selectedNode={selectedNode}
          revisionScope={revisionScope}
          onRevisionScopeChange={onRevisionScopeChange}
        />
        <label className="block space-y-1.5 text-xs font-medium text-foreground">
          <span>{copy.instructionAria ?? "Plan revision message"}</span>
          <Textarea
            value={revisionInstruction}
            onChange={(event) => onInstructionChange(event.target.value)}
            placeholder={
              copy.instructionPlaceholder ??
              "Tell Chrona what to change in this draft plan..."
            }
            rows={4}
          />
        </label>
        <Button
          type="button"
          className="w-full"
          onClick={() =>
            onRevisePlan(revisionScope === "step" ? (selectedNode?.id ?? null) : null)
          }
          disabled={isGeneratingPlan || !revisionInstruction.trim()}
        >
          {isGeneratingPlan
            ? (copy.generating ?? "Revising...")
            : "Generate revised plan"}
        </Button>
      </CardContent>
    </Card>
  );
}

function RevisionScopeSelector({
  selectedNode,
  revisionScope,
  onRevisionScopeChange,
}: {
  selectedNode: PlanNodeDataModel | null;
  revisionScope: "plan" | "step";
  onRevisionScopeChange: (scope: "plan" | "step") => void;
}) {
  return (
    <div className="grid gap-2" role="radiogroup" aria-label="Revision scope">
      <Button
        type="button"
        size="sm"
        variant={revisionScope === "plan" ? "secondary" : "ghost"}
        className="justify-start"
        role="radio"
        aria-checked={revisionScope === "plan"}
        onClick={() => onRevisionScopeChange("plan")}
      >
        Entire plan
      </Button>
      <Button
        type="button"
        size="sm"
        variant={revisionScope === "step" ? "secondary" : "ghost"}
        className="justify-start"
        role="radio"
        aria-checked={revisionScope === "step"}
        disabled={!selectedNode}
        onClick={() => onRevisionScopeChange("step")}
      >
        {selectedNode
          ? `Selected step: ${selectedNode.title}`
          : "Select a step to revise it"}
      </Button>
    </div>
  );
}
