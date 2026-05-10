import { describe, expect, it } from "bun:test";
import { deriveTaskStaticState } from "./derive-task-static-state";

describe("deriveTaskStaticState", () => {
  it("returns ready when the runtime spec has no required paths", () => {
    expect(
      deriveTaskStaticState({
        runtimeSpec: {
          runtime: "openclaw",
          version: "v1",
          fields: [],
          runnability: { requiredPaths: [] },
        },
        hasAcceptedPlan: true,
        executionConfig: {},
      }),
    ).toEqual({
      persistedStatus: "Ready",
      runnabilityState: "ready_to_run",
      runnabilitySummary: "Ready to run",
      missingPaths: [],
    });
  });

  it("returns draft when a required runtime path is missing", () => {
    expect(
      deriveTaskStaticState({
        runtimeSpec: {
          runtime: "research",
          version: "v1",
          fields: [],
          runnability: { requiredPaths: ["prompt"] },
        },
        hasAcceptedPlan: false,
        executionConfig: {},
      }),
    ).toEqual({
      persistedStatus: "Draft",
      runnabilityState: "missing_required_config",
      runnabilitySummary: "Missing required config: prompt",
      missingPaths: ["prompt"],
    });
  });

  it("treats blank strings as missing required config", () => {
    expect(
      deriveTaskStaticState({
        runtimeSpec: {
          runtime: "research",
          version: "v1",
          fields: [],
          runnability: { requiredPaths: ["prompt"] },
        },
        hasAcceptedPlan: false,
        executionConfig: { prompt: "   " },
      }),
    ).toMatchObject({
      persistedStatus: "Draft",
      missingPaths: ["prompt"],
    });
  });

  it("supports nested required paths", () => {
    expect(
      deriveTaskStaticState({
        runtimeSpec: {
          runtime: "custom",
          version: "v1",
          fields: [],
          runnability: { requiredPaths: ["input.prompt"] },
        },
        hasAcceptedPlan: true,
        executionConfig: { input: { prompt: "Ship it" } },
      }),
    ).toMatchObject({
      persistedStatus: "Ready",
      missingPaths: [],
    });
  });

  it("returns draft when config is runnable but no accepted plan exists", () => {
    expect(
      deriveTaskStaticState({
        runtimeSpec: {
          runtime: "openclaw",
          version: "v1",
          fields: [],
          runnability: { requiredPaths: [] },
        },
        hasAcceptedPlan: false,
        executionConfig: {},
      }),
    ).toEqual({
      persistedStatus: "Draft",
      runnabilityState: "missing_accepted_plan",
      runnabilitySummary: "Generate and accept a plan",
      missingPaths: [],
    });
  });
});
