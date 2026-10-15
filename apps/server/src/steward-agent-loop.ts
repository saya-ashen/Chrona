import type { StewardService } from "@chrona/engine";

export type AgentOutcome = { outcome: "exited" | "timeout" | "unavailable" | "killed"; note: string };
export type AffairAgent = { runAffair(input: { runId: string; token: string; affairId: string; deadline: Date; shouldStop: () => Promise<boolean> }): Promise<void | AgentOutcome> };

/** Independent FIFO lanes: at most one concierge and one affair process. */
export function createAgentSlot() {
  const lanes = {
    concierge: { busy: false, queue: [] as (() => void)[] },
    affair: { busy: false, queue: [] as (() => void)[] },
  };
  return async function slot<T>(role: "concierge" | "affair", work: () => Promise<T>): Promise<T> {
    const lane = lanes[role];
    await new Promise<void>(resolve => {
      if (!lane.busy) { lane.busy = true; resolve(); }
      else lane.queue.push(resolve);
    });
    try { return await work(); } finally {
      const next = lane.queue.shift();
      if (next) next(); else lane.busy = false;
    }
  };
}

export function createStewardAgentLoop(options: {
  service: StewardService; agent: AffairAgent | null; slot: ReturnType<typeof createAgentSlot>;
  onError?: () => void; pollSeconds?: number;
}) {
  let current: Promise<void> | undefined, timer: ReturnType<typeof setInterval> | undefined;
  let stopping = false, wakePending = false, lastError: string | null = null;
  async function step() {
    await options.service.runs.expireLeases();
    if (!options.agent || stopping) return false;
    return options.slot("affair", async () => {
      if (stopping) return false;
      const claim = await options.service.runs.claimNext();
      if (!claim) return false;
      const shouldStop = async () => stopping || await options.service.runs.shouldStop(claim.runId);
      let result: AgentOutcome = { outcome: "exited", note: "" };
      try {
        if (await shouldStop()) result = { outcome: "killed", note: "" };
        else result = await options.agent!.runAffair({ ...claim, deadline: claim.deadlineAt, shouldStop }) ?? result;
        lastError = result.outcome === "unavailable" ? "AGENT_UNAVAILABLE" : null;
      } catch { result = { outcome: "unavailable", note: "Agent unavailable" }; lastError = "AGENT_RUN_FAILED"; }
      await options.service.runs.finishRun(claim.runId, result);
      return true;
    });
  }
  function runAgentOnce(): Promise<void> {
    wakePending = true;
    if (current) return current;
    if (stopping) return Promise.resolve();
    current = (async () => {
      do {
        wakePending = false;
        // Drain due work; each claim reacquires the affair slot.
        while (!stopping && await step()) { /* bounded by engine budgets/backoff */ }
      } while (wakePending && !stopping);
    })().catch(() => { lastError = "AGENT_LOOP_FAILED"; options.onError?.(); }).finally(() => { current = undefined; });
    return current;
  }
  return {
    status: () => ({ configured: !!options.agent, running: !!current, lastError }), runAgentOnce,
    start() {
      const seconds = options.pollSeconds ?? Number(process.env.CHRONA_STEWARD_AGENT_POLL_SECONDS ?? 15);
      if (timer || !Number.isFinite(seconds) || seconds <= 0) return;
      stopping = false;
      timer = setInterval(() => { void runAgentOnce(); }, seconds * 1000);
      void runAgentOnce();
    },
    async stop() { stopping = true; if (timer) clearInterval(timer); timer = undefined; await current; },
  };
}
