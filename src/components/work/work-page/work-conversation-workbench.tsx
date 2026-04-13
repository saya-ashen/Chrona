"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

type WorkConversationWorkbenchProps = {
  header?: ReactNode;
  conversationHeader: {
    eyebrow: string;
    title: string;
    summary: string;
    badges: string[];
  };
  tabs: Array<{
    id: string;
    label: string;
    content: ReactNode;
  }>;
  defaultTabId?: string;
  composer: ReactNode;
  planRail: ReactNode;
  labels: {
    workbenchAria: string;
    planRailAria: string;
    tabsAria: string;
  };
};

export function WorkConversationWorkbench({
  header,
  conversationHeader,
  tabs,
  defaultTabId,
  composer,
  planRail,
  labels,
}: WorkConversationWorkbenchProps) {
  const [activeTabId, setActiveTabId] = useState(defaultTabId ?? tabs[0]?.id ?? "conversation");
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const isConversationTab = activeTab?.id === "conversation";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 xl:h-full">
      {header ?? null}

      <div className="grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1.72fr)_320px] xl:items-start 2xl:grid-cols-[minmax(0,1.86fr)_336px]">
        <section
          aria-label={labels.workbenchAria}
          className={cn(
            "overflow-hidden rounded-[26px] border border-border/80 bg-card shadow-[0_18px_44px_rgba(15,23,42,0.08)]",
            isConversationTab
              ? "flex flex-col self-start"
              : "grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] xl:h-full",
          )}
        >
          <div
            className={cn(
              "border-b border-border/70 bg-muted/[0.24]",
              isConversationTab ? "px-4 py-2.5 sm:px-5" : "px-5 py-3 sm:px-6",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              {conversationHeader.badges.map((badge, index) => (
                <StatusBadge key={`${badge}-${index}`}>{badge}</StatusBadge>
              ))}
            </div>

            {!isConversationTab && conversationHeader.eyebrow ? (
              <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/[0.85]">
                {conversationHeader.eyebrow}
              </p>
            ) : null}
            <h2
              className={cn(
                "font-semibold tracking-tight text-foreground",
                isConversationTab ? "mt-2 text-[1.35rem]" : "mt-1.5 text-xl sm:text-[1.5rem]",
              )}
            >
              {conversationHeader.title}
            </h2>
            {!isConversationTab && conversationHeader.summary ? (
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                {conversationHeader.summary}
              </p>
            ) : null}

            <div
              role="tablist"
              aria-label={labels.tabsAria}
              className={cn(
                "inline-flex rounded-full border border-border/70 bg-background/80 p-1 shadow-sm",
                isConversationTab ? "mt-2" : "mt-3",
              )}
            >
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`workbench-tab-panel-${tab.id}`}
                    id={`workbench-tab-${tab.id}`}
                    onClick={() => setActiveTabId(tab.id)}
                    className={cn(
                      "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            data-slot="workbench-thread"
            className={cn(
              "bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(255,255,255,1))]",
              isConversationTab
                ? "px-4 py-3 sm:px-5"
                : "min-h-0 overflow-y-auto px-5 py-4 sm:px-6",
            )}
          >
            {activeTab ? (
              <div
                role="tabpanel"
                id={`workbench-tab-panel-${activeTab.id}`}
                aria-labelledby={`workbench-tab-${activeTab.id}`}
                className={cn(isConversationTab ? "" : "min-h-full")}
              >
                {activeTab.content}
              </div>
            ) : null}
          </div>

          <div
            data-slot="workbench-composer-dock"
            className={cn(
              "border-t border-border/70 bg-muted/[0.18] shadow-[0_-12px_30px_rgba(15,23,42,0.06)] backdrop-blur",
              isConversationTab
                ? "px-4 py-2 sm:px-5"
                : "sticky bottom-0 px-5 py-3 sm:px-6",
            )}
          >
            {composer}
          </div>
        </section>

        <aside
          aria-label={labels.planRailAria}
          className="space-y-3 xl:h-full xl:min-h-0 xl:overflow-hidden"
        >
          {planRail}
        </aside>
      </div>
    </div>
  );
}
