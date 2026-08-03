import type { ReconciliationResult } from "@chrona/contracts";

type ReconciliationGraphInput = {
  terminalNodeIds: string[];
  nodes: Array<{
    id: string;
    status: string;
    dependencies: string[];
    reachable: boolean;
  }>;
};

export function detectReconciliationIssues(graph: ReconciliationGraphInput): ReconciliationResult["issues"] {
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

function isTerminalStatus(status: string) {
  return status === "completed" || status === "skipped" || status === "invalidated" || status === "cancelled";
}
