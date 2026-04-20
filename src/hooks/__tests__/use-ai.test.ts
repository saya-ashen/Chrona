import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useAutoComplete,
  useSmartAutomation,
  useSmartDecomposition,
  useBatchApplyPlan,
  useSmartTimeslot,
} from "../use-ai";
import type { AutoCompleteSuggestion, SmartAutomationTaskInput, SmartDecompositionTaskInput, SmartTimeslotTaskInput } from "../use-ai";
import type { AutomationSuggestion } from "@/modules/ai/types";

// ---------- Helpers ----------

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Flush microtasks so Promises from mocked fetch settle inside act(). */
async function flushPromises() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    // need real setTimeout tick to process; advance fake timers by 0 as well
  });
}

const sampleSuggestions: AutoCompleteSuggestion[] = [
  {
    title: "Write unit tests",
    description: "Write comprehensive unit tests for the module",
    priority: "High",
    estimatedMinutes: 60,
    tags: ["testing", "development"],
  },
  {
    title: "Write integration tests",
    description: "Write integration tests for the API endpoints",
    priority: "Medium",
    estimatedMinutes: 45,
    tags: ["testing"],
  },
];

const sampleAutomationSuggestion: AutomationSuggestion = {
  executionMode: "scheduled",
  reminderStrategy: {
    advanceMinutes: 15,
    frequency: "once",
    channels: ["push"],
  },
  preparationSteps: ["Gather requirements", "Set up environment"],
  contextSources: [{ type: "docs", description: "Project documentation" }],
  confidence: "high",
};

const samplePlanGraphResponse = {
  source: "ai",
  planGraph: {
    id: "graph-1",
    taskId: "task-1",
    status: "draft",
    revision: 1,
    source: "ai",
    generatedBy: "test",
    prompt: null,
    summary: "2 steps",
    changeSummary: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    nodes: [
      { id: "node-1", type: "step", title: "Research", objective: "Research the topic", executionMode: "automatic", autoRunnable: true, requiresHumanInput: false, requiresHumanApproval: false, blockingReason: null, status: "pending", estimatedMinutes: 30, priority: "High" },
      { id: "node-2", type: "step", title: "Implementation", objective: "Implement the solution", executionMode: "automatic", autoRunnable: true, requiresHumanInput: false, requiresHumanApproval: false, blockingReason: null, status: "pending", estimatedMinutes: 120, priority: "High" },
    ],
    edges: [{ id: "edge-1", fromNodeId: "node-1", toNodeId: "node-2", type: "sequential" }],
  },
};

// NOTE: The hook returns raw JSON from the API (no Date parsing),
// so dates come back as ISO strings, not Date objects.
const sampleTimeslotResult = {
  suggestions: [
    {
      startAt: "2025-06-01T09:00:00.000Z",
      endAt: "2025-06-01T10:00:00.000Z",
      score: 0.95,
      reasons: ["Morning peak productivity"],
      conflicts: [],
    },
  ],
  bestMatch: {
    startAt: "2025-06-01T09:00:00.000Z",
    endAt: "2025-06-01T10:00:00.000Z",
    score: 0.95,
    reasons: ["Morning peak productivity"],
    conflicts: [],
  },
};

const sampleBatchApplyPlanResponse = {
  parentTaskId: "task-123",
  childTasks: [
    { id: "child-1", title: "Step 1" },
    { id: "child-2", title: "Step 2" },
  ],
  planGraph: { id: "graph-1", nodes: [], edges: [] },
};

// ---------- useAutoComplete ----------

