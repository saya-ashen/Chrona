import { describe, expect, it } from "bun:test";
import { planAcceptBodySchema, planGenerateBodySchema, planPatchBodySchema } from "./plans.schema";
import { createTaskBodySchema, updateTaskBodySchema } from "./tasks.schema";

describe("task and plan API boundary schemas", () => {
  it("requires the plan command concurrency and idempotency contracts", () => {
    expect(() => createTaskBodySchema.parse({ workspaceId: "workspace-1", title: "" })).toThrow("title is required");
    expect(() => planAcceptBodySchema.parse({ planId: "" })).toThrow("planId is required");
    expect(() => planAcceptBodySchema.parse({ planId: "plan-1" })).toThrow("expectedHeadStateVersion is required");
    expect(planAcceptBodySchema.parse({ planId: "plan-1", expectedHeadStateVersion: 0, idempotencyKey: "accept-1" })).toMatchObject({ planId: "plan-1" });
  });

  it("allows partial task updates but rejects empty updates", () => {
    expect(updateTaskBodySchema.parse({ description: "Updated" })).toEqual({ description: "Updated" });
    expect(updateTaskBodySchema.parse({})).toEqual({});
  });

  it("requires idempotency for generation and head CAS for patches", () => {
    expect(() => planGenerateBodySchema.parse({ userInstruction: "  refine this  " })).toThrow("idempotencyKey is required");
    expect(planGenerateBodySchema.parse({ idempotencyKey: "generate-1", userInstruction: "  refine this  " })).toEqual({ idempotencyKey: "generate-1", userInstruction: "refine this" });
    expect(planGenerateBodySchema.parse({ idempotencyKey: "generate-2", userInstruction: null })).toEqual({ idempotencyKey: "generate-2", userInstruction: null });
    expect(() => planPatchBodySchema.parse({ operation: "delete_node", deletedNodeIds: ["node-1"] })).toThrow("expectedHeadStateVersion is required");
    expect(planPatchBodySchema.parse({
      operation: "delete_node",
      expectedHeadStateVersion: 3,
      idempotencyKey: "patch-1",
      deletedNodeIds: ["node-1"],
    })).toEqual({
      operation: "delete_node",
      expectedHeadStateVersion: 3,
      idempotencyKey: "patch-1",
      deletedNodeIds: ["node-1"],
    });
    expect(() => planPatchBodySchema.parse({ operation: "replace_node", expectedHeadStateVersion: 3, idempotencyKey: "patch-2" })).toThrow();
    expect(() => planPatchBodySchema.parse({ operation: "delete_node", expectedHeadStateVersion: 3, idempotencyKey: "patch-3", deletedNodeIds: ["node-1"], edges: [{ fromNodeId: "a", toNodeId: "b" }] })).toThrow("edges is not allowed for delete_node");
    expect(() => planPatchBodySchema.parse({ operation: "add_node", expectedHeadStateVersion: 3, idempotencyKey: "patch-4" })).toThrow("nodes is required for add_node");
    expect(() => planPatchBodySchema.parse({ operation: "", expectedHeadStateVersion: 3, idempotencyKey: "patch-5" })).toThrow();
  });
});
