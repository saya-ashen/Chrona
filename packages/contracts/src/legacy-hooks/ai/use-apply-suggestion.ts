"use client";

import { useState, useCallback } from "react";
import { fetchJSON, type StructuredSuggestion } from "./types";

export function useApplySuggestion() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(
    async (workspaceId: string, suggestion: StructuredSuggestion) => {
      setIsLoading(true);
      setError(null);

      try {
        const data = await fetchJSON<{
          success: boolean;
          taskId?: string;
          suggestionId: string;
          action?: string;
          summary?: string;
        }>("/api/ai/apply-suggestion", { workspaceId, suggestion });

        setIsLoading(false);
        return data;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to apply suggestion";
        setError(message);
        setIsLoading(false);
        return undefined;
      }
    },
    [],
  );

  return { apply, isLoading, error };
}
