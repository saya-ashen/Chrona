import { describe, expect, it } from "bun:test";
import { planAcceptBodySchema, planGenerateBodySchema, planPatchBodySchema } from "./plans.schema";
import { createTaskBodySchema, updateTaskBodySchema } from "./tasks.schema";

describe("task and plan API boundary schemas", () => {
  it("rejects blank task and plan identifiers", () => {
    expect(() => createTaskBodySchema.parse({ workspaceId: "workspace-1", title: "" })).toThrow("title is required");
    expect(() => planAcceptBodySchema.parse({ planId: "" })).toThrow("planId is required");
  });

  it("allows partial task updates but rejects empty updates", () => {
    expect(updateTaskBodySchema.parse({ description: "Updated" })).toEqual({ description: "Updated" });
    expect(updateTaskBodySchema.parse({})).toEqual({});
  });

  it("normalizes nullable plan generation instructions", () => {
    expect(planGenerateBodySchema.parse({ userInstruction: "  refine this  " })).toEqual({ userInstruction: "refine this" });
    expect(planGenerateBodySchema.parse({ userInstruction: null })).toEqual({ userInstruction: null });
  });

  it("keeps patch operations open while requiring an operation name", () => {
    expect(planPatchBodySchema.parse({ operation: "replace_node", extra: { reason: "test" } })).toMatchObject({
      operation: "replace_node",
      extra: { reason: "test" },
    });
    expect(() => planPatchBodySchema.parse({ operation: "" })).toThrow("operation is required");
  });
});
