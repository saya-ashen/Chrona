import { join } from "node:path";
import { createHash } from "node:crypto";
import { executorCanonicalJson } from "@chrona/contracts/steward";
import type { StewardPorts } from "@chrona/engine";
import { prepareLockedLocalWorkspace } from "../../../packages/integrations/src/executor/workspaces";

/** Trusted host adapter. Only the engine's authorized, fixed preparation request reaches filesystem I/O. */
export function createServerWorkspacePreparer(dataDir: string, now: () => Date): NonNullable<StewardPorts["executionServerWorkspace"]> {
  return { async prepare(request) {
    const { principal, input, grant } = request;
    const prepared = await prepareLockedLocalWorkspace({
      binding: { executorId: "server", workspaceId: principal.workspaceId, ownerId: principal.ownerId,
        ...(principal.caller.kind === "module" ? { moduleId: principal.caller.moduleId } : {}) },
      work: { workId: input.workId, workspaceRef: request.workspaceRef, workspaceMode: input.workspace.mode,
        baseline: input.workspace.baseline, ...(input.workspace.source ? { source: input.workspace.source } : {}) },
      mapping: { placement: input.placement, canonicalPath: grant.canonicalPath,
        directoryIdentity: grant.directoryIdentity, baseline: grant.baseline },
      managedRoot: join(dataDir, "execution-workspaces"),
    });
    try {
      return { bindingDigest: createHash("sha256").update(executorCanonicalJson(request)).digest("hex"),
        cwd: prepared.cwd, projectDirectoryIdentity: prepared.projectDirectoryIdentity,
        workspaceDirectoryIdentity: prepared.workspaceDirectoryIdentity,
        workspace: { ...prepared.workspace, sourceReceipt: prepared.sourceReceipt }, sourceReceipt: prepared.sourceReceipt,
        verifiedAt: now().toISOString(), release: prepared.release };
    } catch (error) { prepared.release(); throw error; }
  } };
}