describe("useAutoComplete", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should not fetch when title is null", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useAutoComplete(null));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should not fetch when title is less than 3 chars", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useAutoComplete("ab"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should not fetch when title is only whitespace under 3 chars", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useAutoComplete("  a "));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.suggestions).toEqual([]);
  });

  it("should set isLoading=true immediately when title >= 3 chars, before debounce fires", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ suggestions: [] })));

    const { result } = renderHook(() => useAutoComplete("Write tests"));

    // isLoading should be true even before debounce fires
    expect(result.current.isLoading).toBe(true);
  });

  it("should debounce and fetch after delay when title >= 3 chars", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ suggestions: sampleSuggestions }));
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() => useAutoComplete("Write tests", 300));

    // Before debounce — fetch should not have been called
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    // After debounce
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/ai/auto-complete",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Write tests" }),
      }),
    );
  });

  it("should return suggestions on successful response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ suggestions: sampleSuggestions }));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useAutoComplete("Write tests", 100));

    // Advance past debounce and flush promises
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.suggestions).toEqual(sampleSuggestions);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should set error on failed request (HTTP error with error body)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ error: "AI service unavailable" }, 503));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useAutoComplete("Write tests", 100));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.error).toBe("AI service unavailable");
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("should set generic error message on failed request without parseable error body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response("not json", { status: 500, headers: { "Content-Type": "text/plain" } }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useAutoComplete("Write tests", 100));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.error).toBe("Request failed (500)");
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("should handle network errors gracefully", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useAutoComplete("Write tests", 100));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.error).toBe("fetch failed");
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("should abort previous request when title changes", async () => {
    let fetchCallCount = 0;
    const fetchSpy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      fetchCallCount++;
      return Promise.resolve(jsonResponse({ suggestions: sampleSuggestions }));
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { rerender } = renderHook(
      ({ title }: { title: string }) => useAutoComplete(title, 100),
      { initialProps: { title: "First query" } },
    );

    // Fire first debounce
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Change title — triggers cleanup which aborts previous, then new debounce
    rerender({ title: "Second query" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // Second call should be with the new title
    expect(fetchSpy.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({ title: "Second query" }),
      }),
    );
  });

  it("should reset state when title becomes null after having suggestions", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ suggestions: sampleSuggestions }));
    vi.stubGlobal("fetch", fetchSpy);

    const { result, rerender } = renderHook(
      ({ title }: { title: string | null }) => useAutoComplete(title, 100),
      { initialProps: { title: "Write tests" as string | null } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.suggestions).toEqual(sampleSuggestions);

    // Set title to null
    rerender({ title: null });

    expect(result.current.suggestions).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should use custom debounce delay", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ suggestions: sampleSuggestions }));
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() => useAutoComplete("Write tests", 1000));

    // Should not have fetched at 500ms
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    // Should fetch at 1000ms
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("should handle response with missing suggestions field gracefully", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useAutoComplete("Write tests", 100));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // The hook does `data.suggestions ?? []`
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should use default 500ms debounce when not specified", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ suggestions: [] }));
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() => useAutoComplete("Write tests"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});

// ---------- useSmartAutomation ----------

describe("useSmartAutomation", () => {
  const validInput: SmartAutomationTaskInput = {
    title: "Deploy application",
    description: "Deploy the app to production",
    priority: "High",
    dueAt: "2025-06-01T00:00:00Z",
    isRunnable: true,
    runnabilityState: "ready",
    ownerType: "user",
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should not fetch when input is null", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useSmartAutomation(null));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.suggestion).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should not fetch when input title is too short", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      useSmartAutomation({ ...validInput, title: "ab" }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.suggestion).toBeNull();
  });

  it("should debounce and fetch on valid input", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(sampleAutomationSuggestion));
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() => useSmartAutomation(validInput));

    // Before debounce (500ms hardcoded)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    // After debounce
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/ai/suggest-automation",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ taskId: "preview", ...validInput }),
      }),
    );
  });

  it("should return suggestion on success", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(sampleAutomationSuggestion));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useSmartAutomation(validInput));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(result.current.suggestion).toEqual(sampleAutomationSuggestion);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should handle error gracefully", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ error: "Automation service error" }, 500));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useSmartAutomation(validInput));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(result.current.error).toBe("Automation service error");
    expect(result.current.suggestion).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("should set isLoading=true immediately on valid input", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(sampleAutomationSuggestion)));

    const { result } = renderHook(() => useSmartAutomation(validInput));

    expect(result.current.isLoading).toBe(true);
  });

  it("should reset state when input becomes null", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(sampleAutomationSuggestion));
    vi.stubGlobal("fetch", fetchSpy);

    const { result, rerender } = renderHook(
      ({ input }: { input: SmartAutomationTaskInput | null }) =>
        useSmartAutomation(input),
      { initialProps: { input: validInput as SmartAutomationTaskInput | null } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(result.current.suggestion).toEqual(sampleAutomationSuggestion);

    // Set input to null
    rerender({ input: null });

    expect(result.current.suggestion).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should handle network errors", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useSmartAutomation(validInput));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(result.current.error).toBe("fetch failed");
    expect(result.current.suggestion).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});

