import type { AutomationTimingPreset } from "@chrona/contracts";

export const AUTOMATION_READINESS_STATES = [
  "ready",
  "provider_not_configured",
  "provider_test_required",
  "provider_unreachable",
  "planning_capability_missing",
  "execution_capability_missing",
  "plan_acceptance_required",
  "schedule_time_missing",
  "auto_execution_disabled",
] as const;

export type AutomationReadiness = (typeof AUTOMATION_READINESS_STATES)[number];

export type AutomationMode =
  | "manual_plan_manual_execute"
  | "auto_plan_manual_approval"
  | "accepted_plan_scheduled_execute";

export type AutomationPolicyPreview = {
  mode: AutomationMode;
  nextOccurrenceAt: string | null;
  willGeneratePlan: boolean;
  requiresPlanAcceptance: boolean;
  willAutoExecute: boolean;
  providerName: string | null;
  readiness: AutomationReadiness;
  pauseConditions: string[];
  missedRunPolicy: string;
  retryPolicy: string;
  processRequirement: string;
  occurrenceKey: string | null;
  disabledReason: string | null;
};

export type AutomationPolicyInput = {
  taskId?: string | null;
  workBlockId?: string | null;
  scheduledStartAt?: string | Date | null;
  autoPlanGeneration: boolean;
  autoExecute: boolean;
  autoPlanGenerationTiming?: AutomationTimingPreset | null;
  autoExecuteTiming?: AutomationTimingPreset | null;
  hasAcceptedPlan?: boolean;
  providerId?: string | null;
  providerName?: string | null;
  providerConfigured?: boolean;
  providerTested?: boolean;
  providerReachable?: boolean;
  planningCapable?: boolean;
  executionCapable?: boolean;
};

const PROCESS_REQUIREMENT =
  "Closing this page does not stop scheduled work. Chrona must be running at the scheduled time; missed starts run on the next scheduler scan.";
const MISSED_RUN_POLICY =
  "If Chrona is not running at the scheduled time, the occurrence starts once on the next scheduler scan.";
const RETRY_POLICY =
  "Chrona does not automatically retry a failed execution. Review the failure before retrying.";

export function automationOccurrenceKey(input: {
  taskId?: string | null;
  workBlockId?: string | null;
  scheduledStartAt?: string | Date | null;
}): string | null {
  const scheduledAt = input.scheduledStartAt
    ? new Date(input.scheduledStartAt).toISOString()
    : null;
  if (!input.taskId || !scheduledAt) return null;
  return `${input.taskId}:${input.workBlockId ?? scheduledAt}`;
}

export type AutomationReadinessInput = Pick<
  AutomationPolicyInput,
  | "providerId"
  | "providerName"
  | "providerConfigured"
  | "providerTested"
  | "providerReachable"
  | "planningCapable"
  | "executionCapable"
  | "hasAcceptedPlan"
  | "scheduledStartAt"
  | "autoExecute"
> & { requiresPlanning: boolean };

export function deriveAutomationReadiness(input: AutomationReadinessInput): {
  readiness: AutomationReadiness;
  disabledReason: string | null;
} {
  if (!input.providerId && !input.providerName) return { readiness: "provider_not_configured", disabledReason: "Connect an AI before enabling automation." };
  if (input.providerConfigured === false) return { readiness: "provider_not_configured", disabledReason: "Finish configuring the selected AI." };
  if (input.providerTested === false) return { readiness: "provider_test_required", disabledReason: "Test the selected AI connection before enabling automation." };
  if (input.providerReachable === false) return { readiness: "provider_unreachable", disabledReason: "The selected AI is unreachable. Test the connection again." };
  if (input.requiresPlanning && input.planningCapable === false) return { readiness: "planning_capability_missing", disabledReason: "The selected AI cannot generate plans." };
  if (input.autoExecute && input.executionCapable === false) return { readiness: "execution_capability_missing", disabledReason: "The selected AI cannot execute tasks." };
  if (input.autoExecute && !input.scheduledStartAt) return { readiness: "schedule_time_missing", disabledReason: "Choose a schedule time before enabling automatic execution." };
  if (input.autoExecute && !input.hasAcceptedPlan) return { readiness: "plan_acceptance_required", disabledReason: "Chrona will generate and accept a valid plan before the scheduled start." };
  return { readiness: "ready", disabledReason: null };
}

export function deriveAutomationPolicyPreview(input: AutomationPolicyInput): AutomationPolicyPreview {
  const scheduledAt = input.scheduledStartAt
    ? new Date(input.scheduledStartAt).toISOString()
    : null;
  const willGeneratePlan = input.autoPlanGeneration || input.autoExecute;
  const willAutoExecute = input.autoExecute;
  const mode: AutomationMode = willAutoExecute
    ? "accepted_plan_scheduled_execute"
    : willGeneratePlan
      ? "auto_plan_manual_approval"
      : "manual_plan_manual_execute";

  const readinessDecision = willGeneratePlan || willAutoExecute
    ? deriveAutomationReadiness({
        ...input,
        scheduledStartAt: scheduledAt,
        requiresPlanning: willGeneratePlan,
      })
    : { readiness: "ready" as const, disabledReason: null };

  const { readiness, disabledReason } = readinessDecision;
  return {
    mode,
    nextOccurrenceAt: scheduledAt,
    willGeneratePlan,
    requiresPlanAcceptance: willGeneratePlan && !willAutoExecute,
    willAutoExecute,
    providerName: input.providerName ?? null,
    readiness,
    pauseConditions: willAutoExecute
      ? ["Execution pauses when input or approval is required.", "Execution stops after a failure until you retry it."]
      : [],
    missedRunPolicy: MISSED_RUN_POLICY,
    retryPolicy: RETRY_POLICY,
    processRequirement: PROCESS_REQUIREMENT,
    occurrenceKey: automationOccurrenceKey(input),
    disabledReason,
  };
}
