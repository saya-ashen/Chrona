import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useStewardResource } from "./use-steward";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it("refreshes visible data and pauses when the document is hidden", async () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const load = vi.fn().mockResolvedValue("initial");
  const { result } = renderHook(() => useStewardResource(load, true));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(result.current.data).toBe("initial");
  load.mockResolvedValue("updated");
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(result.current.data).toBe("updated");
  expect(load).toHaveBeenCalledTimes(2);
  hidden.mockReturnValue(true);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(load).toHaveBeenCalledTimes(2);
  hidden.mockReturnValue(false);
  load.mockResolvedValue("on return");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(result.current.data).toBe("on return");
  expect(load).toHaveBeenCalledTimes(3);
});
it("refreshes a changed revision without clearing the readable content", async () => {
  let finish!: (value: string) => void;
  const load = vi.fn().mockResolvedValueOnce("saved").mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
  const { result, rerender } = renderHook(({ revision }) => useStewardResource(load, false, revision), { initialProps: { revision: "r1" } });
  await act(async () => {});
  expect(result.current.data).toBe("saved");
  rerender({ revision: "r2" });
  expect(load).toHaveBeenCalledTimes(2);
  expect(result.current.data).toBe("saved");
  expect(result.current.loading).toBe(true);
  await act(async () => finish("new saved content"));
  expect(result.current.data).toBe("new saved content");
});
