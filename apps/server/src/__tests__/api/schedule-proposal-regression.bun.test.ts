import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { decideScheduleProposal } from "@chrona/engine/test-support";
import { resetTestDb, seedScheduleProposal, seedTask, seedWorkspace } from "../bun-test-helpers";

describe("schedule proposal regressions", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("rejects a second decision after a proposal has already been accepted", async () => {
    const workspace = await seedWorkspace("Schedule duplicate decision regression");
    const task = await seedTask(workspace.workspaceId, { title: "Resolve duplicate proposal decision" });
    const proposal = await seedScheduleProposal({
      taskId: task.taskId,
      workspaceId: workspace.workspaceId,
      status: "Pending",
      scheduledStartAt: new Date("2026-05-28T09:00:00.000Z"),
      scheduledEndAt: new Date("2026-05-28T10:00:00.000Z"),
    });

    await decideScheduleProposal({
      proposalId: proposal.proposalId,
      decision: "Accepted",
      resolutionNote: "First decision wins",
    });

    await expect(decideScheduleProposal({
      proposalId: proposal.proposalId,
      decision: "Rejected",
      resolutionNote: "Late duplicate decision",
    })).rejects.toThrow("Only pending schedule proposals can be resolved.");

    const persisted = await db.scheduleProposal.findUniqueOrThrow({ where: { id: proposal.proposalId } });
    expect(persisted.status).toBe("Accepted");
    expect(persisted.resolutionNote).toBe("First decision wins");
  });
});
