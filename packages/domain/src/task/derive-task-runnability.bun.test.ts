import { describe, expect, it } from "bun:test";
import { deriveTaskRunnability } from "./derive-task-runnability";

describe("deriveTaskRunnability", () => {
  it("does not depend on a legacy task adapter", () => {
    expect(deriveTaskRunnability()).toEqual({
      isRunnable: true,
      state: "ready_to_run",
      summary: "Ready to run",
      missingFields: [],
    });
  });
});
