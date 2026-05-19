import type { AiSidebarPageContextSummary } from "@chrona/contracts";
import { cn } from "@/lib/utils";

export function ContextSummaryCard({ context }: { context: AiSidebarPageContextSummary }) {
  return (
    <section className="rounded-3xl border border-border/60 bg-white p-4 shadow-sm" aria-labelledby="ai-context-title">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Context</p>
      <h2 id="ai-context-title" className="mt-1 text-base font-semibold text-foreground">{context.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{context.primaryObjectLabel}</p>
      <div className="mt-3 grid gap-2">
        {context.highlights.map((item) => (
          <div key={`${item.label}-${item.value}`} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">{item.label}</span>
            <span className={cn("text-right font-medium text-foreground", item.tone === "critical" && "text-red-700", item.tone === "warning" && "text-amber-700", item.tone === "success" && "text-emerald-700")}>{item.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
