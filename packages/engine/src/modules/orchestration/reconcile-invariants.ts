import type { ReconciliationResult } from "@chrona/contracts";
import type { EffectivePlanGraph, EffectivePlanNode } from "@chrona/graph-runtime";

export function detectReconciliationIssues(graph: EffectivePlanGraph): ReconciliationResult["issues"] {
  const terminalWithPendingPrereq = graph.terminalNodeIds.some((terminalId) => {
    const terminal = graph.nodes.find((node) => node.id === terminalId);
    if (!terminal || terminal.status !== "completed") return false;
    return terminal.dependencies.some((depId) => {
      const dep = graph.nodes.find((node) => node.id === depId);
      return dep?.reachable && !isTerminalStatus(dep.status);
    });
  });

  return terminalWithPendingPrereq
    ? [
        {
          code: "terminal_completed_with_pending_prerequisite",
          severity: "error",
          message: "Terminal node completed while a reachable prerequisite is still incomplete.",
          nodeId: null,
        },
      ]
    : [];
}

export function deriveRepairActions(issues: ReconciliationResult["issues"]): ReconciliationResult["repairActions"] {
  return issues.some((issue) => issue.severity === "error")
    ? [{ type: "repair_inconsistency", enabled: true, label: "Repair state" }]
    : [];
}

function isTerminalStatus(status: EffectivePlanNode["status"]) {
  return status === "completed" || status === "skipped" || status === "invalidated" || status === "cancelled";
}
