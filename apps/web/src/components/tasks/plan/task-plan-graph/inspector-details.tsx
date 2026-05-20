import { cn } from "@/lib/utils";
import type { GraphCopy, PlanNodeAction, PlanNodeDataModel, PlanNodeField } from "./types";

function buildDependencyLabelMap(node: PlanNodeDataModel) {
  const metadataDependencies = node.metadata?.dependencies;
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
  return (node.dependencies ?? [])
    .map((dependencyId) => dependencyLabels.get(dependencyId) ?? nodeTitleById.get(dependencyId) ?? null)
    .filter((value): value is string => Boolean(value));
}

type InspectorDetailsTone = "dark" | "light";

const INSPECTOR_DETAILS_TONE_CLASSNAMES = {
  dark: {
    action: {
      primary: "border border-cyan-300/20 bg-cyan-300/10 text-cyan-100",
      warning: "border border-amber-300/20 bg-amber-300/10 text-amber-100",
      default: "border border-white/10 bg-white/[0.06] text-slate-300",
    },
    card: "border-white/10 bg-white/[0.055]",
    dependency: "border-violet-300/20 bg-violet-300/10 text-violet-100",
    fieldMeta: "text-slate-300",
    label: "text-slate-400",
    sectionTitle: "text-cyan-100/85",
    text: "text-slate-100",
  },
  light: {
    action: {
      primary: "border border-cyan-700/25 bg-cyan-50 text-cyan-900",
      warning: "border border-amber-700/25 bg-amber-50 text-amber-900",
      default: "border border-slate-300 bg-white text-slate-700",
    },
    card: "border-slate-200 bg-white",
    dependency: "border-violet-300 bg-violet-50 text-violet-950",
    fieldMeta: "text-slate-700",
    label: "text-slate-600",
    sectionTitle: "text-slate-950",
    text: "text-slate-950",
  },
} satisfies Record<InspectorDetailsTone, {
  action: { primary: string; warning: string; default: string };
  card: string;
  dependency: string;
  fieldMeta: string;
  label: string;
  sectionTitle: string;
  text: string;
}>;

function InfoRow({ label, tone, value }: { label: string; tone: InspectorDetailsTone; value: string | null }) {
  if (!value) return null;
  const toneClassNames = INSPECTOR_DETAILS_TONE_CLASSNAMES[tone];
  return (
    <div className={cn("rounded-2xl border px-3 py-2", toneClassNames.card)}>
      <p className={cn("text-[10px] font-semibold uppercase tracking-[0.14em]", toneClassNames.label)}>{label}</p>
      <p className={cn("mt-1 text-sm", toneClassNames.text)}>{value}</p>
    </div>
  );
}

function ActionChip({ action, tone }: { action: PlanNodeAction; tone: InspectorDetailsTone }) {
  const toneClassNames = INSPECTOR_DETAILS_TONE_CLASSNAMES[tone];
  return (
    <span
      className={cn(
        "rounded-full px-2 py-1 text-[10px] font-medium",
        action.emphasis === "primary"
          ? toneClassNames.action.primary
          : action.emphasis === "warning"
            ? toneClassNames.action.warning
            : toneClassNames.action.default,
      )}
    >
      {action.label}
    </span>
  );
}

