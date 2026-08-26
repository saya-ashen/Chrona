import { describe, expect, it } from "bun:test";

import { isEventInWorkBlockScope } from "./work.routes";

describe("work event stream scope", () => {
  it("delivers only events for the selected recurring work block", () => {
    expect(isEventInWorkBlockScope({ workBlockId: "block-a" } as never, "block-a")).toBe(true);
    expect(isEventInWorkBlockScope({ workBlockId: "block-b" } as never, "block-a")).toBe(false);
    expect(isEventInWorkBlockScope({ workBlockId: null } as never, "block-a")).toBe(false);
    expect(isEventInWorkBlockScope({ workBlockId: null } as never, null)).toBe(true);
  });
});
