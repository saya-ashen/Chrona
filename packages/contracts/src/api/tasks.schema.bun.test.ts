import { describe, expect, it } from "bun:test";
import {
  createTaskBodySchema,
  createTaskBodySchemaForSupportedRuntimes,
  listTasksQuerySchema,
  updateTaskBodySchema,
  updateTaskBodySchemaForSupportedRuntimes,
} from "./tasks.schema";

describe("task API schemas", () => {
  it("validates executionRuntime against a supplied supported runtime list", () => {
    const schema = createTaskBodySchemaForSupportedRuntimes(["hermes", "local"]);

    expect(
      schema.parse({
        workspaceId: "workspace-1",
        title: "Use configured runtime",
        executionRuntime: "local",
      }),
    ).toMatchObject({ executionRuntime: "local" });

    expect(() =>
      schema.parse({
        workspaceId: "workspace-1",
        title: "Use unknown runtime",
        executionRuntime: "research",
      }),
    ).toThrow("Unsupported executionRuntime. Supported runtimes: hermes, local");
  });

  it("keeps the reusable contract schema provider-agnostic", () => {
    expect(
      createTaskBodySchema.parse({
        workspaceId: "workspace-1",
        title: "Create through MCP contract",
        executionRuntime: "future-runtime",
      }),
    ).toMatchObject({ executionRuntime: "future-runtime" });

    expect(() =>
      createTaskBodySchema.parse({
        workspaceId: "workspace-1",
        title: "Blank runtime",
        executionRuntime: "  ",
      }),
    ).toThrow("executionRuntime is required");
  });

  it("validates update executionRuntime against the supplied runtime list", () => {
    const schema = updateTaskBodySchemaForSupportedRuntimes(["hermes"]);

    expect(schema.parse({ executionRuntime: "hermes" })).toMatchObject({
      executionRuntime: "hermes",
    });
    expect(() => schema.parse({ executionRuntime: "local" })).toThrow(
      "Unsupported executionRuntime. Supported runtimes: hermes",
    );
  });

  it("keeps task creation and update state fields internally consistent", () => {
    const created = createTaskBodySchema.parse({
      workspaceId: "workspace-1",
      title: "Validate task flow contract",
      description: "Create, plan, execute, and observe terminal task state.",
      priority: "High",
      executionRuntime: "hermes",
      executionConfig: { mode: "test" },
      parentTaskId: null,
    });

    expect(created).toEqual({
      workspaceId: "workspace-1",
      title: "Validate task flow contract",
      description: "Create, plan, execute, and observe terminal task state.",
      priority: "High",
      executionRuntime: "hermes",
      executionConfig: { mode: "test" },
      parentTaskId: null,
    });

    for (const status of ["Ready", "Running", "Blocked", "Completed", "Cancelled"] as const) {
      expect(updateTaskBodySchema.parse({ status })).toMatchObject({ status });
    }
  });

  it("validates task list filters and clamps pagination deterministically", () => {
    expect(listTasksQuerySchema.parse({ workspaceId: "workspace-1" })).toEqual({
      workspaceId: "workspace-1",
      limit: 50,
    });
    expect(listTasksQuerySchema.parse({ workspaceId: "workspace-1", status: "Blocked", limit: "500" })).toEqual({
      workspaceId: "workspace-1",
      status: "Blocked",
      limit: 200,
    });
    expect(listTasksQuerySchema.parse({ workspaceId: "workspace-1", limit: "0" })).toEqual({
      workspaceId: "workspace-1",
      limit: 1,
    });
    expect(() => listTasksQuerySchema.parse({ workspaceId: "workspace-1", status: "Unknown" })).toThrow();
  });
});
