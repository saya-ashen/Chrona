import { TriangleAlert } from "lucide-react";
import { Badge, cn } from "@shared/ui";

type DiffProps = { summary: string; confidence: string; risks: string[]; warnings: string[]; taskDiffs: Array<{ key: string; label: string; original: string; proposed: string }>; planSummary: string[]; addedNodes: Array<{ title: string; estimatedMinutes?: number }>; deletedNodeIds: string[] };

function Warnings({ risks, warnings }: Pick<DiffProps, "risks" | "warnings">) {
  return <>{risks.length ? <div className="rounded-2xl border border-warning/30 bg-warning/15 px-4 py-3"><div className="flex items-start gap-2"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" /><div><p className="text-sm font-medium text-foreground">High Risk Changes</p><ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-foreground/80">{risks.map((risk, index) => <li key={`${risk}:${index}`}>{risk}</li>)}</ul></div></div></div> : null}{warnings.length ? <div className="space-y-1.5 rounded-2xl border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">{warnings.map((warning, index) => <div key={`${warning}:${index}`} className="flex items-start gap-1.5"><TriangleAlert className="mt-0.5 size-3 shrink-0 text-warning" /><span>{warning}</span></div>)}</div> : null}</>;
}

function TaskDiffs({ diffs }: { diffs: DiffProps["taskDiffs"] }) {
  if (!diffs.length) return null;
  return <div className="space-y-2"><p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Task Changes ({diffs.length})</p><div className="rounded-2xl border border-border/60 bg-background/80 p-3">{diffs.map((diff) => <TaskDiff key={diff.key} diff={diff} />)}</div></div>;
}

function TaskDiff({ diff }: { diff: DiffProps["taskDiffs"][number] }) {
  const changed = diff.original !== diff.proposed;
  return <div className={cn("grid grid-cols-1 gap-2 border-b border-border/30 py-1.5 text-xs last:border-b-0 sm:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)]", changed && "-mx-2 bg-warning/10 px-2")}><span className="font-medium text-muted-foreground">{diff.label}</span><span className={cn("text-muted-foreground/70 line-through", changed && "text-destructive/60")}>{diff.original || <em>empty</em>}</span><span className={cn(changed && "font-medium text-success")}>{diff.proposed || <em>empty</em>}</span></div>;
}

function PlanChanges({ addedNodes, deletedNodeIds, planSummary }: Pick<DiffProps, "addedNodes" | "deletedNodeIds" | "planSummary">) {
  if (!planSummary.length) return null;
  return <div className="space-y-2"><p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Plan Changes</p><div className="space-y-2 rounded-2xl border border-border/60 bg-background/80 p-4"><Badge variant="secondary">plan patch</Badge><ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">{planSummary.map((point, index) => <li key={`${point}:${index}`}>{point}</li>)}</ul><Nodes nodes={addedNodes} />{deletedNodeIds.length ? <div className="mt-2 text-xs text-destructive"><span className="font-medium">To delete: </span>{deletedNodeIds.join(", ")}</div> : null}</div></div>;
}

function Nodes({ nodes }: { nodes: DiffProps["addedNodes"] }) {
  if (!nodes.length) return null;
  return <div className="mt-2 space-y-1"><p className="text-xs font-medium text-foreground">Nodes:</p>{nodes.map((node, index) => <div key={`${node.title}:${index}`} className="rounded-lg border border-border/40 bg-muted/20 px-3 py-1.5 text-xs"><span className="font-medium text-foreground">{node.title}</span>{node.estimatedMinutes ? <span className="ml-2 text-muted-foreground">({node.estimatedMinutes}m)</span> : null}</div>)}</div>;
}

export function WorkspaceDiffPreview({ props }: { props: DiffProps }) {
  return <div className="space-y-4"><div className="flex items-center justify-between gap-2"><div><h3 className="text-base font-semibold text-foreground">Proposed Changes</h3><p className="mt-1 text-sm text-muted-foreground">{props.summary}</p></div><Badge variant={props.confidence === "low" ? "outline" : "secondary"}>{props.confidence} confidence</Badge></div><Warnings risks={props.risks} warnings={props.warnings} /><TaskDiffs diffs={props.taskDiffs} /><PlanChanges addedNodes={props.addedNodes} deletedNodeIds={props.deletedNodeIds} planSummary={props.planSummary} /></div>;
}
