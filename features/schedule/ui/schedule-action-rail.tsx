import type { ReactNode } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "shared/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ActionRailTab = "queue" | "risks" | "proposals" | "conflicts";

type RailSection = {
  value: ActionRailTab;
  label: string;
  title: string;
  description?: string;
  body: ReactNode;
};

export function ScheduleActionRail({
  id,
  ariaLabel,
  tablistAriaLabel,
  activeTab,
  onTabChange,
  sections,
}: {
  id?: string;
  ariaLabel: string;
  tablistAriaLabel: string;
  activeTab: ActionRailTab;
  onTabChange: (value: ActionRailTab) => void;
  sections: RailSection[];
}) {
  return (
    <Card
      id={id}
      aria-label={ariaLabel}
      className="xl:sticky xl:top-4 xl:self-start"
    >
      <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as ActionRailTab)} className="gap-0">
        <TabsList aria-label={tablistAriaLabel} className="flex h-auto flex-wrap gap-2 bg-transparent p-0">
          {sections.map((section) => (
            <TabsTrigger key={section.value} value={section.value} className="flex-none px-3 py-1.5 text-xs" onClick={() => onTabChange(section.value)}>
              {section.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {sections.map((section) => (
          <TabsContent key={section.value} value={section.value} className="mt-4 space-y-4">
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
              {section.description ? <CardDescription>{section.description}</CardDescription> : null}
            </CardHeader>
            <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">{section.body}</div>
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}
