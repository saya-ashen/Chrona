const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * Returns a heartbeat delay with ±10% jitter around `base`.
 *
 * Without jitter, every SSE connection opened in the same window ticks in
 * lockstep, producing a thundering-herd of heartbeat writes at a fixed
 * cadence. Spreading each tick by a random ±10% decorrelates connections.
 */
export function heartbeatDelayMs(base: number = DEFAULT_HEARTBEAT_INTERVAL_MS): number {
  return Math.round(base * (0.9 + Math.random() * 0.2));
}

/** Minimal SSE-stream surface the heartbeat needs. */
interface HeartbeatStream {
  writeSSE(message: { event: string; data: string }): Promise<void>;
}

/**
 * Starts a jittered heartbeat that re-randomizes its delay on every tick
 * (recursive setTimeout, not setInterval, so the jitter applies per-tick).
 * Returns a stop function that clears the pending timer.
 */
export function startSseHeartbeat(stream: HeartbeatStream, base: number = DEFAULT_HEARTBEAT_INTERVAL_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const schedule = () => {
    timer = setTimeout(() => {
      if (stopped) return;
      void stream.writeSSE({ event: "heartbeat", data: "{}" }).catch(() => undefined);
      schedule();
    }, heartbeatDelayMs(base));
  };

  schedule();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
