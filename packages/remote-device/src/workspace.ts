import { join } from "node:path";
import type { LocalWorkspaceInput } from "@chrona/workspaces";
import type { DeviceConfig } from "./config";
import type { Attempt } from "./journal";
import { executionDigest, type Delivery } from "./protocol";

export function workspaceOwner(config: DeviceConfig, delivery: Delivery) {
  return { device: config.device, deliveryId: delivery.deliveryId, launchDigest: delivery.launchDigest };
}
/** One exact local binding is shared by preparation and later explicit cleanup. */
export function workspaceInput(root: string, config: DeviceConfig, attempt: Attempt): LocalWorkspaceInput {
  const { launch } = attempt.delivery.packet;
  const mapping = config.mappings.find(mapping => mapping.workspaceRef === attempt.localWorkspaceRef && mapping.targetRef === launch.target.targetRef && mapping.targetRevision === launch.target.targetRevision && mapping.projectRef === launch.target.projectRef);
  if (!mapping || mapping.directoryIdentity !== launch.target.directoryIdentity || executionDigest(mapping.baseline) !== executionDigest(launch.target.baseline) || executionDigest(mapping.workspaceModes) !== executionDigest(launch.target.workspaceModes)) throw new Error("No exact trusted local mapping for immutable target");
  return { binding: workspaceOwner(config, attempt.delivery), work: { workId: launch.fence.workId, workspaceRef: launch.workspaceRef, workspaceMode: launch.workspace.mode, baseline: launch.workspace.baseline, ...(launch.workspace.source ? { source: launch.workspace.source } : {}) }, mapping: { placement: launch.placement, canonicalPath: mapping.canonicalPath, directoryIdentity: mapping.directoryIdentity, baseline: mapping.baseline }, managedRoot: join(root, "workspaces") };
}
