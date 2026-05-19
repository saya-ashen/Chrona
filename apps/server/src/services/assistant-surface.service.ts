import type {
  AssistantActionRequest,
  AssistantActionResult,
  AssistantSurfacePageType,
  AssistantSurfaceState,
} from "@chrona/contracts";
import { createAssistantProposalRoute, normalizeAssistantAction } from "@chrona/domain";
import { getAssistantSurfaceMessages, type Locale } from "@chrona/i18n";

function unavailableState(pageType: AssistantSurfacePageType, reason: string, locale: Locale): AssistantSurfaceState {
  const messages = getAssistantSurfaceMessages(locale);
  const summary = { id: "unavailable", label: messages.statusLabel, value: reason, severity: "neutral" as const };
  return {
    pageType,
    fingerprint: `${pageType}:unavailable`,
    title: messages.title,
    primaryObjectLabel: pageType,
    status: "unavailable",
    topSummary: summary,
    summaries: [summary],
    quickActions: [normalizeAssistantAction({
      id: "general-help",
      label: messages.askAboutPage,
      description: messages.informationalGuidance,
      kind: "informational",
      enabled: true,
    })],
    recentProposals: [],
    requestInputEnabled: true,
    unavailableReason: reason,
  };
}

export function getAssistantSurfaceState({ pageType, locale }: { pageType: AssistantSurfacePageType; locale?: Locale }): AssistantSurfaceState {
  const resolvedLocale = locale ?? "en";
  const messages = getAssistantSurfaceMessages(resolvedLocale);
  if (pageType === "schedule") return unavailableState(pageType, messages.scheduleUnavailable, resolvedLocale);
  if (pageType === "task") return unavailableState(pageType, messages.taskUnavailable, resolvedLocale);
  if (pageType === "workbench") return unavailableState(pageType, messages.workbenchUnavailable, resolvedLocale);
  return unavailableState("unsupported", messages.unsupportedUnavailable, resolvedLocale);
}

export function requestAssistantAction(request: AssistantActionRequest, locale: Locale = "en"): AssistantActionResult {
  const messages = getAssistantSurfaceMessages(locale);
  const previewSurface = normalizeAssistantAction({
    id: request.actionId,
    label: request.actionId,
    description: messages.actionRequestDescription,
    kind: "informational",
    enabled: true,
  }).previewSurface;

  if (!previewSurface) {
    return { kind: "informational", message: request.input?.trim() || messages.actionQueued };
  }

  const route = createAssistantProposalRoute({
    id: `assistant-${Date.now()}`,
    surface: previewSurface,
    label: request.actionId,
    baseHref: request.pageType === "schedule" ? "/schedule" : "/tasks",
  });
  return { kind: "proposal", message: messages.proposalCreated, route };
}