// ---------- useSmartDecomposition ----------

describe("useSmartDecomposition", () => {
  const validInput: SmartDecompositionTaskInput = {
    taskId: "task-abc",
    title: "Build new feature",
    description: "Build a new user dashboard feature",
    priority: "High",
    estimatedMinutes: 180,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should not fetch when input is null", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useSmartDecomposition(null));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.result).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should not fetch when input title is too short", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      useSmartDecomposition({ ...validInput, title: "ab" }),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.result).toBeNull();
  });

  it("should fetch immediately (no debounce) when input provided", () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(samplePlanGraphResponse));
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() => useSmartDecomposition(validInput));

    // No debounce — fetch is called directly in the effect
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/ai/generate-task-plan",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          taskId: validInput.taskId,
          title: validInput.title,
          description: validInput.description,
          priority: validInput.priority,
          dueAt: validInput.dueAt,
          estimatedMinutes: validInput.estimatedMinutes,
        }),
      }),
    );
  });

  it("should return TaskPlanGraphResponse on success", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(samplePlanGraphResponse));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useSmartDecomposition(validInput));

    // Wait for the async fetch to settle
    await act(async () => {
      // flush microtasks
    });

    expect(result.current.result).toEqual(samplePlanGraphResponse);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should handle error state", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ error: "Decomposition failed" }, 500));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useSmartDecomposition(validInput));

    await act(async () => {
      // flush microtasks
    });

    expect(result.current.error).toBe("Decomposition failed");
    expect(result.current.result).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("should set isLoading=true when fetching", () => {
    // Use a fetch that never resolves to capture loading state
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

    const { result } = renderHook(() => useSmartDecomposition(validInput));

    expect(result.current.isLoading).toBe(true);
  });

  it("should abort previous request when input changes", () => {
    const abortSpy = vi.fn();
    const originalAbortController = globalThis.AbortController;

    vi.stubGlobal(
      "AbortController",
      class {
        signal = { aborted: false };
        abort() {
          this.signal.aborted = true;
          abortSpy();
        }
      },
    );

    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(samplePlanGraphResponse));
    vi.stubGlobal("fetch", fetchSpy);

    const { rerender } = renderHook(
      ({ input }: { input: SmartDecompositionTaskInput }) =>
        useSmartDecomposition(input),
      { initialProps: { input: validInput } },
    );

    // Change input — cleanup should abort previous controller
    rerender({ input: { ...validInput, title: "Different task" } });

    expect(abortSpy).toHaveBeenCalled();

    vi.stubGlobal("AbortController", originalAbortController);
  });

  it("should reset state when input becomes null", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(samplePlanGraphResponse));
    vi.stubGlobal("fetch", fetchSpy);

    const { result, rerender } = renderHook(
      ({ input }: { input: SmartDecompositionTaskInput | null }) =>
        useSmartDecomposition(input),
      { initialProps: { input: validInput as SmartDecompositionTaskInput | null } },
    );

    await act(async () => {
      // flush
    });

    expect(result.current.result).toEqual(samplePlanGraphResponse);

    rerender({ input: null });

    expect(result.current.result).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should handle network errors", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useSmartDecomposition(validInput));

    await act(async () => {
      // flush
    });

    expect(result.current.error).toBe("fetch failed");
    expect(result.current.result).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("should send all task fields in the request body", () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(samplePlanGraphResponse));
    vi.stubGlobal("fetch", fetchSpy);

    const input: SmartDecompositionTaskInput = {
      taskId: "t-1",
      title: "Test task with all fields",
      description: "Detailed description",
      priority: "Urgent",
      dueAt: "2025-12-31",
      estimatedMinutes: 240,
    };

    renderHook(() => useSmartDecomposition(input));

    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sentBody).toEqual({
      taskId: "t-1",
      title: "Test task with all fields",
      description: "Detailed description",
      priority: "Urgent",
      dueAt: "2025-12-31",
      estimatedMinutes: 240,
    });
  });
});

