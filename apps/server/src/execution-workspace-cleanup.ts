import { join } from "node:path";
import type { WorkspaceCleanupHost } from "@chrona/engine";
import { cleanupLocalWorkspace } from "../../../packages/integrations/src/executor/workspace-cleanup";

export function createExecutionWorkspaceCleanupHost(dataDir: string): WorkspaceCleanupHost {
  return (request, command, verify) => {
    const { principal, input, grant } = request;
    return cleanupLocalWorkspace({
      binding: { executorId: "server", workspaceId: principal.workspaceId, ownerId: principal.ownerId, ...(principal.caller.kind === "module" ? { moduleId: principal.caller.moduleId } : {}) },
      work: { workId: input.workId, workspaceRef: request.workspaceRef, workspaceMode: input.workspace.mode, baseline: input.workspace.baseline, ...(input.workspace.source ? { source: input.workspace.source } : {}) },
      mapping: { placement: input.placement, canonicalPath: grant.canonicalPath, directoryIdentity: grant.directoryIdentity, baseline: grant.baseline }, managedRoot: join(dataDir, "execution-workspaces"),
    }, command, verify);
  };
}
