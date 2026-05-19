import type { AiSidebarPageContextSummary } from "@chrona/contracts";

export function formatContextSummary(context: AiSidebarPageContextSummary) {
  const highlights = context.highlights
    .map((item) => `${item.label}: ${item.value}`)
    .join("; ");
  return highlights ? `${context.title} - ${highlights}` : context.title;
}

export function formatPrimaryAction(context: AiSidebarPageContextSummary) {
  return context.primaryAction ?? "No primary action";
}
