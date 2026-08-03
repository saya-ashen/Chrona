import type { AiFeatureManifest } from "@chrona/contracts/ai-feature-runtime";

export type AiFeatureProviderCapabilities = {
  /** Start with a stable client operation ID attaches rather than duplicates work. */
  supportsClientOperationId: boolean;
  /** A persisted provider run can be resumed after a process crash. */
  supportsResume: boolean;
  /** The provider accepts engine-managed action results on that resumed run. */
  actionInvocation: "engine_managed" | "external_control_plane" | "unsupported";
};

/** Rejects unsupported feature execution before observations or a provider request are attempted. */
export function validateProviderCapabilities(
  manifest: AiFeatureManifest,
  capabilities: AiFeatureProviderCapabilities,
): string | null {
  const requiresInvoke = manifest.actions.some(({ mode }) => mode === "invoke");
  if (!capabilities.supportsClientOperationId) return "Provider does not support idempotent client operations.";
  if (!capabilities.supportsResume) return "Provider does not support durable run recovery.";
  if (requiresInvoke && capabilities.actionInvocation !== "engine_managed") return "Provider does not support engine-managed feature invoke actions.";
  return null;
}
