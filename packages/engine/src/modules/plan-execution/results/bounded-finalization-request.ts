import { runProviderRequest, type ProviderFeatureRequest } from "../../ai";

export class FinalizationDeadlineError extends Error {
  constructor(readonly reason: "timeout" | "interrupted") {
    super("Result finalization interrupted or timed out");
  }
}

/** An editorial provider (including its startup/cleanup) cannot hold publication
 * forever. Abort is sent to the provider; the caller's deadline does not depend
 * on the provider honoring that signal. Late results never reach persistence. */
export async function boundedFinalizationRequest(
  client: Parameters<typeof runProviderRequest>[0],
  request: ProviderFeatureRequest,
  timeoutMs: number,
  runRequest: typeof runProviderRequest = runProviderRequest,
) {
  const controller = new AbortController();
  const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let interrupt = () => {};
  try {
    signal.throwIfAborted();
    const interrupted = new Promise<never>((_resolve, reject) => {
      interrupt = () => reject(new FinalizationDeadlineError(controller.signal.aborted ? "timeout" : "interrupted"));
      signal.addEventListener("abort", interrupt, { once: true });
      timer = setTimeout(() => controller.abort(), timeoutMs);
    });
    return await Promise.race([
      runRequest(client, { ...request, timeoutMs, signal }),
      interrupted,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener("abort", interrupt);
  }
}
