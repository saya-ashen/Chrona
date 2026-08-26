import { describe, expect, it } from "bun:test";
import {
  createTaskBodySchema,
  listTasksQuerySchema,
  updateTaskBodySchema,
  workspaceActivityItemSchema,
  workspaceActivityPageQuerySchema,
  workspaceActivityPageSchema,
} from "./tasks.schema";

describe("task API schemas", () => {
  it("rejects the removed task adapter parameter", () => {
    expect(createTaskBodySchema.parse({
      workspaceId: "workspace-1",
      title: "Use the selected AI provider"
    })).not.toHaveProperty("executionRuntime");
    expect(updateTaskBodySchema.parse({ }))
      .not.toHaveProperty("executionRuntime");
  });

  it("keeps task creation and update state fields internally consistent", () => {
    const created = createTaskBodySchema.parse({
      workspaceId: "workspace-1",
      title: "Validate task flow contract",
      description: "Create, plan, execute, and observe terminal task state.",
      priority: "High",
      executionConfig: { mode: "test" },
      parentTaskId: null,
    });

    expect(created).toEqual({
      workspaceId: "workspace-1",
      title: "Validate task flow contract",
      description: "Create, plan, execute, and observe terminal task state.",
      priority: "High",
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
    const activity = workspaceActivityItemSchema.parse({
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
      executionSessionId: "execution-session-2",
      executionEpoch: 2,
      executionTrigger: "restart",
      tool: {
        name: "chrona_plan_read",
        durationMs: 24,
        state: "completed",
      },
    });
    expect(activity).toMatchObject({
      kind: "tool_completed",
      tone: "success",
      executionTrigger: "restart",
      tool: { state: "completed" },
    });
    expect(activity).not.toHaveProperty("executionSessionId");
    expect(activity).not.toHaveProperty("executionEpoch");

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
        id: "task-1",
        kind: "task",
        title: "Task updated",
        summary: "Task fields changed.",
        description: "Task fields changed.",
        tone: "info",
      }],
      nextCursor: "cursor-2",
      scope: { type: "task", taskId: "task-1", limit: 100 },
    })).toMatchObject({ nextCursor: "cursor-2", scope: { type: "task" } });
  });
  it("validates task model and context strategy overrides", () => {
    expect(updateTaskBodySchema.parse({
      executionConfig: {
        model: "openai-codex/gpt-5.6",
        contextStrategy: "artifact_backed",
        allowSubAgents: false,
      },
    })).toMatchObject({
      executionConfig: { contextStrategy: "artifact_backed" },
    });

    expect(() => updateTaskBodySchema.parse({
      executionConfig: { contextStrategy: "unbounded" },
    })).toThrow();
    expect(() => updateTaskBodySchema.parse({
      executionConfig: { model: "" },
    })).toThrow();
  });
});
