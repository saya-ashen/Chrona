import type { GateCheckResult, GateReport } from "./types";

const REQUIRED_CHECKS = [
  "create_run",
  "query_status",
  "read_outputs",
  "resume_after_wait",
] as const;

export function evaluateOpenClawGate(checks: GateCheckResult[]): GateReport {
  const checkMap = new Map(checks.map((check) => [check.name, check]));
  const normalized = REQUIRED_CHECKS.map(
    (name) => checkMap.get(name) ?? { name, passed: false, evidence: "missing check" },
  );

  return {
    overall: normalized.every((check) => check.passed) ? "pass" : "fail",
    checks: normalized,
  };
}

