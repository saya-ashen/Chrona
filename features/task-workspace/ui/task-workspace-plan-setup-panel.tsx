"use client";

import { useLocale } from "@chrona/i18n";
import { Button } from "@shared/ui";
import { Link } from "react-router-dom";
import {
  getPlanSetupPresentation,
  PlanSetupBrief,
  PlanSetupHeader,
  PlanSetupNextSteps,
  type PlanSetupPanelProps,
} from "./task-workspace-plan-setup-content";

export function PlanSetupPanel({
  readiness,
  pageData,
  onGeneratePlan,
  onEditBrief,
}: PlanSetupPanelProps) {
  const locale = useLocale();
  const presentation = getPlanSetupPresentation({ readiness, pageData });

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="plan-setup-panel"
      data-plan-setup-layout="full-width"
    >
      <PlanSetupHeader presentation={presentation} />
      <div className="grid min-h-0 flex-1 gap-0 xl:grid-cols-[minmax(0,1.7fr)_minmax(20rem,0.75fr)]">
        <PlanSetupBrief
          pageData={pageData}
          presentation={presentation}
          onEditBrief={onEditBrief}
        />
        <aside
          className="bg-muted/30 px-5 py-6 lg:px-7 lg:py-7"
          aria-label="Plan creation action"
        >
          <div className="sticky top-4 space-y-6 rounded-2xl border border-primary/20 bg-card p-5 shadow-sm">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                Create draft plan
              </p>
              <p className="text-lg font-semibold text-foreground">
                {presentation.requiredReady}/{presentation.requiredTotal} required checks ready
              </p>
              <p className="text-sm leading-6 text-muted-foreground">
                Creating a plan only prepares a draft. Nothing runs until the plan is reviewed and accepted.
              </p>
            </div>
            <div className="space-y-2">
              {readiness.primaryAction === "configure_provider" ? (
                <Button asChild size="lg" className="w-full">
                  <Link to={`/${locale}/settings?panel=ai-clients`}>
                    Connect AI provider
                  </Link>
                </Button>
              ) : (
                <Button type="button" size="lg" className="w-full" onClick={onGeneratePlan}>
                  Generate plan
                </Button>
              )}
              <Button type="button" variant="outline" className="w-full" onClick={onEditBrief}>
                Edit task brief
              </Button>
            </div>
            <div className="border-t border-border/70 pt-4">
              <p className="text-sm font-medium text-foreground">You stay in control</p>
              <ul className="mt-2 space-y-2 text-xs leading-5 text-muted-foreground">
                <li>Review every proposed step.</li>
                <li>Check human stops and expected output.</li>
                <li>Accept the plan before execution can begin.</li>
              </ul>
            </div>
          </div>
        </aside>
      </div>
      <PlanSetupNextSteps />
    </div>
  );
}

export function PlanGenerationProgressPanel() {
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center px-5 py-10"
      data-testid="plan-generation-progress"
    >
      <div className="w-full max-w-3xl space-y-5 rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <span
            className="mt-1 size-5 shrink-0 animate-spin rounded-full border-2 border-primary/20 border-t-primary"
            aria-label="Plan generation running"
          />
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              Creating draft plan
            </p>
            <h2 className="font-heading text-2xl font-semibold text-foreground">
              Chrona is preparing a reviewable plan
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              The draft will replace this progress view after validation and
              persistence. Nothing executes during plan generation.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
