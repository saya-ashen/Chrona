import { describe, expect, it } from "bun:test";
import {
  buildDefaultTaskSessionKey,
  buildLegacyPlanExecutionTaskSessionKey,
  buildPlanExecutionTaskSessionKey,
  buildPlanGenerationTaskSessionKey,
  buildWorkBlockPlanTaskSessionKey,
  buildWorkBlockTaskSessionKey,
  getRuntimeAdapterDefinition,
  getRuntimeTaskConfigSpec,
  isKnownExecutionRuntime,
  listExecutionRuntimes,
  resolveExecutionRuntime,
  validateRuntimeTaskConfig,
  validateTaskRuntimeConfig,
} from "@chrona/engine/modules/execution-runtime";

// execution-runtime — engine-layer unit for the runtime registry
// + session key builders. The DB-touching ensure* functions are
// covered by plan-runner integration tests; this file pins the
// pure-function contract on the registry resolution path and the
// session key naming convention.
//
//   - getRuntimeAdapterDefinition throws on empty/unknown keys
//   - isKnownExecutionRuntime is trim-aware
//   - resolveExecutionRuntime picks explicit > workspace default
//     > hermes fallback
//   - validateRuntimeTaskConfig + validateTaskRuntimeConfig return
//     validated RuntimeInput with the resolved runtime name
//   - listExecutionRuntimes surfaces the hermes + debug runtimes
//   - build*TaskSessionKey builders produce the documented key
//     strings (stable contract; downstream services parse them)

describe("execution-runtime registry", () => {
  it("getRuntimeAdapterDefinition throws on an empty key", () => {
    expect(() => getRuntimeAdapterDefinition("")).toThrow(/runtime key is required/);
    expect(() => getRuntimeAdapterDefinition("   ")).toThrow(/runtime key is required/);
  });

  it("getRuntimeAdapterDefinition throws on an unknown runtime", () => {
    expect(() => getRuntimeAdapterDefinition("not-a-runtime")).toThrow(/Unknown runtime/);
  });

  it("getRuntimeAdapterDefinition returns the hermes definition and its spec", () => {
    const def = getRuntimeAdapterDefinition("hermes");
    expect(def.key).toBe("hermes");
    expect(typeof def.validateTaskConfig).toBe("function");
    const spec = getRuntimeTaskConfigSpec("hermes");
    expect(spec.runtime).toBe("hermes");
    expect(typeof spec.version).toBe("string");
  });

  it("isKnownExecutionRuntime is trim-aware and null-safe", () => {
    expect(isKnownExecutionRuntime("hermes")).toBe(true);
    expect(isKnownExecutionRuntime("  hermes  ")).toBe(true);
    expect(isKnownExecutionRuntime("debug")).toBe(true);
    expect(isKnownExecutionRuntime("not-a-runtime")).toBe(false);
    expect(isKnownExecutionRuntime(null)).toBe(false);
    expect(isKnownExecutionRuntime(undefined)).toBe(false);
    expect(isKnownExecutionRuntime("")).toBe(false);
    expect(isKnownExecutionRuntime("   ")).toBe(false);
  });

  it("resolveExecutionRuntime prefers the explicit runtime over the workspace default", () => {
    expect(
      resolveExecutionRuntime({
        executionRuntime: "debug",
        workspaceDefaultRuntime: "hermes",
      }),
    ).toBe("debug");
  });

  it("resolveExecutionRuntime falls back to the workspace default when no explicit runtime", () => {
    expect(
      resolveExecutionRuntime({
        executionRuntime: null,
        workspaceDefaultRuntime: "hermes",
      }),
    ).toBe("hermes");
  });

  it("resolveExecutionRuntime falls back to hermes when the workspace default is unknown", () => {
    expect(
      resolveExecutionRuntime({
        executionRuntime: undefined,
        workspaceDefaultRuntime: "not-a-runtime",
      }),
    ).toBe("hermes");
  });

  it("resolveExecutionRuntime falls back to hermes when nothing is configured", () => {
    expect(resolveExecutionRuntime({})).toBe("hermes");
    expect(resolveExecutionRuntime({ executionRuntime: "  " })).toBe("hermes");
  });

  it("listExecutionRuntimes surfaces agent runtimes", () => {
    const runtimes = listExecutionRuntimes();
    expect(runtimes).toContain("hermes");
    expect(runtimes).toContain("claude_code");
    expect(runtimes).toContain("codex");
    expect(runtimes).toContain("debug");
  });

  it("validateRuntimeTaskConfig round-trips a valid RuntimeInput for hermes", () => {
    const validated = validateRuntimeTaskConfig("hermes", { fieldExecutionConfig: {} });
    expect(typeof validated).toBe("object");
  });

  it("validateTaskRuntimeConfig resolves the runtime and validates the execution config together", () => {
    const result = validateTaskRuntimeConfig({
      executionRuntime: undefined,
      workspaceDefaultRuntime: "hermes",
      executionConfig: { fieldExecutionConfig: {} },
    });
    expect(result.executionRuntime).toBe("hermes");
    expect(typeof result.executionConfig).toBe("object");
  });

  it("validateTaskRuntimeConfig falls back to hermes and accepts a non-object config", () => {
    const result = validateTaskRuntimeConfig({
      executionRuntime: null,
      workspaceDefaultRuntime: null,
      // Non-object inputs are normalized to {} before validation
      executionConfig: "not-an-object",
    });
    expect(result.executionRuntime).toBe("hermes");
    expect(typeof result.executionConfig).toBe("object");
  });
});

describe("execution-runtime session key builders", () => {
  it("buildDefaultTaskSessionKey produces chrona:task:<id>:<suffix>", () => {
    expect(buildDefaultTaskSessionKey({ taskId: "t-1", suffix: "exec" })).toBe(
      "chrona:task:t-1:exec",
    );
  });

  it("buildWorkBlockTaskSessionKey includes the workBlockId segment", () => {
    expect(
      buildWorkBlockTaskSessionKey({ taskId: "t-1", workBlockId: "wb-1" }),
    ).toBe("chrona:task:t-1:work-block:wb-1");
  });

  it("buildWorkBlockPlanTaskSessionKey appends the plan-generation segment", () => {
    expect(
      buildWorkBlockPlanTaskSessionKey({ taskId: "t-1", workBlockId: "wb-1" }),
    ).toBe("chrona:task:t-1:work-block:wb-1:plan-generation");
  });

  it("buildPlanGenerationTaskSessionKey is task-scoped", () => {
    expect(buildPlanGenerationTaskSessionKey({ taskId: "t-1" })).toBe(
      "chrona:task:t-1:plan-generation",
    );
  });

  it("buildPlanExecutionTaskSessionKey appends the planId segment", () => {
    expect(
      buildPlanExecutionTaskSessionKey({ taskId: "t-1", planId: "p-1" }),
    ).toBe("chrona:task:t-1:execute:p-1");
  });

  it("buildLegacyPlanExecutionTaskSessionKey still resolves to chrona:task:<id>:plan-<planId>", () => {
    // Legacy keys must remain parseable for back-compat session lookup
    expect(
      buildLegacyPlanExecutionTaskSessionKey({ taskId: "t-1", planId: "p-1" }),
    ).toBe("chrona:task:t-1:plan-p-1");
  });
});
