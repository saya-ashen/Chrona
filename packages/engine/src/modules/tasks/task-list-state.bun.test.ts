import { describe, expect, test } from "bun:test";
import { db } from "@chrona/db";
import { listTasksByWorkspace } from "./list-tasks";
import { getDashboard } from "../pages/get-dashboard";

describe("task list and dashboard state semantics", () => {
  test("Draft is not ready; results awaiting acceptance need attention; blocked failures are discoverable", async () => {
    const workspace = await db.workspace.create({ data: { name: "State regression", status: "Active" } });
    for (const status of ["Draft", "Ready", "Queued", "Completed", "Done", "Blocked", "Failed", "WaitingForInput", "WaitingForApproval"] as const) {
      const task = await db.task.create({ data: { workspaceId: workspace.id, title: status, status, priority: "Medium", executionConfig: {} } });
      await db.taskProjection.create({ data: { taskId: task.id, workspaceId: workspace.id, persistedStatus: status,
        ...(status === "Blocked" ? { blockType: "node_failed", latestRunStatus: "Failed" } : {}),
      } });
    }
    const input = { workspaceId: workspace.id };
    const ready = await listTasksByWorkspace({ ...input, filter: "ready" });
    expect(ready.tasks.map(task => task.title)).toEqual(["Ready"]);
    expect(ready.tasks[0]?.stateView.state).toBe("ready_to_run");
    expect(ready.counts.ready).toBe(ready.total);
    const attention = await listTasksByWorkspace({ ...input, filter: "needs_me" });
    expect(attention.tasks.map(task => task.title).sort()).toEqual(["Blocked", "Completed", "Failed", "WaitingForApproval", "WaitingForInput"]);
    expect(attention.counts.needsMe).toBe(attention.total);
    expect(attention.tasks.find(task => task.title === "Blocked")?.stateView.state).toBe("failed");
    const failures = await listTasksByWorkspace({ ...input, filter: "failed" });
    expect(failures.tasks.map(task => task.title).sort()).toEqual(["Blocked", "Failed"]);
    const dashboard = await getDashboard(workspace.id);
    expect(dashboard.needsAttention.find(task => task.title === "Completed")?.kind).toBe("result_review");
    expect(dashboard.needsAttention.some(task => task.title === "Done")).toBe(false);
  });
});
