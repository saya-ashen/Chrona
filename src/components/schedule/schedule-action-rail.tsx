import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import {
  SurfaceCard,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/ui/surface-card";

type ActionRailTab = "queue" | "risks" | "proposals";

type RailSection = {
  value: ActionRailTab;
  label: string;
  title: string;
  description?: string;
  body: ReactNode;
};

export function ScheduleActionRail({
  ariaLabel,
  tablistAriaLabel,
  activeTab,
  onTabChange,
  sections,
}: {
  ariaLabel: string;
  tablistAriaLabel: string;
  activeTab: ActionRailTab;
  onTabChange: (value: ActionRailTab) => void;
  sections: RailSection[];
}) {
  const buttonRefs = useRef<Record<ActionRailTab, HTMLButtonElement | null>>({
    queue: null,
    risks: null,
    proposals: null,
  });

  function focusTab(nextIndex: number) {
    const nextSection = sections[nextIndex];

    if (!nextSection) {
      return;
    }

    onTabChange(nextSection.value);
    buttonRefs.current[nextSection.value]?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (sections.length === 0) {
      return;
    }

    switch (event.key) {
      case "ArrowRight": {
        event.preventDefault();
        focusTab((index + 1) % sections.length);
        break;
      }
      case "ArrowLeft": {
        event.preventDefault();
        focusTab((index - 1 + sections.length) % sections.length);
        break;
      }
      case "Home": {
        event.preventDefault();
        focusTab(0);
        break;
      }
      case "End": {
        event.preventDefault();
        focusTab(sections.length - 1);
        break;
      }
    }
  }

  return (
    <SurfaceCard as="aside" aria-label={ariaLabel} className="xl:sticky xl:top-4 xl:self-start">
      <div role="tablist" aria-label={tablistAriaLabel} className="flex flex-wrap gap-2">
        {sections.map((section, index) => (
          <button
            key={section.value}
            type="button"
            role="tab"
            aria-selected={section.value === activeTab}
            aria-controls={`schedule-action-rail-panel-${section.value}`}
            id={`schedule-action-rail-tab-${section.value}`}
            tabIndex={section.value === activeTab ? 0 : -1}
            ref={(element) => {
              buttonRefs.current[section.value] = element;
            }}
            onClick={() => onTabChange(section.value)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
            className={buttonVariants({ variant: section.value === activeTab ? "default" : "ghost", size: "sm" })}
          >
            {section.label}
          </button>
        ))}
      </div>

      {sections.map((section) => {
        const isActive = section.value === activeTab;

        return (
          <div
            key={section.value}
            role="tabpanel"
            id={`schedule-action-rail-panel-${section.value}`}
            aria-labelledby={`schedule-action-rail-tab-${section.value}`}
            tabIndex={isActive ? 0 : -1}
            hidden={!isActive}
            className={isActive ? "mt-4 space-y-4" : "mt-4 hidden space-y-4"}
          >
            <SurfaceCardHeader>
              <SurfaceCardTitle>{section.title}</SurfaceCardTitle>
              {section.description ? <SurfaceCardDescription>{section.description}</SurfaceCardDescription> : null}
            </SurfaceCardHeader>
            <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">{section.body}</div>
          </div>
        );
      })}
    </SurfaceCard>
  );
}
