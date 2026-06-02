import { describe, expect, it } from "bun:test";
import {
  createTaskBodySchema,
  createTaskBodySchemaForSupportedRuntimes,
  listTasksQuerySchema,
  updateTaskBodySchema,
  updateTaskBodySchemaForSupportedRuntimes,
  workspaceActivityItemSchema,
  workspaceActivityPageQuerySchema,
  workspaceActivityPageSchema,
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
      page: 1,
      pageSize: 20,
    });
    expect(
      listTasksQuerySchema.parse({
        workspaceId: "workspace-1",
        status: "Blocked",
        pageSize: "500",
        page: "3",
      }),
    ).toEqual({
      workspaceId: "workspace-1",
      status: "Blocked",
      page: 3,
      pageSize: 100,
    });
    expect(
      listTasksQuerySchema.parse({ workspaceId: "workspace-1", pageSize: "0", page: "0" }),
    ).toEqual({
      workspaceId: "workspace-1",
      page: 1,
      pageSize: 1,
    });
    expect(
      listTasksQuerySchema.parse({
        workspaceId: "workspace-1",
        filter: "needs_me",
        priority: "High",
        search: "  report  ",
        sort: "dueAt",
        order: "asc",
      }),
    ).toEqual({
      workspaceId: "workspace-1",
      filter: "needs_me",
      priority: "High",
      search: "report",
      sort: "dueAt",
      order: "asc",
      page: 1,
      pageSize: 20,
    });
    expect(() => listTasksQuerySchema.parse({ workspaceId: "workspace-1", status: "Unknown" })).toThrow();
    expect(() => listTasksQuerySchema.parse({ workspaceId: "workspace-1", filter: "nope" })).toThrow();
  });

  it("validates structured workspace activity items", () => {
    expect(workspaceActivityItemSchema.parse({
      id: "event-1",
      kind: "tool_completed",
      title: "Tool completed",
      summary: "chrona_plan_read completed",
      description: "chrona_plan_read completed",
      tone: "success",
      timestamp: "2026-05-12T10:00:00.000Z",
      sourceNodeId: "node-1",
      sourceNodeTitle: "Read plan",
      provider: "hermes",
      runtimeName: "hermes",
      runId: "run-1",
      nativeRunId: "native-1",
      sequence: 7,
      rawEventType: "tool_completed",
      tool: {
        name: "chrona_plan_read",
        label: "Read plan",
        durationMs: 24,
        state: "completed",
      },
    })).toMatchObject({ kind: "tool_completed", tone: "success", tool: { state: "completed" } });

    expect(() => workspaceActivityItemSchema.parse({
      id: "event-2",
      kind: "tool_completed",
      title: "Tool completed",
      summary: "bad tone",
      description: "bad tone",
      tone: "critical",
    })).toThrow();
  });

  it("validates activity page query and response contracts", () => {
    expect(workspaceActivityPageQuerySchema.parse({ limit: "5000" })).toEqual({
      limit: 3000,
    });

    expect(workspaceActivityPageSchema.parse({
      items: [{
        id: "assistant-1",
        kind: "assistant_message",
        title: "Assistant response",
        summary: "Done",
        description: "Done",
        tone: "info",
        assistant: { text: "Done", isReasoning: false },
      }],
      nextCursor: "cursor-2",
      scope: { type: "task", taskId: "task-1", limit: 100 },
    })).toMatchObject({ nextCursor: "cursor-2", scope: { type: "task" } });
  });
});
