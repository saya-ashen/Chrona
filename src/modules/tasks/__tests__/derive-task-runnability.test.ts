import { deriveTaskRunnability } from "@/modules/tasks/derive-task-runnability";
import { describe, expect, it } from "vitest";

describe("deriveTaskRunnability", () => {
  it("returns not runnable when the model is missing", () => {
    expect(
      deriveTaskRunnability({
        runtimeModel: null,
        prompt: "Implement the schedule query",
      }),
    ).toMatchObject({
      isRunnable: false,
      state: "missing_model",
      summary: "Needs model",
      missingFields: ["model"],
    });
  });

  it("returns not runnable when the prompt is missing", () => {
    expect(
      deriveTaskRunnability({
        runtimeModel: "gpt-5.4",
        prompt: "   ",
      }),
    ).toMatchObject({
      isRunnable: false,
      state: "missing_prompt",
      summary: "Needs prompt",
      missingFields: ["prompt"],
    });
  });

  it("returns runnable when both model and prompt are present", () => {
    expect(
      deriveTaskRunnability({
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

  it("does not require advanced runtime config to mark a task runnable", () => {
    expect(
      deriveTaskRunnability({
        runtimeModel: "gpt-5.4",
        prompt: "Implement the schedule query",
        runtimeConfig: undefined,
      }),
    ).toMatchObject({
      isRunnable: true,
      state: "ready_to_run",
    });
  });

  it("reads required fields from normalized runtime input", () => {
    expect(
      deriveTaskRunnability({
        runtimeAdapterKey: "openclaw",
        runtimeInput: {
          model: "gpt-5.4",
          prompt: "Implement the schedule query",
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
});
