import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  createTaskOrchestrator,
  type TaskOrchestratorOptions,
} from "./task-orchestrator";
import type { TaskOrchestratorConfig } from "./orchestrator-config";

const baseConfig: TaskOrchestratorConfig = {
  enabled: true,
  intervalMs: 1_000,
  tickOnStart: false,
  leaseName: "task-orchestrator-test",
  leaseOwnerId: "owner-a",
  leaseTtlMs: 30_000,
};

describe("task orchestrator ownership", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("does not run workers when another owner holds the active lease", async () => {
    const worker = { name: "owned-worker", run: mock(async () => {}) };
    const leaseRepository: NonNullable<TaskOrchestratorOptions["leaseRepository"]> = {
      acquire: mock(async () => ({
        acquired: false as const,
        lease: {
          name: baseConfig.leaseName,
          ownerId: "owner-b",
          epoch: 1,
          heartbeatAt: new Date(),
          expiresAt: new Date(Date.now() + 30_000),
          metadata: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })),
      renew: mock(async () => ({ renewed: false as const, lease: null })),
      complete: mock(async () => false),
      release: mock(async () => false),
    };
    const orchestrator = createTaskOrchestrator({
      config: baseConfig,
      workers: [worker],
      leaseRepository,
    });

    await orchestrator.tick();

    expect(worker.run).not.toHaveBeenCalled();
  });
});
