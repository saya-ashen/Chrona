import type { ProviderAdapter } from "@chrona/contracts/steward";
import { runtimeCompletionSchema } from "@chrona/contracts/steward";
import { transcriptRedactor } from "@chrona/logging/redaction";
import type { z } from "zod";
import type { completionInput } from "./schema";
import type { LaunchConfiguration } from "./configuration";

export type CompletionResult = z.infer<typeof runtimeCompletionSchema>;
export type PrepareCompletion = (input: z.infer<typeof completionInput>) => Promise<{
  provider: ProviderAdapter; input: Parameters<NonNullable<ProviderAdapter["complete"]>>[0]; configuration?: LaunchConfiguration;
}>;
/** A completion shares the operation journal and can settle only after adapter closure. */
export function completionHandle(prepared: Awaited<ReturnType<PrepareCompletion>>, maxOutputTokens: number) {
  const controller = new AbortController();
  let result: CompletionResult | undefined;
  const done = (async () => {
    let raw: unknown;
    try {
      // Pi accepts this narrow extension. Generic synchronous fake providers remain valid.
      const input = { ...prepared.input, signal: controller.signal };
      raw = await prepared.provider.complete!(input);
    } catch (error) {
      if (!error || typeof error !== "object" || !("stopped" in error) || error.stopped !== true) throw error;
      return { outcome: "code" in error && error.code === "timeout" ? "timed_out" as const : "failed" as const, sessionId: null, error: controller.signal.aborted ? "Pi completion was stopped" : "Pi completion stopped without a result" };
    }
    const checked = runtimeCompletionSchema.safeParse(raw);
    if (!checked.success || checked.data.outputTokens !== null && checked.data.outputTokens > maxOutputTokens || Buffer.byteLength(checked.data.text) > 2 * 1024 * 1024) {
      return { outcome: "failed" as const, sessionId: null, error: "Pi completion exceeded its result or budget bound" };
    }
    checked.data.text = transcriptRedactor()(checked.data.text, Number.MAX_SAFE_INTEGER);
    if (Buffer.byteLength(checked.data.text) > 2 * 1024 * 1024) return { outcome: "failed" as const, sessionId: null, error: "Pi completion exceeded its result bound" };
    result = checked.data;
    return { outcome: "finished" as const, sessionId: null, error: null };
  })();
  return { handle: { done, async abort() { controller.abort(); await done; }, async inject() { throw new Error("Completion does not accept messages"); } }, result: () => result };
}
