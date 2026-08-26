"use client";

import type { ReactNode } from "react";
import { useI18n } from "@chrona/i18n";

import { Badge, Button } from "@shared/ui";
import type { TaskPageData } from "../model/task-workspace-types";
import type { TaskWorkspaceDisplayState } from "../model/task-workspace-interaction";

export type PlanSetupPanelProps = {
  readiness: TaskWorkspaceDisplayState["readiness"];
  pageData: TaskPageData;
  onGeneratePlan: () => void;
  onEditBrief: () => void;
};

export type PlanSetupCopy = {
  planSetupBlockedTitle?: string;
  planSetupBlockedDescription?: string;
  planSetupActionRequired?: string;
  planSetupReadyTitle?: string;
  planSetupReadyDescription?: string;
  planSetupReadyBadge?: string;
  planSetupNowTitle?: string;
  planSetupNowDescriptionWithDetails?: string;
  planSetupNowDescription?: string;
  planSetupOptionalBadge?: string;
  planSetupImproveQuality?: string;
  planSetupAddDetail?: string;
  planSetupWhatHappensNext?: string;
  planSetupDraftStep?: string;
  planSetupReviewStep?: string;
  planSetupNoRunStep?: string;
  planSetupExecutionStep?: string;
};

type SetupPresentation = {
  title: string;
  description: string;
  badgeLabel: string;
  badgeVariant: "destructive" | "secondary" | "outline";
  providerName: string;
  requiredReady: number;
  requiredTotal: number;
  improvements: TaskWorkspaceDisplayState["readiness"]["checks"];
};

export function getPlanSetupPresentation({
  readiness,
  pageData,
  copy,
}: Pick<PlanSetupPanelProps, "readiness" | "pageData"> & {
  copy?: PlanSetupCopy;
}): SetupPresentation {
  const improvements = getRecommendedImprovements(readiness);
  const statusPresentation = getStatusPresentation(
    readiness.status,
    improvements.length,
    copy,
  );

  return {
    ...statusPresentation,
    providerName: getProviderName(pageData),
    requiredReady: countRequiredChecks(readiness, "passed"),
    requiredTotal: countRequiredChecks(readiness),
    improvements,
  };
}

function getRecommendedImprovements(
  readiness: PlanSetupPanelProps["readiness"],
) {
  return readiness.checks.filter(
    (check) => check.level === "recommended" && check.state !== "passed",
  );
}

function getStatusPresentation(
  status: PlanSetupPanelProps["readiness"]["status"],
  improvementCount: number,
  copy: PlanSetupCopy = {},
): Pick<
  SetupPresentation,
  "title" | "description" | "badgeLabel" | "badgeVariant"
> {
  if (status === "blocked") {
    return {
      title:
        copy.planSetupBlockedTitle ?? "Connect an AI provider to create a plan",
      description:
        copy.planSetupBlockedDescription ??
        "Your task brief is saved. Connect an AI provider, then return here to create a draft plan.",
      badgeLabel: copy.planSetupActionRequired ?? "Action required",
      badgeVariant: "destructive",
    };
  }
  if (status === "ready") {
    return {
      title: copy.planSetupReadyTitle ?? "Ready to create a plan",
      description:
        copy.planSetupReadyDescription ??
        "Chrona has enough information to propose reviewable steps for this task.",
      badgeLabel: copy.planSetupReadyBadge ?? "Ready",
      badgeVariant: "secondary",
    };
  }
  return {
    title: copy.planSetupNowTitle ?? "You can create a plan now",
    description:
      improvementCount > 0
        ? (copy.planSetupNowDescriptionWithDetails ??
          "Chrona has enough information for a draft. Adding the details below will make the plan easier to review.")
        : (copy.planSetupNowDescription ??
          "Chrona has enough information to propose reviewable steps for this task."),
    badgeLabel: copy.planSetupOptionalBadge ?? "Optional details",
    badgeVariant: "outline",
  };
}

function getProviderName(pageData: TaskPageData) {
  const provider = pageData.task.aiClientId
    ? pageData.availableAiClients?.find(
        (client) => client.id === pageData.task.aiClientId,
      )
    : pageData.availableAiClients?.find((client) => client.isDefault)
      ?? pageData.availableAiClients?.[0];
  return provider?.name ?? "Not connected";
}

