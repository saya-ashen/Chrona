import { describe, expect, it } from "bun:test";
import { deriveTaskRunnability } from "@chrona/shared";

describe("deriveTaskRunnability", () => {
  it("returns runnable for hermes adapter with model and prompt", () => {
    expect(
      deriveTaskRunnability({
        executionRuntime: "hermes",
        executionConfig: { prompt: "Implement the schedule query" },
      }),
    ).toMatchObject({
      isRunnable: true,
      state: "ready_to_run",
      summary: "Ready to run",
      missingFields: [],
    });
  });

  it("returns runnable for hermes adapter without model", () => {
    expect(
      deriveTaskRunnability({
        executionRuntime: "hermes",
        executionConfig: { prompt: "Implement the schedule query" },
      }),
    ).toMatchObject({
      isRunnable: true,
      state: "ready_to_run",
      missingFields: [],
    });
  });

  it("returns runnable for hermes adapter with empty prompt", () => {
    expect(
      deriveTaskRunnability({
        executionRuntime: "hermes",
        executionConfig: {},
      }),
    ).toMatchObject({
      isRunnable: true,
      state: "ready_to_run",
      missingFields: [],
    });
  });

  it("returns runnable for hermes adapter with runtimeInput (no model needed)", () => {
    expect(
      deriveTaskRunnability({
        executionRuntime: "hermes",
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

  it("returns runnable for hermes adapter with no prompt", () => {
    expect(
      deriveTaskRunnability({
        executionRuntime: "hermes",
        executionConfig: {},
      }),
    ).toMatchObject({
      isRunnable: true,
      state: "ready_to_run",
      missingFields: [],
    });
  });

  it("returns runnable for custom adapter with no prompt", () => {
    expect(
      deriveTaskRunnability({
        executionRuntime: "custom-runtime",
        executionConfig: {},
      }),
    ).toMatchObject({
      isRunnable: true,
      state: "ready_to_run",
      missingFields: [],
    });
  });

  it("default adapter (hermes) with no explicit adapter key", () => {
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
        executionRuntime: "hermes",
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
