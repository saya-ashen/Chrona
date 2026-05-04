"use client";

import type { AutomationSuggestion } from "@chrona/contracts/ai";

export function AutomationSuggestionPanel(_props: {
  suggestion: AutomationSuggestion | null;
  isLoading?: boolean;
  onApplyExecutionMode?: (mode: string) => void;
  onApplyReminder?: (advanceMinutes: number) => void;
}) {
  return null;
}
