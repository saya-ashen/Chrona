import { getTaskOrchestrator, startTaskOrchestrator } from "../modules/orchestration";
import { listExecutionRuntimes } from "../modules/execution-runtime";
import { db } from "@/lib/db";

export type RuntimeReadiness = {
  status: "ready" | "not_ready";
  checks: {
    database: "ok" | "failed";
    orchestrator: "running" | "stopped";
    recovery: "clear" | "backlog" | "failed";
  };
};

export function createRuntimeService() {
  return {
    listExecutionRuntimes: () => listExecutionRuntimes(),
    startTaskOrchestrator: () => startTaskOrchestrator(),
    stopTaskOrchestrator: () => getTaskOrchestrator().stop(),
    async getReadiness(): Promise<RuntimeReadiness> {
      let database: RuntimeReadiness["checks"]["database"] = "ok";
      let recovery: RuntimeReadiness["checks"]["recovery"] = "clear";

      try {
        await db.$queryRawUnsafe("SELECT 1");
      } catch {
        database = "failed";
      }

      try {
        const pendingTerminalActions = await db.taskPlanTerminalAction.count({
          where: { run: { status: { in: ["Pending", "Running", "WaitingForInput", "WaitingForApproval"] } } },
        });
        if (pendingTerminalActions > 0) recovery = "backlog";
      } catch {
        recovery = "failed";
      }

      const orchestrator = getTaskOrchestrator().isRunning() ? "running" : "stopped";
      return {
        status: database === "ok" && recovery !== "failed" && orchestrator === "running" ? "ready" : "not_ready",
        checks: { database, orchestrator, recovery },
      };
    },
    /**
     * Run a single orchestrator tick on demand. Used only by the env-gated
     * E2E test-route seam so Playwright can drive the schedule→auto-execution
     * loop deterministically instead of waiting on the 15s setInterval. Calls
     * the same `tick()` the interval uses, so it acquires the lease and runs
     * the registered workers exactly once.
     */
    tickTaskOrchestrator: () => getTaskOrchestrator().tick(),
  };
}