function FieldCard({ field, tone }: { field: PlanNodeField; tone: InspectorDetailsTone }) {
  const toneClassNames = INSPECTOR_DETAILS_TONE_CLASSNAMES[tone];
  return (
    <div className={cn("rounded-2xl border px-3 py-2.5", toneClassNames.card)}>
      <div className="flex items-center justify-between gap-2">
        <p className={cn("text-sm font-medium", toneClassNames.text)}>{field.label}</p>
        {field.required ? <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-1.5 py-0.5 text-[10px] text-amber-100">required</span> : null}
      </div>
      <p className={cn("mt-1 text-[11px] font-medium", toneClassNames.fieldMeta)}>control: {field.control ?? "text"}</p>
      {field.options?.length ? <p className={cn("mt-1 text-[11px] font-medium", toneClassNames.fieldMeta)}>options: {field.options.join(", ")}</p> : null}
    </div>
  );
}

function DependencyChip({ title, tone }: { title: string; tone: InspectorDetailsTone }) {
  const toneClassNames = INSPECTOR_DETAILS_TONE_CLASSNAMES[tone];
  return (
    <span className={cn("inline-flex min-h-8 items-center rounded-2xl border px-3 py-1.5 text-xs font-medium shadow-sm", toneClassNames.dependency)}>
      {title}
    </span>
  );
}

export function TaskPlanGraphInspectorDetails({
  node,
  graphCopy,
  nodes,
  tone = "dark",
}: {
  node: PlanNodeDataModel;
  graphCopy: GraphCopy;
  nodes: PlanNodeDataModel[];
  tone?: InspectorDetailsTone;
}) {
  const dependencyNames = resolveDependencyNames(node, nodes);
  const toneClassNames = INSPECTOR_DETAILS_TONE_CLASSNAMES[tone];

  return (
    <>
      <section className="space-y-2">
        <p className={cn("text-xs font-semibold uppercase tracking-[0.16em]", toneClassNames.sectionTitle)}>{graphCopy.inspectorWhy}</p>
        <InfoRow label={graphCopy.detailObjective} tone={tone} value={node.objective} />
        <InfoRow label={graphCopy.detailNextAction} tone={tone} value={node.nextAction ?? null} />
        <InfoRow label={graphCopy.detailReadiness} tone={tone} value={node.readiness ?? null} />
      </section>

      <section className="space-y-2">
        <p className={cn("text-xs font-semibold uppercase tracking-[0.16em]", toneClassNames.sectionTitle)}>{graphCopy.inspectorDependencies}</p>
        {dependencyNames.length > 0 ? (
          <div className={cn("rounded-2xl border px-3 py-2", toneClassNames.card)}>
            <p className={cn("text-[10px] font-semibold uppercase tracking-[0.14em]", toneClassNames.label)}>{graphCopy.detailDependencies}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {dependencyNames.map((dependencyName) => (
                <DependencyChip key={dependencyName} title={dependencyName} tone={tone} />
              ))}
            </div>
          </div>
        ) : null}
        <InfoRow label={graphCopy.detailRequiredInfo} tone={tone} value={(node.requiredInfo ?? []).join(", ") || null} />
      </section>

      <section className="space-y-2">
        <p className={cn("text-xs font-semibold uppercase tracking-[0.16em]", toneClassNames.sectionTitle)}>{graphCopy.inspectorExecution}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <InfoRow label={graphCopy.detailPhase} tone={tone} value={node.phase} />
          <InfoRow label={graphCopy.detailExecutionMode} tone={tone} value={node.executionMode ?? null} />
          <InfoRow label={graphCopy.detailPriority} tone={tone} value={node.priority ?? null} />
          <InfoRow label={graphCopy.detailEstimatedDuration} tone={tone} value={typeof node.estimatedMinutes === "number" ? `${node.estimatedMinutes} min` : null} />
          <InfoRow label={graphCopy.detailLinkedTask} tone={tone} value={node.linkedTaskId ?? null} />
        </div>
      </section>

      <section className="space-y-2">
        <p className={cn("text-xs font-semibold uppercase tracking-[0.16em]", toneClassNames.sectionTitle)}>{graphCopy.inspectorOutcomes}</p>
        <InfoRow label={graphCopy.detailCompletionSummary} tone={tone} value={node.completionSummary ?? null} />
        <InfoRow label="Branches" tone={tone} value={(node.branchLabels ?? []).join(", ") || null} />
        <InfoRow label="Options" tone={tone} value={(node.options ?? []).join(", ") || null} />
        {(node.availableActions ?? []).length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {(node.availableActions ?? []).map((action) => (
              <ActionChip key={action.id} action={action} tone={tone} />
            ))}
          </div>
        ) : null}
      </section>

      {(node.interactiveFields ?? []).length > 0 ? (
        <section className="space-y-2">
          <p className={cn("text-xs font-semibold uppercase tracking-[0.16em]", toneClassNames.sectionTitle)}>{graphCopy.inspectorFields}</p>
          <div className="space-y-2">
            {(node.interactiveFields ?? []).map((field) => (
              <FieldCard key={field.key} field={field} tone={tone} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