// ---------- useBatchApplyPlan ----------

describe("useBatchApplyPlan", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should call API when applyPlan() is called", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(sampleBatchApplyPlanResponse));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useBatchApplyPlan());

    await act(async () => {
      await result.current.applyPlan("task-123");
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/ai/batch-apply-plan",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ taskId: "task-123" }),
      }),
    );
  });

  it("should return response data on success", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(sampleBatchApplyPlanResponse));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useBatchApplyPlan());

    let data: unknown;
    await act(async () => {
      data = await result.current.applyPlan("task-123");
    });

    expect(data).toEqual(sampleBatchApplyPlanResponse);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should set error on failure", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ error: "Failed to apply task plan" }, 500));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useBatchApplyPlan());

    let data: unknown;
    await act(async () => {
      data = await result.current.applyPlan("task-123");
    });

    expect(data).toBeUndefined();
    expect(result.current.error).toBe("Failed to apply task plan");
    expect(result.current.isLoading).toBe(false);
  });

  it("should track isLoading", async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchSpy = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useBatchApplyPlan());

    // Start applyPlan but don't await yet
    let applyPromise: Promise<unknown>;
    act(() => {
      applyPromise = result.current.applyPlan("task-123");
    });

    // isLoading should be true while request is in-flight
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();

    // Resolve the fetch
    await act(async () => {
      resolveFetch(jsonResponse(sampleBatchApplyPlanResponse));
      await applyPromise!;
    });

    expect(result.current.isLoading).toBe(false);
  });

  it("should handle network errors", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useBatchApplyPlan());

    let data: unknown;
    await act(async () => {
      data = await result.current.applyPlan("task-123");
    });

    expect(data).toBeUndefined();
    expect(result.current.error).toBe("fetch failed");
    expect(result.current.isLoading).toBe(false);
  });

  it("should abort previous request when applyPlan() called again", async () => {
    const abortSpy = vi.fn();
    const originalAbortController = globalThis.AbortController;

    let controllerCount = 0;
    vi.stubGlobal(
      "AbortController",
      class {
        signal = { aborted: false };
        id = ++controllerCount;
        abort() {
          this.signal.aborted = true;
          abortSpy(this.id);
        }
      },
    );

    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(sampleBatchApplyPlanResponse));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useBatchApplyPlan());

    await act(async () => {
      const p1 = result.current.applyPlan("task-1");
      const p2 = result.current.applyPlan("task-2");
      await Promise.all([p1, p2]);
    });

    // First controller should be aborted
    expect(abortSpy).toHaveBeenCalledWith(1);

    vi.stubGlobal("AbortController", originalAbortController);
  });

  it("should maintain stable applyPlan function reference", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(sampleBatchApplyPlanResponse)));

    const { result, rerender } = renderHook(() => useBatchApplyPlan());

    const firstApplyPlan = result.current.applyPlan;
    rerender();
    expect(result.current.applyPlan).toBe(firstApplyPlan);
  });

  it("should handle HTTP error without error field in body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response("Server Error", { status: 502, headers: { "Content-Type": "text/plain" } }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useBatchApplyPlan());

    let data: unknown;
    await act(async () => {
      data = await result.current.applyPlan("task-123");
    });

    expect(data).toBeUndefined();
    expect(result.current.error).toBe("Request failed (502)");
    expect(result.current.isLoading).toBe(false);
  });
});

