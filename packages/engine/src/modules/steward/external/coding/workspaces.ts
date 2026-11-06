import { isDeepStrictEqual } from "node:util";
import type { WorkCleanupInput, WorkCleanupReceipt, WorkView, ExecutionPlacementView } from "./contract.js";
import { codingError, type CodingContext } from "./storage";

function sameDeadline(actual: string, selected: string | null) {
  const left = Date.parse(actual), right = Date.parse(selected ?? "");
  return Number.isFinite(left) && Number.isFinite(right) && left === right;
}
/** Only kernel facts may turn a requested workspace into a prepared or removed tree. */
export function installWorkspace(view: WorkView, actual: ExecutionPlacementView) {
  if (actual.workId !== view.workId || !isDeepStrictEqual(actual.placement, view.placement)
    || !sameDeadline(actual.queueExpiresAt, view.queueExpiresAt) || view.execution && (actual.runId !== view.execution.runId || actual.attemptId !== view.execution.attemptId || actual.sessionId !== view.execution.sessionId)) {
    throw codingError("conflict", "Workspace belongs to another execution");
  }
  if (view.workspace && (actual.workspace.workspaceRef !== view.workspace.workspaceRef || actual.workspace.mode !== view.workspace.mode || !isDeepStrictEqual(actual.workspace.baseline, view.workspace.baseline))) throw codingError("conflict", "Workspace selection changed");
  view.workspace = actual.workspace;
}
export async function cleanupWorkspace(context: CodingContext, view: WorkView, input: WorkCleanupInput): Promise<WorkCleanupReceipt> {
  if (view.kind !== "execution" || !view.workspace || view.workspace.mode !== "independent_worktree") throw codingError("unsupported", "No owned independent workspace");
  // The kernel rechecks stop/holds and reads a stable confirm receipt before inspecting disk.
  const receipt = await context.call<WorkCleanupReceipt>("executions.workspace-cleanup", input);
  if (receipt.workId !== view.workId || receipt.workspaceRef !== view.workspace.workspaceRef) throw codingError("conflict", "Cleanup receipt belongs to another workspace");
  return receipt;
}
