import type {
  AssistantActionRequest,
  AssistantActionResult,
  AssistantSurfacePageType,
  AssistantSurfaceState,
} from "@chrona/contracts";
import { createAssistantProposalRoute, normalizeAssistantAction } from "@chrona/domain";

function unavailableState(pageType: AssistantSurfacePageType, reason: string): AssistantSurfaceState {
  const summary = { id: "unavailable", label: "Status", value: reason, severity: "neutral" as const };
  return {
    pageType,
    fingerprint: `${pageType}:unavailable`,
    title: "Chrona AI",
    primaryObjectLabel: pageType,
    status: "unavailable",
    topSummary: summary,
    summaries: [summary],
    quickActions: [normalizeAssistantAction({
      id: "general-help",
      label: "Ask about this page",
      description: "Get informational guidance for this page.",
      kind: "informational",
      enabled: true,
    })],
    recentProposals: [],
    requestInputEnabled: true,
    unavailableReason: reason,
  };
}

export function getAssistantSurfaceState({ pageType }: { pageType: AssistantSurfacePageType }): AssistantSurfaceState {
  if (pageType === "schedule") return unavailableState(pageType, "Schedule state is supplied by the active page projection.");
  if (pageType === "task") return unavailableState(pageType, "Task state is supplied by the active workspace projection.");
  if (pageType === "workbench") return unavailableState(pageType, "Workbench result actions are available from execution result context.");
  return unavailableState("unsupported", "This page does not expose assistant actions yet.");
}

export function requestAssistantAction(request: AssistantActionRequest): AssistantActionResult {
  const previewSurface = normalizeAssistantAction({
    id: request.actionId,
    label: request.actionId,
    description: "Assistant action request",
    kind: "informational",
    enabled: true,
  }).previewSurface;

  if (!previewSurface) {
    return { kind: "informational", message: request.input?.trim() || "Assistant action queued for page context." };
  }

  const route = createAssistantProposalRoute({
    id: `assistant-${Date.now()}`,
    surface: previewSurface,
    label: request.actionId,
    baseHref: request.pageType === "schedule" ? "/schedule" : "/tasks",
  });
  return { kind: "proposal", message: "Proposal route created. Confirm changes on the owning page.", route };
}
