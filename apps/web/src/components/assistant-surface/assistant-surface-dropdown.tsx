"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, Command, Sparkles } from "lucide-react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { useI18n } from "@chrona/i18n/react";
import { cn } from "@/lib/utils";
import { useAssistantSurface } from "./assistant-surface-provider";

const severityClass = {
  critical: "border-red-200 bg-red-50 text-red-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
};

export function AssistantSurfaceDropdown() {
  const { t } = useI18n();
  const assistant = useAssistantSurface();
  const surface = assistant.state;
  const isOpen = assistant.isOpen;
  const close = assistant.close;
  const panelRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
      return;
    }

    if (!shouldRender) return;

    setIsClosing(true);
    const timeout = window.setTimeout(() => {
      setShouldRender(false);
      setIsClosing(false);
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [isOpen, shouldRender]);

  useEffect(() => {
    if (!isOpen) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (panelRef.current?.contains(target)) return;
      if (target.closest('[data-assistant-surface-trigger="true"]')) return;
      close();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, isOpen]);

  if (!shouldRender) return null;

  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label={t("components.assistantSurface.panelLabel")}
      className={cn(
        "absolute inset-x-0 top-full z-[1000] origin-top overflow-hidden rounded-b-[1.45rem] rounded-t-none border border-t-0 border-border/70 bg-background/95 shadow-[0_14px_34px_rgba(15,23,42,0.14)] backdrop-blur will-change-[clip-path,opacity,transform]",
        isClosing
          ? "pointer-events-none animate-[assistant-surface-curtain-up_180ms_cubic-bezier(0.4,0,1,1)_forwards]"
          : "animate-[assistant-surface-curtain-down_220ms_cubic-bezier(0.16,1,0.3,1)]",
      )}
    >
      <div className="border-b border-border/60 bg-[linear-gradient(135deg,rgba(248,250,252,0.96),rgba(239,246,255,0.82))] px-4 py-3 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              <Sparkles className="size-3.5" />
              {t("components.assistantSurface.eyebrow")}
            </p>
            <h2 className="mt-1 truncate text-base font-semibold text-foreground">{surface.title}</h2>
            <p className="truncate text-xs text-muted-foreground">{surface.primaryObjectLabel}</p>
          </div>
          <button type="button" onClick={close} className="rounded-full border border-border/70 px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
            {t("components.assistantSurface.close")}
          </button>
        </div>
      </div>

      <div className="grid max-h-[min(72dvh,640px)] gap-3 overflow-y-auto bg-slate-50/35 p-3 sm:p-4 lg:grid-cols-[280px_minmax(0,1fr)_320px] xl:grid-cols-[300px_minmax(0,1fr)_340px]">
        <section className="space-y-3 rounded-[1.2rem] border border-border/70 bg-white/82 p-3 shadow-sm backdrop-blur" aria-label={t("components.assistantSurface.contextDeck")}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Activity className="size-3.5" />
              {t("components.assistantSurface.contextDeck")}
            </h3>
            <span className="rounded-full border border-border/70 bg-white px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{surface.status}</span>
          </div>
          <div className={cn("rounded-2xl border px-3 py-2", severityClass[surface.topSummary.severity])}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-75">{surface.topSummary.label}</p>
            <p className="mt-1 text-lg font-semibold leading-tight">{surface.topSummary.value}</p>
          </div>
          <div className="space-y-2">
            <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("components.assistantSurface.summaries")}</p>
            {surface.summaries.slice(0, 4).map((summary) => (
              <div key={summary.id} className="rounded-2xl border border-slate-200/80 bg-white px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{summary.label}</p>
                <p className="mt-0.5 text-sm font-medium text-slate-950">{summary.value}</p>
              </div>
            ))}
          </div>
          {surface.status === "unavailable" ? (
            <p className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-muted-foreground">
              {surface.unavailableReason ?? t("components.assistantSurface.unavailable")}
            </p>
          ) : null}
        </section>

        <section className="rounded-[1.2rem] border border-border/70 bg-white/88 p-3 shadow-sm backdrop-blur" aria-label={t("components.assistantSurface.actionBoard")}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Command className="size-3.5" />
              {t("components.assistantSurface.actionBoard")}
            </h3>
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">{surface.quickActions.length}</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {surface.quickActions.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">{t("components.assistantSurface.noActions")}</p>
            ) : surface.quickActions.map((action) => (
              <button
                key={action.id}
                type="button"
                disabled={!action.enabled}
                onClick={() => assistant.runQuickAction(action)}
                className="group flex min-h-[104px] flex-col justify-between rounded-2xl border border-border/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(248,250,252,0.86))] px-3 py-2 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary-soft/40 hover:shadow-md disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-muted-foreground disabled:shadow-none disabled:hover:translate-y-0"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">{action.label}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    {action.previewRequired ? t("components.assistantSurface.previewRequired") : t("components.assistantSurface.infoOnly")}
                  </span>
                </span>
                <span className="mt-3 block text-xs leading-relaxed text-muted-foreground">{action.enabled ? action.description : action.disabledReason}</span>
              </button>
            ))}
          </div>
        </section>

        <aside className="flex min-h-[260px] flex-col rounded-[1.2rem] border border-border/70 bg-slate-950 p-3 text-white shadow-sm" aria-label={t("components.assistantSurface.commandDock")}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">{t("components.assistantSurface.commandDock")}</h3>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-slate-300">{surface.pageType}</span>
          </div>
          <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto">
            <section>
              <h4 className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{t("components.assistantSurface.recentProposals")}</h4>
            <div className="mt-2 space-y-2">
                {surface.recentProposals.length > 0 ? surface.recentProposals.map((proposal) => (
                  <LocalizedLink key={proposal.id} href={proposal.href} className="block rounded-2xl border border-primary/40 bg-primary/15 px-3 py-2 text-sm font-semibold text-white hover:bg-primary/25">
                    {proposal.label}
                  </LocalizedLink>
                )) : (
                  <p className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400">{t("components.assistantSurface.noProposals")}</p>
                )}
            </div>
            </section>

            <section>
              <h4 className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{t("components.assistantSurface.messages")}</h4>
              <div className="mt-2 space-y-2">
                {assistant.messages.length > 0 ? assistant.messages.slice(-4).map((message, index) => (
                  <p key={`${message}-${index}`} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs leading-relaxed text-slate-200">{message}</p>
                )) : (
                  <p className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400">{t("components.assistantSurface.noMessages")}</p>
                )}
              </div>
            </section>
          </div>

          <form
            className="mt-3 flex gap-2 border-t border-white/10 pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              assistant.submitRequest(assistant.input);
            }}
          >
            <input
              value={assistant.input}
              onChange={(event) => assistant.setInput(event.currentTarget.value)}
              disabled={!surface.requestInputEnabled}
              placeholder={t("components.assistantSurface.inputPlaceholder")}
              className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-400 focus:border-primary/60"
            />
            <button type="submit" className="rounded-2xl bg-primary px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-700 disabled:text-slate-400" disabled={!assistant.input.trim()}>
              {t("components.assistantSurface.send")}
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}
