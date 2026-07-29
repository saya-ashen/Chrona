import type { PlanNodeDataModel } from "../plan/task-plan-graph/types";
import { Badge, Button } from "@shared/ui";
import type { WorkspaceCopy } from "./task-workspace-plan-utils";

type Node = NonNullable<PlanNodeDataModel>;

function NodeDetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return value ? <div className="space-y-0.5"><dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</dt><dd className="text-xs text-foreground">{value}</dd></div> : null;
}

function ActionButton({ action }: { action: NonNullable<Node["availableActions"]>[number] }) {
  const variant = action.emphasis === "primary" ? "default" : action.emphasis === "danger" ? "destructive" : "outline";
  return <Button type="button" size="sm" variant={variant} className="h-7 px-2 text-xs">{action.label}</Button>;
}

function NodeSummary({ copy, node }: { copy: WorkspaceCopy; node: Node }) {
  return <><NodeDetailRow label="Objective" value={node.objective} /><NodeDetailRow label="Summary" value={node.summary} /><NodeDetailRow label="Next action" value={node.nextAction} />{node.userInteractionExpectation === "possible" ? <NodeDetailRow label={copy.possibleUserInputReason ?? "Why input may be needed"} value={node.userInteractionReason} /> : null}</>;
}

function NodeMetrics({ node }: { node: Node }) {
  const estimate = typeof node.estimatedMinutes === "number" ? `${node.estimatedMinutes} min` : null;
  return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><NodeDetailRow label="Mode" value={node.executionMode ?? node.interactionType ?? null} /><NodeDetailRow label="Executor" value={node.executor} /><NodeDetailRow label="Estimate" value={estimate} /><NodeDetailRow label="Depends on" value={node.dependencies?.join(", ") ?? null} /></div>;
}

function NodeActionList({ node }: { node: Node }) {
  return node.availableActions?.length ? <div className="space-y-1.5 rounded-lg border border-border/55 bg-background/70 p-2" data-ui-surface-kind="runtime-control"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Quick actions</p><div className="flex flex-wrap gap-1.5">{node.availableActions.map((action) => <ActionButton key={action.id} action={action} />)}</div></div> : null;
}

function NodeDecisionList({ node }: { node: Node }) {
  const options = [...(node.options ?? []), ...(node.branchLabels ?? [])];
  return options.length ? <div className="space-y-1.5 rounded-lg border border-border/55 bg-muted/25 p-2" data-ui-surface-kind="runtime-control"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Decision options</p><div className="flex flex-wrap gap-1.5">{options.map((option) => <Badge key={option} variant="outline">{option}</Badge>)}</div></div> : null;
}

export function PlanNodeDetailMetadata({ node, copy }: { node: Node; copy: WorkspaceCopy }) {
  return <><NodeSummary node={node} copy={copy} /><NodeMetrics node={node} /><NodeActionList node={node} /><NodeDecisionList node={node} /><NodeDetailRow label="Required info" value={node.requiredInfo?.join(", ") ?? null} /></>;
}