// ---------- useSmartTimeslot ----------

describe("useSmartTimeslot", () => {
  const validInput: SmartTimeslotTaskInput = {
    workspaceId: "ws-1",
    taskId: "task-1",
    date: "2025-06-01",
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should not fetch when input is null", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useSmartTimeslot(null));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.result).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should fetch immediately when input is provided", () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(sampleTimeslotResult));
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() => useSmartTimeslot(validInput));

    // No debounce — fetch immediately
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/ai/suggest-timeslot",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          workspaceId: validInput.workspaceId,
          taskId: validInput.taskId,
          date: validInput.date,
        }),
      }),
    );
  });

  it("should return TimeslotSuggestionResult on success", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(sampleTimeslotResult));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useSmartTimeslot(validInput));

    await act(async () => {
      // flush
    });

    expect(result.current.result).toEqual(sampleTimeslotResult);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should set isLoading=true while fetching", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

    const { result } = renderHook(() => useSmartTimeslot(validInput));

    expect(result.current.isLoading).toBe(true);
  });

  it("should handle error state", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ error: "Timeslot service unavailable" }, 503));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useSmartTimeslot(validInput));

    await act(async () => {
      // flush
    });

    expect(result.current.error).toBe("Timeslot service unavailable");
    expect(result.current.result).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("should handle network errors", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useSmartTimeslot(validInput));

    await act(async () => {
      // flush
    });

    expect(result.current.error).toBe("fetch failed");
    expect(result.current.result).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("should abort previous request when input changes", () => {
    const abortSpy = vi.fn();
    const originalAbortController = globalThis.AbortController;

    vi.stubGlobal(
      "AbortController",
      class {
        signal = { aborted: false };
        abort() {
          this.signal.aborted = true;
          abortSpy();
        }
      },
    );

    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(sampleTimeslotResult));
    vi.stubGlobal("fetch", fetchSpy);

    const { rerender } = renderHook(
      ({ input }: { input: SmartTimeslotTaskInput }) =>
        useSmartTimeslot(input),
      { initialProps: { input: validInput } },
    );

    rerender({ input: { ...validInput, taskId: "task-2" } });

    expect(abortSpy).toHaveBeenCalled();

    vi.stubGlobal("AbortController", originalAbortController);
  });

  it("should reset state when input becomes null", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(sampleTimeslotResult));
    vi.stubGlobal("fetch", fetchSpy);

    const { result, rerender } = renderHook(
      ({ input }: { input: SmartTimeslotTaskInput | null }) =>
        useSmartTimeslot(input),
      { initialProps: { input: validInput as SmartTimeslotTaskInput | null } },
    );

    await act(async () => {
      // flush
    });

    expect(result.current.result).toEqual(sampleTimeslotResult);

    rerender({ input: null });

    expect(result.current.result).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should work without optional date field", () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(sampleTimeslotResult));
    vi.stubGlobal("fetch", fetchSpy);

    const inputWithoutDate: SmartTimeslotTaskInput = {
      workspaceId: "ws-1",
      taskId: "task-1",
    };

    renderHook(() => useSmartTimeslot(inputWithoutDate));

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/ai/suggest-timeslot",
      expect.objectContaining({
        body: JSON.stringify({
          workspaceId: "ws-1",
          taskId: "task-1",
          date: undefined,
        }),
      }),
    );
  });

  it("should handle generic error message on non-JSON error response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response("Internal Server Error", { status: 500, headers: { "Content-Type": "text/plain" } }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useSmartTimeslot(validInput));

    await act(async () => {
      // flush
    });

    expect(result.current.error).toBe("Request failed (500)");
    expect(result.current.result).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});
