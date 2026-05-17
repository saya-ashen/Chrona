export type TaskOrchestratorConfig = {
  enabled: boolean;
  intervalMs: number;
  tickOnStart: boolean;
  leaseName: string;
  leaseOwnerId: string;
  leaseTtlMs: number;
};

function readBoolean(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return fallback;
}

function readPositiveNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function readTaskOrchestratorConfig(): TaskOrchestratorConfig {
  return {
    enabled: readBoolean("CHRONA_TASK_ORCHESTRATOR_ENABLED", true),
    intervalMs: readPositiveNumber("CHRONA_TASK_ORCHESTRATOR_INTERVAL_MS", 15_000),
    tickOnStart: readBoolean("CHRONA_TASK_ORCHESTRATOR_TICK_ON_START", false),
    leaseName: process.env.CHRONA_TASK_ORCHESTRATOR_LEASE_NAME?.trim() || "task-orchestrator",
    leaseOwnerId: getTaskOrchestratorOwnerId(),
    leaseTtlMs: readPositiveNumber("CHRONA_TASK_ORCHESTRATOR_LEASE_TTL_MS", 30_000),
  };
}

export function getTaskOrchestratorOwnerId() {
  const configured = process.env.CHRONA_TASK_ORCHESTRATOR_OWNER_ID?.trim();
  if (configured) return configured;
  return `${process.env.HOSTNAME ?? "local"}:${process.pid}`;
}
