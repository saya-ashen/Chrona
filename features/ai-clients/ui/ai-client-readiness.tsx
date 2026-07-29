import { Badge } from "@shared/ui";
import { deriveAutomationReadiness } from "@chrona/domain";
import { providerCapabilityMatrix, type ProviderCapabilityMatrixEntry, type ProviderCapabilityName } from "@chrona/contracts";
import type { AiClientType, ClientFormValues, TestStatus } from "./ai-client-types";

export type ReadinessState = "ready" | "limited" | "warning" | "pending";
export type ReadinessItem = {
  key: "overall" | "configured" | "reachable" | "execution" | "recovery";
  label: string;
  state: ReadinessState;
  detail: string;
};

type ReadinessInput = {
  copy: Record<string, string>;
  type: AiClientType;
  configured: boolean;
  enabled: boolean;
  testStatus: TestStatus;
  testReason: string | null;
  bindings: string[];
};

const EXECUTION_CAPABILITY_CHECKS: ProviderCapabilityName[] = ["healthCheck", "startRun", "streamEvents", "cancelActiveRun", "toolTraces", "structuredOutput"];

function providerMatrixEntry(type: AiClientType): ProviderCapabilityMatrixEntry | undefined {
  return providerCapabilityMatrix.find((entry) => entry.provider === type);
}

function recoveryReadiness(matrix: ProviderCapabilityMatrixEntry | undefined, copy: Record<string, string>): ReadinessItem {
  if (!matrix) return { key: "recovery", label: copy.readinessRecovery, state: "warning", detail: copy.readinessCapabilityUnknown };
  if (!matrix.recovery.sessionResume && !matrix.recovery.historyReplay) return { key: "recovery", label: copy.readinessRecovery, state: "warning", detail: copy.recoveryUnavailable };
  if (matrix.recovery.streamReconnect) return { key: "recovery", label: copy.readinessRecovery, state: "ready", detail: copy.recoveryFull };
  return matrix.recovery.activeRunLookup
    ? { key: "recovery", label: copy.readinessRecovery, state: "limited", detail: copy.recoverySnapshotOnly }
    : { key: "recovery", label: copy.readinessRecovery, state: "limited", detail: copy.recoverySessionHistory };
}

function hasBinding(bindings: string[], candidates: string[]): boolean {
  return bindings.some((binding) => candidates.includes(binding));
}

function executionReadiness(matrix: ProviderCapabilityMatrixEntry | undefined, copy: Record<string, string>): ReadinessItem {
  const missing = matrix ? EXECUTION_CAPABILITY_CHECKS.filter((capability) => !matrix.capabilities[capability]) : [];
  const state = matrix && missing.length === 0 ? "ready" : "warning";
  const detail = !matrix ? copy.readinessCapabilityUnknown : missing.length ? `${copy.readinessCapabilityLimited}: ${missing.join(", ")}` : copy.readinessCapabilityDetail;
  return { key: "execution", label: copy.readinessCapability, state, detail };
}

export function hasBasicConfig(type: AiClientType, values: Pick<ClientFormValues, "baseUrl" | "timeoutSeconds" | "hermesScope">): boolean {
  return type === "hermes" && values.hermesScope === "remote" ? Boolean(values.baseUrl.trim()) : Number(values.timeoutSeconds) > 0;
}

function overallReadiness(input: ReadinessInput): ReadinessItem {
  const readiness = deriveAutomationReadiness({
    providerId: input.configured ? input.type : null,
    providerConfigured: input.configured && input.enabled,
    providerTested: input.testStatus !== "idle",
    providerReachable: input.testStatus === "available",
    planningCapable: hasBinding(input.bindings, ["generate_plan", "generatePlan", "task.plan"]),
    executionCapable: hasBinding(input.bindings, ["task.execution", "execute"]),
    requiresPlanning: true, autoExecute: true, hasAcceptedPlan: true, scheduledStartAt: new Date(0),
  });
  return { key: "overall", label: readiness.readiness === "ready" ? input.copy.ready : input.copy.needsAttention, state: readiness.readiness === "ready" ? "ready" : "pending", detail: readiness.disabledReason ?? input.copy.readinessCapabilityDetail };
}

function configuredReadiness(input: ReadinessInput): ReadinessItem {
  return { key: "configured", label: input.copy.readinessConfigured, state: input.configured && input.enabled ? "ready" : "pending", detail: input.enabled ? input.copy.readinessConfiguredDetail : input.copy.readinessDisabledDetail };
}

function reachableReadiness(input: ReadinessInput): ReadinessItem {
  const reachable = input.testStatus === "available";
  return { key: "reachable", label: input.copy.readinessReachable, state: reachable ? "ready" : input.testStatus === "unavailable" ? "warning" : "pending", detail: reachable ? input.copy.readinessReachableDetail : input.testReason ?? input.copy.readinessRunHealthCheck };
}

export function readinessItems(input: ReadinessInput): ReadinessItem[] {
  const matrix = providerMatrixEntry(input.type);
  return [overallReadiness(input), configuredReadiness(input), reachableReadiness(input), executionReadiness(matrix, input.copy), recoveryReadiness(matrix, input.copy)];
}

function readinessVariant(state: ReadinessState): "default" | "secondary" | "destructive" | "outline" {
  return state === "ready" ? "default" : state === "warning" ? "destructive" : state === "limited" ? "outline" : "secondary";
}

export function ReadinessChecklist({ items }: { items: ReadinessItem[] }) {
  return <div className="grid gap-2 rounded-md border bg-muted/20 p-3" aria-label="Provider readiness">
    {items.map((item) => <div key={item.key} className="flex items-start gap-2 text-xs">
      <Badge variant={readinessVariant(item.state)}>{item.label}</Badge>
      <span className="min-w-0 text-muted-foreground">{item.detail}</span>
    </div>)}
  </div>;
}
