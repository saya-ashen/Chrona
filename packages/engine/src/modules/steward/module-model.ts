import { THINKING_LEVELS } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import type { CallScope } from "./module-supervisor";
export type { CallScope };
import { CallError } from "./module-calls";
import { runtimeCall } from "./local-runtime";

import { reserveCompletion, finishCompletion, refused, type ModelError } from "./module-model-budget";
type ModelParams = { system?: string; prompt: string; maxOutputTokens: number };
type ThinkingLevel = (typeof THINKING_LEVELS)[number];
/**
 * `provider.complete` (v2-11): one completion for a module, within its manifest's tier and limits and the owner's moduleModel.
 * Reserve in SQLite before leaving the transaction: concurrent modules share the daily budget.
 */
async function requestCompletion(ports: StewardPorts, workspaceId: string, params: ModelParams, target: { model: string; thinking?: ThinkingLevel }, timeoutMs: number) {
  try {
    const result = await runtimeCall<{ text: string; inputTokens: number | null; outputTokens: number | null }>(ports, workspaceId, "agent.complete", { ...params, ...target, timeoutMs });
    // shortcut: approximate the output token cap with four characters per token.
    return { result: { ...result, text: result.text.slice(0, params.maxOutputTokens * 4) }, error: null as ModelError | null };
  } catch (cause) {
    return { result: undefined, error: cause instanceof CallError && cause.message === "timeout" ? "timeout" as const : "provider_error" as const };
  }
}
export async function completeForModule(ports: StewardPorts, scope: CallScope, params: ModelParams) {
  const reservation = await reserveCompletion(ports, scope, params, ports.now());
  if (reservation.error) throw refused(reservation.error);
  const settings = reservation.settings!, model = reservation.model!;
  const { result, error } = await requestCompletion(ports, scope.workspaceId, params, { model, ...(reservation.thinking ? { thinking: reservation.thinking } : {}) }, settings.timeoutMs);
  await finishCompletion(ports, scope.workspaceId, { id: reservation.id, result, error, model });
  if (error) throw refused(error);
  return result!;
}
