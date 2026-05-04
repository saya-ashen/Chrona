import { describe, expect, it } from "bun:test";
import { deriveTaskRunnability } from "@chrona/shared";

describe("deriveTaskRunnability", () => {
  it("returns runnable for openclaw adapter with model and prompt", () => {
    expect(
      deriveTaskRunnability({
        runtimeAdapterKey: "openclaw",
        runtimeModel: "gpt-5.4",
        prompt: "Implement the schedule query",
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
        runtimeAdapterKey: "openclaw",
        runtimeModel: null,
        prompt: "Implement the schedule query",
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
        runtimeAdapterKey: "openclaw",
        runtimeModel: null,
        prompt: null,
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
        runtimeAdapterKey: "openclaw",
        runtimeInput: {
          prompt: "Hello",
          approvalPolicy: "never",
        },
        runtimeModel: null,
        prompt: null,
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
        runtimeAdapterKey: "openclaw",
        runtimeInput: {},
        runtimeModel: null,
        prompt: null,
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
        runtimeAdapterKey: "research",
        runtimeInput: {},
        runtimeModel: null,
        prompt: null,
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
        runtimeAdapterKey: "research",
        runtimeInput: { prompt: "Do a deep research" },
        runtimeModel: null,
        prompt: null,
      }),
    ).toMatchObject({
      isRunnable: true,
      state: "ready_to_run",
      missingFields: [],
    });
  });

  it("default adapter (openclaw) with no explicit adapter key", () => {
    expect(
      deriveTaskRunnability({
        runtimeModel: null,
        prompt: null,
      }),
    ).toMatchObject({
      isRunnable: true,
      state: "ready_to_run",
      missingFields: [],
    });
  });

  it("does not require advanced runtime config to mark a task runnable", () => {
    expect(
      deriveTaskRunnability({
        runtimeAdapterKey: "openclaw",
        runtimeInput: {
          prompt: "Test",
        },
        runtimeModel: null,
        prompt: null,
        runtimeConfig: undefined,
      }),
    ).toMatchObject({
      isRunnable: true,
      state: "ready_to_run",
    });
  });
});
