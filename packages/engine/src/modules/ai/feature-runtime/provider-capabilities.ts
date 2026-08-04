import type { AiFeatureManifest } from "@chrona/contracts/ai-feature-runtime";

export type AiFeatureProviderCapabilities = {
  /** How an interrupted provider start is handled without duplicating authoritative work. */
  startRecovery: "durable_attach" | "single_attempt_read_only" | "unsupported";
  /** The provider accepts engine-managed action results on a durably resumed run. */
  actionInvocation: "engine_managed" | "external_control_plane" | "unsupported";
};

export function usesSingleAttemptReadOnly(capabilities: AiFeatureProviderCapabilities): boolean {
  return capabilities.startRecovery === "single_attempt_read_only";
}

/** Rejects unsupported feature execution before observations or a provider request are attempted. */
export function validateProviderCapabilities(
  manifest: AiFeatureManifest,
  capabilities: AiFeatureProviderCapabilities,
): string | null {
  const requiresInvoke = manifest.actions.some(({ mode }) => mode === "invoke");
  if (capabilities.startRecovery === "unsupported") return "Provider does not support a safe feature start.";
  if (requiresInvoke && usesSingleAttemptReadOnly(capabilities)) return "Provider single-attempt read-only mode only supports proposed actions.";
  if (requiresInvoke && capabilities.actionInvocation !== "engine_managed") return "Provider does not support engine-managed feature invoke actions.";
  return null;
}