function countRequiredChecks(
  readiness: PlanSetupPanelProps["readiness"],
  state?: "passed",
) {
  return readiness.checks.filter(
    (check) => check.level === "required" && (!state || check.state === state),
  ).length;
}
export function PlanSetupHeader({
  presentation,
}: {
  presentation: SetupPresentation;
}) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  return (
    <header className="border-b border-border/70 px-5 py-5 lg:px-7 lg:py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            {copy.planSetupLabel ?? "Plan setup"}
          </p>
          <h2 className="font-heading text-2xl font-semibold tracking-[-0.03em] text-foreground lg:text-3xl">
            {presentation.title}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground lg:text-base">
            {presentation.description}
          </p>
        </div>
        <Badge variant={presentation.badgeVariant}>
          {presentation.badgeLabel}
        </Badge>
      </div>
    </header>
  );
}

export function PlanSetupBrief({
  pageData,
  presentation,
  onEditBrief,
}: Pick<PlanSetupPanelProps, "pageData" | "onEditBrief"> & {
  presentation: SetupPresentation;
}) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  return (
    <div className="min-w-0 space-y-7 px-5 py-6 lg:px-7 lg:py-7 xl:border-r xl:border-border/70">
      <section aria-labelledby="plan-setup-brief-heading">
        <div className="flex items-center justify-between gap-3">
          <h3
            id="plan-setup-brief-heading"
            className="text-sm font-semibold text-foreground"
          >
            {copy.planSetupBriefTitle ?? "Task brief"}
          </h3>
          <Button type="button" size="sm" variant="ghost" onClick={onEditBrief}>
            {copy.planSetupEditBrief ?? "Edit task brief"}
          </Button>
        </div>
        <dl className="mt-3 grid overflow-hidden rounded-xl border border-border/70 bg-background/60 lg:grid-cols-2">
          <BriefDetail
            label={copy.planSetupGoalLabel ?? "Goal"}
            className="border-b border-border/60 px-4 py-4 lg:col-span-2"
          >
            <span className="text-base font-medium text-foreground">
              {pageData.task.title}
            </span>
          </BriefDetail>
          <BriefDetail
            label={copy.planSetupDescriptionLabel ?? "Description"}
            className="border-b border-border/60 px-4 py-4 lg:border-b-0 lg:border-r"
          >
            <span className="line-clamp-4 text-sm leading-6 text-foreground">
              {pageData.task.description?.trim() ||
                (copy.planSetupNotAdded ?? "Not added yet")}
            </span>
          </BriefDetail>
          <BriefDetail
            label={copy.planSetupProviderLabel ?? "AI provider"}
            className="px-4 py-4"
          >
            <span className="text-sm font-medium text-foreground">
              {presentation.providerName}
            </span>
          </BriefDetail>
        </dl>
      </section>
      {presentation.improvements.length > 0 ? (
        <PlanQualityImprovements
          checks={presentation.improvements}
          onEditBrief={onEditBrief}
        />
      ) : null}
    </div>
  );
}

function BriefDetail({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function PlanQualityImprovements({
  checks,
  onEditBrief,
}: {
  checks: TaskWorkspaceDisplayState["readiness"]["checks"];
  onEditBrief: () => void;
}) {
  const { messages } = useI18n();
  const copy = messages.components
    .taskWorkspace as typeof messages.components.taskWorkspace & PlanSetupCopy;
  return (
    <section aria-labelledby="plan-quality-heading">
      <h3
        id="plan-quality-heading"
        className="text-sm font-semibold text-foreground"
      >
        {copy.planSetupImproveQuality ?? "Improve plan quality"}
      </h3>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {checks.map((check) => (
          <div
            key={check.id}
            className="flex min-h-28 flex-col justify-between gap-4 rounded-xl border border-border/70 bg-background/50 p-4"
          >
            <div>
              <p className="text-sm font-medium text-foreground">
                {check.label}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {check.helperText}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="self-start"
              onClick={onEditBrief}
            >
              {copy.planSetupAddDetail ?? "Add detail"}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
export function PlanSetupNextSteps() {
  const { messages } = useI18n();
  const copy = messages.components
    .taskWorkspace as typeof messages.components.taskWorkspace & PlanSetupCopy;
  return (
    <details className="border-t border-border/70 px-5 py-4 lg:px-7">
      <summary className="cursor-pointer text-sm font-medium text-foreground">
        {copy.planSetupWhatHappensNext ?? "What happens next"}
      </summary>
      <ol className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
        <li>1. {copy.planSetupDraftStep ?? "Chrona creates a draft plan."}</li>
        <li>
          2. {copy.planSetupReviewStep ?? "You review steps and checkpoints."}
        </li>
        <li>
          3. {copy.planSetupNoRunStep ?? "Nothing runs before plan acceptance."}
        </li>
        <li>
          4.{" "}
          {copy.planSetupExecutionStep ??
            "Execution follows the task automation settings."}
        </li>
      </ol>
    </details>
  );
}

export type { SetupPresentation };
