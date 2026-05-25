import { describe, expect, it } from "bun:test";
import { getPlanRun } from "@/modules/plan-execution/plan-run-store";
import { ensureNativePlanRun } from "./plan-runtime-store";
import { acquireExecutionLease, releaseExecutionLease } from "./execution-lease-store";
import {
  makeSingleTaskPlan,
  seedAcceptedCompiledPlan,
  seedWorkspaceAndTask,
  setupPlanRunnerTaskExecutorTest,
} from "../plan-runner.task-executor.fixtures";

describe("execution lease store", () => {
  setupPlanRunnerTaskExecutorTest();

  it("increments epochs when the same owner refreshes its lease", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Lease refresh");
    const compiledPlan = makeSingleTaskPlan("graph_lease_refresh");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);
    await ensureNativePlanRun(task.id);

    const first = await acquireExecutionLease({
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      ownerId: "owner-a",
      scope: "manual",
      now: new Date("2026-05-24T00:00:00.000Z"),
    });
    const second = await acquireExecutionLease({
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      ownerId: "owner-a",
      scope: "manual",
      now: new Date("2026-05-24T00:00:05.000Z"),
    });

    expect(first?.epoch).toBe(1);
    expect(second?.epoch).toBe(2);
    expect(second?.ownerId).toBe("owner-a");
    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted).toMatchObject({
      executionOwnerId: "owner-a",
      executionOwnerScope: "manual",
      executionEpoch: 2,
    });
  });

  it("blocks another owner before expiry, then allows takeover after expiry", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Lease takeover");
    const compiledPlan = makeSingleTaskPlan("graph_lease_takeover");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);
    await ensureNativePlanRun(task.id);

    const first = await acquireExecutionLease({
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      ownerId: "owner-a",
      scope: "manual",
      leaseMs: 10_000,
      now: new Date("2026-05-24T00:00:00.000Z"),
    });
    const blocked = await acquireExecutionLease({
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      ownerId: "owner-b",
      scope: "system",
      now: new Date("2026-05-24T00:00:05.000Z"),
    });
    const takeover = await acquireExecutionLease({
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      ownerId: "owner-b",
      scope: "system",
      now: new Date("2026-05-24T00:00:11.000Z"),
    });

    expect(first?.epoch).toBe(1);
    expect(blocked).toBeNull();
    expect(takeover).toMatchObject({ ownerId: "owner-b", scope: "system", epoch: 2 });
    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted).toMatchObject({
      executionOwnerId: "owner-b",
      executionOwnerScope: "system",
      executionEpoch: 2,
    });
  });

  it("ignores stale releases after ownership has moved to a newer epoch", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Lease stale release");
    const compiledPlan = makeSingleTaskPlan("graph_lease_stale_release");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);
    await ensureNativePlanRun(task.id);

    const staleLease = await acquireExecutionLease({
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      ownerId: "owner-a",
      scope: "manual",
      leaseMs: 1_000,
      now: new Date("2026-05-24T00:00:00.000Z"),
    });
    const activeLease = await acquireExecutionLease({
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      ownerId: "owner-b",
      scope: "runtime-sync",
      now: new Date("2026-05-24T00:00:02.000Z"),
    });

    const staleRelease = await releaseExecutionLease({
      planRunId: staleLease?.planRunId ?? "missing",
      ownerId: "owner-a",
      epoch: staleLease?.epoch ?? -1,
    });
    const afterStaleRelease = await getPlanRun(task.id, compiledPlan.editablePlanId);
    const activeRelease = await releaseExecutionLease({
      planRunId: activeLease?.planRunId ?? "missing",
      ownerId: "owner-b",
      epoch: activeLease?.epoch ?? -1,
    });

    expect(staleRelease.count).toBe(0);
    expect(afterStaleRelease).toMatchObject({
      executionOwnerId: "owner-b",
      executionOwnerScope: "runtime-sync",
      executionEpoch: 2,
    });
    expect(activeRelease.count).toBe(1);
    const released = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(released).toMatchObject({
      executionOwnerId: null,
      executionOwnerScope: null,
      executionLeaseUntil: null,
      executionEpoch: 2,
    });
  });
});
