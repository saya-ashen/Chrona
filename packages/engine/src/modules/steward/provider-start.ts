import type { ProviderAdapter } from "@chrona/contracts/steward";
type Handle = ReturnType<ProviderAdapter["start"]>;
/** Publish a cancel/injection handle before asynchronous context preparation, not after spawning. */
export function providerStartGate() {
  let active: Handle | null = null, stopped = false;
  let resolve!: (value: Handle | null) => void;
  const ready = new Promise<Handle | null>(done => { resolve = done; });
  const handle: Handle = {
    done: ready.then(value => value ? value.done : { outcome: "failed", sessionId: null, error: "Provider launch cancelled or failed" }),
    async inject(message, images) {
      const value = await ready;
      if (!value || stopped) throw new Error("Provider launch is not active");
      await value.inject(message, images);
    },
    async abort() {
      stopped = true;
      if (active) await active.abort(); else resolve(null);
    },
  };
  return { handle, stopped: () => stopped, fail: () => resolve(null), attach(value: Handle) {
    if (stopped) throw new Error("Provider launch was cancelled");
    active = value; resolve(value);
  } };
}
