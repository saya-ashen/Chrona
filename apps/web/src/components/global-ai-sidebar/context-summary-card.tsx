import type { AiSidebarPageContextSummary } from "@chrona/contracts";
import { cn } from "@shared/ui"

export function ContextSummaryCard({ context }: { context: AiSidebarPageContextSummary }) {
  return (
    <section className="rounded-3xl border border-border/60 bg-card p-4 shadow-sm" aria-labelledby="ai-context-title">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Context</p>
      <h2 id="ai-context-title" className="mt-1 text-base font-semibold text-foreground">{context.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{context.primaryObjectLabel}</p>
      <div className="mt-3 grid gap-2">
        {context.highlights.map((item) => (
          <div key={`${item.label}-${item.value}`} className="flex items-center justify-between gap-3 rounded-2xl bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">{item.label}</span>
            <span className={cn("text-right font-medium text-foreground", item.tone === "critical" && "text-destructive", item.tone === "warning" && "text-warning-foreground", item.tone === "success" && "text-success")}>{item.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
