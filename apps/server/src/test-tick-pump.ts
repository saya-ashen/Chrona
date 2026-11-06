/** Test hosts poll frequently; one slow tick must not keep replenishing runtime.pending. */
export function startTestTickPump(tick: () => Promise<unknown>, intervalMs: number) {
  let running: Promise<unknown> | undefined, failure: { error: unknown } | undefined, stopped = false;
  const timer = setInterval(() => {
    if (stopped || running) return;
    running = Promise.resolve().then(tick).catch(error => {
      failure = { error };
      stopped = true;
      clearInterval(timer);
    }).finally(() => { running = undefined; });
  }, intervalMs);
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
    if (failure) throw failure.error;
  };
}
