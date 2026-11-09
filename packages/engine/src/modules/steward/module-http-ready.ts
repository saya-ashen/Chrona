import { RUN_LIMITS } from "@chrona/contracts/steward";
import type { LoopbackHttpEndpoint } from "@chrona/integrations/steward/module-sdk/transport";

type Timers = Pick<typeof globalThis, "setTimeout" | "clearTimeout">;

/** Only an authenticated wire readiness report can register the module's HTTP endpoint. */
export async function moduleHttpReady(channel: { httpReady: Promise<LoopbackHttpEndpoint>; closedWithError: Promise<Error> }, timers: Timers = globalThis) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      channel.httpReady,
      channel.closedWithError.then(error => { throw error; }),
      new Promise<never>((_, reject) => { timeout = timers.setTimeout(() => reject(new Error("Module HTTP start timeout")), RUN_LIMITS.jobTimeoutMs); }),
    ]);
  } finally { if (timeout) timers.clearTimeout(timeout); }
}
