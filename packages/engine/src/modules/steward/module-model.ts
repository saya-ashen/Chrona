import type { StewardPorts } from "./ports";
import type { CallScope } from "./module-supervisor";
export type { CallScope };
import { CallError } from "./module-call-error";
import { runtimeCall } from "./local-runtime";
import { reserveCompletion, finishCompletion, refused } from "./module-model-budget";
type ModelParams = { system?: string; prompt: string; maxOutputTokens: number };
/** Reserve atomically in the kernel; the Agent resolves the declared tier using its own policy. */
export async function completeForModule(ports: StewardPorts, scope: CallScope, params: ModelParams) {
  const reservation = await reserveCompletion(ports, scope, params, ports.now());
  if (reservation.error) throw refused(reservation.error);
  let result: { text: string; inputTokens: number | null; outputTokens: number | null };
  try {
    result = await runtimeCall(ports, scope.workspaceId, "agent.complete", {
      ...params, declaredTier: reservation.declaredTier!, effectiveHardLimits: reservation.effectiveHardLimits!, timeoutMs: reservation.effectiveHardLimits!.eventTimeoutMs,
    });
  } catch (cause) {
    // A transport failure or polling timeout cannot prove the provider stopped. Keep its reservation pending.
    if (cause instanceof CallError && cause.code === "failed" && cause.message === "provider_error") {
      await finishCompletion(ports, scope.workspaceId, { id: reservation.id, error: "provider_error" }, { moduleId: scope.moduleId, hash: scope.hash });
    }
    throw refused(cause instanceof CallError && cause.message === "timeout" ? "timeout" : "provider_error");
  }
  await finishCompletion(ports, scope.workspaceId, { id: reservation.id, result, error: null }, { moduleId: scope.moduleId, hash: scope.hash });
  return result;
}
