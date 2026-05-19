import type { AiSidebarQuickAction } from "@chrona/contracts";
import { useI18n } from "@/i18n/client";

export function QuickActionList({ actions, onAction }: { actions: AiSidebarQuickAction[]; onAction: (action: AiSidebarQuickAction) => void }) {
  const { t } = useI18n();

  return (
    <section className="rounded-3xl border border-border/60 bg-white p-4 shadow-sm" aria-labelledby="ai-actions-title">
      <h2 id="ai-actions-title" className="text-sm font-semibold text-foreground">{t("components.globalAiSidebar.quickActions")}</h2>
      <div className="mt-3 grid gap-2">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={!action.enabled}
            onClick={() => onAction(action)}
            className="rounded-2xl border border-border/60 bg-slate-50 px-3 py-2 text-left transition hover:border-primary/30 hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="flex items-center justify-between gap-3 text-sm font-medium text-foreground">
              {action.label}
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{action.kind === "mutating-preview" ? t("components.globalAiSidebar.previewRequired") : t("components.globalAiSidebar.infoOnly")}</span>
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">{action.enabled ? action.description : action.disabledReason ?? action.description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
