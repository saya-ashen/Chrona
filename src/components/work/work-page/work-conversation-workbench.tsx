"use client";

import { useEffect, useRef, useState } from "react";
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
  const [desktopWorkbenchHeight, setDesktopWorkbenchHeight] = useState<number | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const isConversationTab = activeTab?.id === "conversation";

  useEffect(() => {
    const updateDesktopWorkbenchHeight = () => {
      if (typeof window === "undefined" || window.innerWidth < 1280) {
        setDesktopWorkbenchHeight(null);
        return;
      }

      const shell = shellRef.current;
      if (!shell) {
        return;
      }

      const viewportBottomGap = 16;
      const nextHeight = Math.max(window.innerHeight - shell.getBoundingClientRect().top - viewportBottomGap, 480);
      setDesktopWorkbenchHeight(nextHeight);
    };

    updateDesktopWorkbenchHeight();
    window.addEventListener("resize", updateDesktopWorkbenchHeight);

    return () => {
      window.removeEventListener("resize", updateDesktopWorkbenchHeight);
    };
  }, []);

  return (
    <div
      ref={shellRef}
      data-slot="workbench-shell"
      className="flex min-h-0 flex-1 flex-col gap-4 xl:h-full xl:flex-none"
      style={
        desktopWorkbenchHeight
          ? {
              height: `${desktopWorkbenchHeight}px`,
              flex: `0 0 ${desktopWorkbenchHeight}px`,
            }
          : undefined
      }
    >
      {header ?? null}

      <div className="grid gap-4 xl:min-h-0 xl:h-full xl:flex-1 xl:grid-cols-[minmax(0,1.72fr)_320px] 2xl:grid-cols-[minmax(0,1.86fr)_336px]">
        <section
          aria-label={labels.workbenchAria}
          className={cn(
            "overflow-hidden rounded-[26px] border border-border/80 bg-card shadow-[0_18px_44px_rgba(15,23,42,0.08)] grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] xl:h-full xl:min-h-0",
            isConversationTab ? "" : "",
          )}
        >
          <div className="border-b border-border/70 bg-muted/[0.24] px-5 py-3 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              {conversationHeader.badges.map((badge, index) => (
                <StatusBadge key={`${badge}-${index}`}>{badge}</StatusBadge>
              ))}
            </div>

            <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-foreground sm:text-[1.5rem]">
              {conversationHeader.title}
            </h2>
            <div
              role="tablist"
              aria-label={labels.tabsAria}
              className="mt-3 inline-flex rounded-full border border-border/70 bg-background/80 p-1 shadow-sm"
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
              "min-h-0 overflow-y-auto bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(255,255,255,1))]",
              isConversationTab ? "px-4 py-3 sm:px-5" : "px-5 py-4 sm:px-6",
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
              "sticky bottom-0 border-t border-border/70 bg-muted/[0.18] shadow-[0_-12px_30px_rgba(15,23,42,0.06)] backdrop-blur",
              isConversationTab ? "px-4 py-2 sm:px-5" : "px-5 py-3 sm:px-6",
            )}
          >
            {composer}
          </div>
        </section>

        <aside
          aria-label={labels.planRailAria}
          className="space-y-3 xl:min-h-0 xl:self-start xl:overflow-visible xl:pb-3"
        >
          {planRail}
        </aside>
      </div>
    </div>
  );
}
