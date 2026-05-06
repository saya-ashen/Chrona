import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoComplete } from "../use-ai";
import type { AutoCompleteSuggestion } from "../use-ai";

// ---------- Helpers ----------

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ suggestions: [] })),
    );

    const { result } = renderHook(() => useAutoComplete("Write tests"));

    // isLoading should be true even before debounce fires
    expect(result.current.isLoading).toBe(true);
  });

  it("should debounce and fetch after delay when title >= 3 chars", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ suggestions: sampleSuggestions }));
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
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        }),
        body: JSON.stringify({ title: "Write tests" }),
      }),
    );
  });

  it("should return suggestions on successful response", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ suggestions: sampleSuggestions }));
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
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: "AI service unavailable" }, 503),
      );
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
      new Response("not json", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      }),
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
    const fetchSpy = vi.fn().mockImplementation(() => {});
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
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ suggestions: sampleSuggestions }));
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
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ suggestions: sampleSuggestions }));
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

  it("should replace provisional rule suggestions with final streamed AI suggestions", async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'event: suggestions\ndata: {"suggestions":[{"id":"rule-1","summary":"rule summary","action":{"type":"create_task","title":"Rule suggestion","description":"rule","priority":"Medium","estimatedMinutes":30,"tags":[]}}],"source":"rules","requestId":"req-1","isFinal":false}\n\n' +
                    'event: suggestions\ndata: {"suggestions":[{"id":"ai-1","summary":"AI summary","action":{"type":"create_task","title":"AI suggestion","description":"streamed structured result","priority":"High","estimatedMinutes":45,"tags":["testing"]}}],"source":"ai","requestId":"req-1","isFinal":true}\n\n' +
                    'event: done\ndata: {"requestId":"req-1"}\n\n',
                ),
              );
              controller.close();
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
      ),
    );

    const { result } = renderHook(() => useAutoComplete("Write tests", 100));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.suggestions).toEqual([
      {
        title: "AI suggestion",
        description: "streamed structured result",
        priority: "High",
        estimatedMinutes: 45,
        tags: ["testing"],
      },
    ]);
    expect(result.current.phase).toBe("done");
    expect(result.current.isLoading).toBe(false);
  });

  it("should not get stuck in connecting when a newer request replaces an older one", async () => {
    const fetchSpy = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>(() => {
            // keep first request pending forever to simulate a stale in-flight request
          }),
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(
                encoder.encode(
                  'event: suggestions\ndata: {"suggestions":[{"id":"final-1","summary":"AI summary","action":{"type":"create_task","title":"参加美国总统竞选","description":"final","priority":"High","estimatedMinutes":60,"tags":[]}}],"source":"ai","requestId":"req-2","isFinal":true}\n\n' +
                    'event: done\ndata: {"requestId":"req-2"}\n\n',
                ),
              );
              controller.close();
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const { result, rerender } = renderHook(
      ({ title }: { title: string | null }) => useAutoComplete(title, 100),
      { initialProps: { title: "参加美国" } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.phase).toBe("connecting");
    expect(result.current.isLoading).toBe(true);

    rerender({ title: "参加美国总统竞选" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe("done");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.suggestions).toEqual([
      {
        title: "参加美国总统竞选",
        description: "final",
        priority: "High",
        estimatedMinutes: 60,
        tags: [],
      },
    ]);
  });

  it("should use default 500ms debounce when not specified", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ suggestions: [] }));
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
