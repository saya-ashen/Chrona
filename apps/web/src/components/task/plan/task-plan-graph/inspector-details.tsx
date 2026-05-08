import { cn } from "@/lib/utils";
import type { GraphCopy, PlanNodeAction, PlanNodeDataModel, PlanNodeField } from "./types";

function buildDependencyLabelMap(node: PlanNodeDataModel) {
  const metadataDependencies = node.metadata.dependencies;
  if (!Array.isArray(metadataDependencies)) {
    return new Map<string, string>();
  }

  const labels = new Map<string, string>();
  for (const dependency of metadataDependencies) {
    if (!dependency || typeof dependency !== "object") continue;
    const record = dependency as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : null;
    if (!id) continue;

    const titleCandidates = [record.title, record.name, record.label, record.nodeTitle, record.description];
    const title = titleCandidates.find((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (title) labels.set(id, title);
  }

  return labels;
}

function resolveDependencyNames(node: PlanNodeDataModel, nodes: PlanNodeDataModel[]) {
  const dependencyLabels = buildDependencyLabelMap(node);
  const nodeTitleById = new Map(nodes.map((item) => [item.id, item.title]));
  return node.dependencies
    .map((dependencyId) => dependencyLabels.get(dependencyId) ?? nodeTitleById.get(dependencyId) ?? null)
    .filter((value): value is string => Boolean(value));
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="rounded-2xl border border-border/60 bg-background/80 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  );
}

function ActionChip({ action }: { action: PlanNodeAction }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-1 text-[10px] font-medium",
        action.emphasis === "primary"
          ? "bg-primary/12 text-primary"
          : action.emphasis === "warning"
            ? "bg-amber-100 text-amber-800"
            : "bg-foreground/6 text-muted-foreground",
      )}
    >
      {action.label}
    </span>
  );
}

function FieldCard({ field }: { field: PlanNodeField }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/80 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{field.label}</p>
        {field.required ? <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">required</span> : null}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">control: {field.control ?? "text"}</p>
      {field.options?.length ? <p className="mt-1 text-[11px] text-muted-foreground">options: {field.options.join(", ")}</p> : null}
    </div>
  );
}

function DependencyChip({ title }: { title: string }) {
  return (
    <span className="inline-flex min-h-8 items-center rounded-2xl border border-violet-200/70 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-900 shadow-sm dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-100">
      {title}
    </span>
  );
}

export function TaskPlanGraphInspectorDetails({
  node,
  graphCopy,
  nodes,
}: {
  node: PlanNodeDataModel;
  graphCopy: GraphCopy;
  nodes: PlanNodeDataModel[];
}) {
  const dependencyNames = resolveDependencyNames(node, nodes);

  return (
    <>
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{graphCopy.inspectorWhy}</p>
        <InfoRow label={graphCopy.detailObjective} value={node.objective} />
        <InfoRow label={graphCopy.detailNextAction} value={node.nextAction} />
        <InfoRow label={graphCopy.detailReadiness} value={node.readiness} />
      </section>

      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{graphCopy.inspectorDependencies}</p>
        {dependencyNames.length > 0 ? (
          <div className="rounded-2xl border border-border/60 bg-background/80 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{graphCopy.detailDependencies}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {dependencyNames.map((dependencyName) => (
                <DependencyChip key={dependencyName} title={dependencyName} />
              ))}
            </div>
          </div>
        ) : null}
        <InfoRow label={graphCopy.detailRequiredInfo} value={node.requiredInfo.join(", ") || null} />
      </section>

      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{graphCopy.inspectorExecution}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <InfoRow label={graphCopy.detailPhase} value={node.phase} />
          <InfoRow label={graphCopy.detailExecutionMode} value={node.executionMode} />
          <InfoRow label={graphCopy.detailPriority} value={node.priority} />
          <InfoRow label={graphCopy.detailEstimatedDuration} value={typeof node.estimatedMinutes === "number" ? `${node.estimatedMinutes} min` : null} />
          <InfoRow label={graphCopy.detailLinkedTask} value={node.linkedTaskId} />
        </div>
      </section>

      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{graphCopy.inspectorOutcomes}</p>
        <InfoRow label={graphCopy.detailCompletionSummary} value={node.completionSummary} />
        <InfoRow label="Branches" value={node.branchLabels.join(", ") || null} />
        <InfoRow label="Options" value={node.options.join(", ") || null} />
        {node.availableActions.length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {node.availableActions.map((action) => (
              <ActionChip key={action.id} action={action} />
            ))}
          </div>
        ) : null}
      </section>

      {node.interactiveFields.length > 0 ? (
        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{graphCopy.inspectorFields}</p>
          <div className="space-y-2">
            {node.interactiveFields.map((field) => (
              <FieldCard key={field.key} field={field} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
