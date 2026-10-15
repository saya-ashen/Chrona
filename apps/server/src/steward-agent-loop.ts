import type { PrismaClient } from "@chrona/db";
import { createStewardWork, serializeSteward } from "@chrona/engine";
import { WORK_LIMITS } from "@chrona/contracts/steward";
import { createPiAgentRunner, resolvePiAgentExtension } from "@chrona/integrations/steward";

type Runner = ReturnType<typeof createPiAgentRunner>;
type Work = ReturnType<typeof createStewardWork>;
type Claim = Awaited<ReturnType<Work["claimDue"]>>[number];
type Outcome = Awaited<ReturnType<Runner["run"]>>["outcome"];
export type AgentLoopOptions = { db: PrismaClient; now?: () => Date; port?: number; allowedRecipients: readonly string[]; deliver: (workspaceId: string) => Promise<unknown>; onError?: () => void };

function createRunner(port: number | undefined): Runner | null {
  const extensionPath = resolvePiAgentExtension();
  if (!extensionPath || !port) return null;
  return createPiAgentRunner({
    command: process.env.CHRONA_STEWARD_PI_COMMAND || undefined, model: process.env.CHRONA_STEWARD_PI_MODEL || undefined,
    extensionPath, webExtensionPath: process.env.CHRONA_STEWARD_PI_WEB_EXTENSION,
    agentUrl: `http://127.0.0.1:${port}/api/steward-agent`, timeoutMs: WORK_LIMITS.attemptTimeoutMs,
  });
}

const errorFor = (outcome: Outcome) => outcome === "unavailable" ? "AGENT_UNAVAILABLE" : outcome === "timeout" ? "AGENT_TIMEOUT" : null;

/** Chrona's only agent scheduler: at most one Pi process per server; the DB queue is never held while Pi runs. */
export function createStewardAgentLoop(options: AgentLoopOptions) {
  const configured = process.env.CHRONA_STEWARD_AGENT === "pi";
  const runner = configured ? createRunner(options.port) : null;
  const queue = <T>(fn: () => Promise<T>) => serializeSteward(options.db, fn);
  const state = { configured, running: false, lastError: configured && !runner ? "AGENT_CONFIGURATION_INCOMPLETE" : null as string | null, stopping: false };
  let current: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function runClaim(work: Work, claim: Claim, active: Runner) {
    const stop = () => state.stopping ? Promise.resolve(true) : queue(() => work.shouldStop(claim.attemptId));
    let outcome: Outcome = "killed", note = "";
    try {
      if (!await stop()) ({ outcome, note } = await active.run({ token: claim.token, deadlineAt: claim.deadlineAt, shouldStop: stop }));
      state.lastError = errorFor(outcome);
    } catch { outcome = "unavailable"; state.lastError = "AGENT_RUN_FAILED"; }
    await queue(() => work.finishAttempt(claim.attemptId, { outcome, note }));
    await options.deliver(claim.workspaceId);
  }
  async function runWorkspace(workspaceId: string, active: Runner) {
    const work = createStewardWork({ db: options.db, now: options.now, workspaceId, allowedRecipients: new Set(options.allowedRecipients) });
    const claims = await queue(async () => { await work.recover(); await work.wakeDueFollowUps(); return state.stopping ? [] : work.claimDue({ limit: 1 }); });
    for (const claim of claims) await runClaim(work, claim, active);
  }
  async function loop(active: Runner) {
    for (const { id } of await queue(() => options.db.workspace.findMany({ select: { id: true } }))) {
      if (state.stopping) return;
      try { await runWorkspace(id, active); } catch { state.lastError = "AGENT_LOOP_FAILED"; options.onError?.(); }
    }
  }
  function runAgentOnce(): Promise<void> {
    if (current) return current;
    if (state.stopping || !runner) return Promise.resolve();
    state.running = true;
    current = loop(runner).finally(() => { state.running = false; current = undefined; });
    return current;
  }
  return {
    status: () => ({ configured: state.configured, running: state.running, lastError: state.lastError }),
    runAgentOnce,
    start() {
      const seconds = Number(process.env.CHRONA_STEWARD_AGENT_POLL_SECONDS ?? 15);
      if (timer || !runner || !Number.isFinite(seconds) || seconds <= 0) return;
      timer = setInterval(() => { void runAgentOnce(); }, seconds * 1000);
    },
    async stop() { state.stopping = true; if (timer) clearInterval(timer); timer = undefined; await current; },
  };
}
