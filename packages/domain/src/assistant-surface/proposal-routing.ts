import type { AssistantPreviewSurface, AssistantProposalRoute } from "@chrona/contracts";

export function isAssistantPreviewSurface(value: string): value is AssistantPreviewSurface {
  return value === "schedule.timeline" || value === "task.config" || value === "task.graph" || value === "workbench.result";
}

export function createAssistantProposalRoute({
  id,
  surface,
  label,
  baseHref,
  createdAt = new Date().toISOString(),
}: {
  id: string;
  surface: AssistantPreviewSurface;
  label: string;
  baseHref: string;
  createdAt?: string;
}): AssistantProposalRoute {
  const separator = baseHref.includes("?") ? "&" : "?";
  return {
    id,
    surface,
    label,
    href: `${baseHref}${separator}assistantProposal=${encodeURIComponent(id)}&surface=${encodeURIComponent(surface)}`,
    createdAt,
  };
}
