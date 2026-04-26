"use client";

import { useState, useEffect, useRef } from "react";
import { fetchJSON } from "./types";
import type { TimeslotSuggestionResult } from "@chrona/contracts/ai";

export interface SmartTimeslotTaskInput {
  workspaceId: string;
  taskId: string;
  date?: string | Date;
}

export function useSmartTimeslot(taskInput: SmartTimeslotTaskInput | null) {
  const [result, setResult] = useState<TimeslotSuggestionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const inputKey = taskInput
    ? JSON.stringify({
        workspaceId: taskInput.workspaceId,
        taskId: taskInput.taskId,
        date: taskInput.date,
      })
    : null;

  useEffect(() => {
    if (!taskInput || !inputKey) {
      setResult(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    fetchJSON<TimeslotSuggestionResult>(
      "/api/ai/suggest-timeslot",
      {
        workspaceId: taskInput.workspaceId,
        taskId: taskInput.taskId,
        date: taskInput.date,
      },
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          setResult(data);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to suggest timeslot");
          setResult(null);
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey]);

  return { result, isLoading, error };
}
