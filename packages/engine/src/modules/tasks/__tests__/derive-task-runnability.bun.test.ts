import { describe, expect, it } from "bun:test";
import { deriveTaskRunnability } from "@chrona/shared";

describe("deriveTaskRunnability", () => {
  it("returns runnable for openclaw adapter with model and prompt", () => {
    expect(
      deriveTaskRunnability({
        executionRuntime: "openclaw",
        executionConfig: { prompt: "Implement the schedule query" },
      }),
    ).toMatchObject({
      isRunnable: true,
      state: "ready_to_run",
      summary: "Ready to run",
      missingFields: [],
    });
  });

  it("returns runnable for openclaw adapter without model", () => {
    expect(
      deriveTaskRunnability({
        executionRuntime: "openclaw",
        executionConfig: { prompt: "Implement the schedule query" },
      }),
    ).toMatchObject({
      isRunnable: true,
      state: "ready_to_run",
      missingFields: [],
    });
  });

  it("returns runnable for openclaw adapter with empty prompt", () => {
    expect(
      deriveTaskRunnability({
        executionRuntime: "openclaw",
        executionConfig: {},
      }),
    ).toMatchObject({
      isRunnable: true,
      state: "ready_to_run",
      missingFields: [],
    });
  });

  it("returns runnable for openclaw adapter with runtimeInput (no model needed)", () => {
    expect(
      deriveTaskRunnability({
        executionRuntime: "openclaw",
        executionConfig: {
          prompt: "Hello",
          approvalPolicy: "never",
        },
      }),
    ).toMatchObject({
      isRunnable: true,
      state: "ready_to_run",
      missingFields: [],
    });
  });

  it("returns runnable for openclaw adapter with no prompt", () => {
    expect(
      deriveTaskRunnability({
        executionRuntime: "openclaw",
        executionConfig: {},
      }),
    ).toMatchObject({
      isRunnable: true,
      state: "ready_to_run",
      missingFields: [],
    });
  });

  it("research adapter still requires prompt", () => {
    expect(
      deriveTaskRunnability({
        executionRuntime: "research",
        executionConfig: {},
      }),
    ).toMatchObject({
      isRunnable: false,
      state: "missing_prompt",
      missingFields: ["prompt"],
    });
  });

  it("research adapter is runnable with prompt", () => {
    expect(
      deriveTaskRunnability({
        executionRuntime: "research",
        executionConfig: { prompt: "Do a deep research" },
      }),
    ).toMatchObject({
      isRunnable: true,
      state: "ready_to_run",
      missingFields: [],
    });
  });

  it("default adapter (openclaw) with no explicit adapter key", () => {
    expect(
      deriveTaskRunnability({}),
    ).toMatchObject({
      isRunnable: true,
      state: "ready_to_run",
      missingFields: [],
    });
  });

  it("does not require advanced runtime config to mark a task runnable", () => {
    expect(
      deriveTaskRunnability({
        executionRuntime: "openclaw",
        executionConfig: {
          prompt: "Test",
        },
      }),
    ).toMatchObject({
      isRunnable: true,
      state: "ready_to_run",
    });
  });
});
