import { describe, expect, it } from "bun:test";
import {
  taskRuntimeToolForLabel,
  workspaceActivityToTaskRuntimeActivity,
} from "../model/task-runtime-activity";
import type { WorkspaceActivityItem } from "../model/task-workspace-types";

function activity(
  overrides: Partial<WorkspaceActivityItem> &
    Pick<WorkspaceActivityItem, "id" | "kind">,
): WorkspaceActivityItem {
  return {
    title: "Tool completed",
    summary: "done",
    description: "done",
    tone: "success",
    ...overrides,
  };
}

describe("task runtime activity", () => {
  it("maps provider aliases to stable Claude Code-style tool names", () => {
    expect(taskRuntimeToolForLabel("exec")).toBe("bash");
    expect(taskRuntimeToolForLabel("read_file")).toBe("read");
    expect(taskRuntimeToolForLabel("Read source")).toBe("read");
    expect(taskRuntimeToolForLabel("apply_patch")).toBe("edit");
    expect(taskRuntimeToolForLabel("rg")).toBe("grep");
    expect(taskRuntimeToolForLabel("find_files")).toBe("glob");
    expect(taskRuntimeToolForLabel("subagent")).toBe("task");
    expect(taskRuntimeToolForLabel("browser")).toBe("web");
  });

  it("extracts file and shell context without losing provider payloads", () => {
    const normalized = workspaceActivityToTaskRuntimeActivity(
      activity({
        id: "edit-1",
        kind: "tool_completed",
        tool: {
          name: "apply_patch",
          label: "apply_patch",
          durationMs: 42,
          state: "completed",
        },
        providerInput: {
          file_path: "src/app.tsx",
          cwd: "/workspace",
        },
        providerOutput: { diff: "@@ -1 +1 @@" },
      }),
    );

    expect(normalized).toMatchObject({
      kind: "tool",
      tool: "edit",
      status: "complete",
      path: "src/app.tsx",
      cwd: "/workspace",
      diff: "@@ -1 +1 @@",
      durationMs: 42,
    });
  });

  it("keeps approval as a runtime control state", () => {
    const normalized = workspaceActivityToTaskRuntimeActivity(
      activity({
        id: "approval-1",
        kind: "approval",
        title: "Approval required",
        tone: "warning",
        summary: "Approve the command",
      }),
    );

    expect(normalized).toMatchObject({
      kind: "approval",
      status: "waiting_approval",
      summary: "Approve the command",
    });
  });
});
