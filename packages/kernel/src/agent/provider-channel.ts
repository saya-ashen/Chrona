import { randomUUID } from "node:crypto";
import { safeProviderPayload } from "./agent-provider-redaction";
import type { Prisma } from "@chrona/db";
import { providerAnswerSchema, providerInteractionSchema, providerProgressSchema, providerQuestionSchema, providerResourcesSchema, providerUsageSchema, type ProviderAnswer, type ProviderEvents, type ProviderInteraction } from "@chrona/contracts/steward";
import { providerRunActive, providerText, safeProviderQuestion, validProviderAnswer } from "@chrona/domain/steward/provider";
import type { StewardPorts } from "../ports";
import { parseInput, StewardError } from "../errors";
import { liveRuns } from "../execution/runs";
import { cancelProviderRun } from "./provider-cancel";
import { notifyUser, withdrawNotice } from "../notify-user";
import { drainCalls } from "../modules/module-calls";
import { providerJournal, providerReceipt, providerRuns } from "./provider-journal";

type Pending = { runId: string; workspaceId: string; db: StewardPorts["db"]; request: ProviderInteraction; claimed: boolean; closed: boolean; settle(value: ProviderAnswer, status: ProviderInteraction["status"]): Promise<void> };
const pending = new Map<string, Pending>();
function assertPending(entry: Pending | undefined, workspaceId: string, db: StewardPorts["db"], now: Date): asserts entry is Pending {
  if (!entry || entry.workspaceId !== workspaceId || entry.db !== db || entry.closed || entry.claimed || Date.parse(entry.request.expiresAt) <= now.getTime()) throw new StewardError("conflict", "Provider interaction is no longer active");
}
export function hasLiveProviderInteraction(ports: StewardPorts, workspaceId: string, runId: string, requestId: string): boolean {
  const entry = pending.get(requestId);
  return !!entry && entry.db === ports.db && entry.workspaceId === workspaceId && entry.runId === runId && !entry.closed && !entry.claimed && Date.parse(entry.request.expiresAt) > ports.now().getTime() && liveRuns.has(runId);
}
const alreadyClosed = (entry: Pending) => entry.closed;
type RunIdentity = { id: string; workspaceId: string; sessionId: string | null; deadlineAt: Date | null; token?: string };

/** Technical event journal only: no raw RPC, answer body, new permission grant or replayable authorization. */
export function createProviderChannel(ports: StewardPorts, run: RunIdentity, onInteraction?: (request: ProviderInteraction) => Promise<void>) {
  const { db, now } = ports, write = providerJournal(db, run.id, now);
  const withdraw = () => withdrawNotice(db, ports, run.workspaceId, `provider-input:${run.id}`);
  let closed = false, questions = 0, previous = "", observerFailure: unknown;
  async function observe(request: ProviderInteraction) {
    if (!onInteraction) return;
    const { method, title, message, options, timeoutMs } = request.question;
    try { await onInteraction({ ...request, question: { method, title, message, options, timeoutMs } }); }
    // Keep the actual question answerable after a detail failure; close reports that failure to the finalizer.
    catch (error) { observerFailure ??= error; }
  }
  const owned = new Set<string>();
  function checkQuestionCapacity(signal: AbortSignal) {
    if (closed || signal.aborted) throw new StewardError("conflict", "Provider interaction is closed or cancelled");
    if (questions >= 12) throw new StewardError("conflict", "Provider interaction budget exhausted (12 accepted questions)");
    if (owned.size >= 3) throw new StewardError("conflict", "Provider interaction has 3 pending questions; wait for an answer");
  }
  async function question(raw: Parameters<ProviderEvents["question"]>[0], signal: AbortSignal): Promise<ProviderAnswer> {
    checkQuestionCapacity(signal);
    const input = parseInput(providerQuestionSchema, raw);
    const safe = safeProviderQuestion(input, [run.token ?? ""]);
    if (!safe) throw new StewardError("invalid", "Sensitive request context cannot be approved here");
    const at = now(), expires = new Date(run.deadlineAt ? Math.min(run.deadlineAt.getTime(), at.getTime() + input.timeoutMs) : at.getTime() + input.timeoutMs);
    if (expires <= at) throw new StewardError("conflict", "Provider interaction expired");
    const request = providerInteractionSchema.parse({ id: randomUUID(), runId: run.id, sessionId: run.sessionId, question: safe, createdAt: at.toISOString(), expiresAt: expires.toISOString(), status: "pending" });
    let resolve!: (value: ProviderAnswer) => void;
    const answer = new Promise<ProviderAnswer>(done => { resolve = done; });
    const entry: Pending = { ...run, runId: run.id, db, request, claimed: false, closed: false, async settle(value, status) {
      if (entry.closed) return;
      entry.closed = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
      try {
        await providerReceipt(db, run.workspaceId, request.id, status, now());
        request.status = status;
        await observe(request);
        if (owned.size === 1) { await withdraw(); void drainCalls(ports, run.workspaceId).catch(error => console.error(JSON.stringify({ component: "provider-channel", event: "drain_calls.failed", workspaceId: run.workspaceId, error: String(error).slice(0, 2000) }))); }
      } catch (error) { resolve({ decision: "cancel" }); throw error; }
      finally { pending.delete(request.id); owned.delete(request.id); }
      resolve(signal.aborted || closed || now() >= expires ? { decision: "cancel" } : value);
    } };
    const abort = () => { void entry.settle({ decision: "cancel" }, "interrupted").catch(error => console.error(JSON.stringify({ component: "provider-channel", event: "interaction.settle_failed", runId: run.id, requestId: request.id, status: "interrupted", error: String(error).slice(0, 2000) }))); };
    const timer = setTimeout(() => { void entry.settle({ decision: "cancel" }, "expired").catch(error => console.error(JSON.stringify({ component: "provider-channel", event: "interaction.settle_failed", runId: run.id, requestId: request.id, status: "expired", error: String(error).slice(0, 2000) }))); }, expires.getTime() - at.getTime());
    pending.set(request.id, entry); owned.add(request.id); questions++;
    signal.addEventListener("abort", abort, { once: true });
    let admitted = false;
    try {
      await db.$transaction(async tx => {
        const { method, title, message, options, timeoutMs } = safe;
        const stored = { ...request, question: { method, title, message, options, timeoutMs } };
        await tx.runInteraction.create({ data: { id: request.id, runId: run.id, request: stored, createdAt: at } });
        if (!signal.aborted && !closed && !entry.closed) await notifyUser(tx, ports, run.workspaceId, { kind: "provider-input-required", run: run.id, ...(run.sessionId ? { session: run.sessionId } : {}), key: `provider-input:${run.id}` });
      });
      admitted = true;
      if (!entry.closed) await observe(request);
      if (signal.aborted || closed) abort();
      void drainCalls(ports, run.workspaceId).catch(error => console.error(JSON.stringify({ component: "provider-channel", event: "drain_calls.failed", workspaceId: run.workspaceId, error: String(error).slice(0, 2000) })));
      if (entry.closed && !owned.size) await withdraw();
      return await answer;
    } catch (error) {
      if (!admitted) questions--;
      await entry.settle({ decision: "cancel" }, "interrupted");
      throw error;
    }
  }
  const events: ProviderEvents = {
    async raw(value) { if (!closed) await write("raw", safeProviderPayload(value, [run.token ?? ""])); },
    async progress(raw) {
      if (closed) return;
      const value = parseInput(providerProgressSchema, raw);
      if (value.tool !== null && providerText(value.tool, [run.token ?? ""], 100) !== value.tool) value.tool = null;
      const key = JSON.stringify(value);
      if (previous === key) return;
      previous = key; await write("progress", value);
    },
    async usage(value) { if (!closed) await write("usage", parseInput(providerUsageSchema, value)); },
    async resources(raw) {
      if (closed) return;
      const value = parseInput(providerResourcesSchema, raw);
      value.skills = value.skills.map(skill => providerText(skill, [run.token ?? ""], 100));
      await write("resources", value);
    },
    question,
  };
  return { events, async close() {
    closed = true;
    await Promise.all([...owned].map(id => pending.get(id)?.settle({ decision: "cancel" }, "interrupted")));
    if (observerFailure) throw observerFailure;
  } };
}

/** Validate the real live question using F's transaction, before consuming its command key. */
export async function validateExecutionAnswer(ports: StewardPorts, tx: Prisma.TransactionClient, input: { workspaceId: string; runId: string; requestId: string; answer: ProviderAnswer }): Promise<void> {
  const row = await tx.runInteraction.findFirst({ where: { id: input.requestId, runId: input.runId, run: { workspaceId: input.workspaceId } } });
  if (!row) throw new StewardError("not_found", "Provider interaction not found");
  const request = parseInput(providerInteractionSchema, row.request), entry = pending.get(input.requestId);
  assertPending(entry, input.workspaceId, ports.db, ports.now());
  if (entry.runId !== input.runId || request.runId !== input.runId) throw new StewardError("conflict", "Provider interaction belongs to another run");
  if (!validProviderAnswer(entry.request.question, input.answer)) throw new StewardError("invalid", "Answer does not match question");
  if (row.status !== "pending") throw new StewardError("conflict", "Provider interaction already resolved");
}

export function createProviderControl(ports: StewardPorts, workspaceId: string) {
  const { db, now } = ports;
  async function activeRun(id: string) {
    const run = await db.run.findFirst({ where: { workspaceId, id } });
    if (!run) throw new StewardError("not_found", "Run not found");
    if (!providerRunActive(run, liveRuns.has(id), now())) throw new StewardError("conflict", "Run is no longer active");
    return run;
  }
  const cancel = (id: string) => cancelProviderRun(ports, workspaceId, id);
  return {
    list: (sessionId?: string, ids?: string[]) => providerRuns({ db, workspaceId, now }, { sessionId, ids }, id => liveRuns.has(id), id => pending.has(id), id => {
      const entry = pending.get(id);
      return entry && entry.db === db && entry.workspaceId === workspaceId ? entry.request.question : null;
    }),
    async answer(id: string, raw: unknown) {
      const row = await db.runInteraction.findFirst({ where: { id, run: { workspaceId } } });
      if (!row) throw new StewardError("not_found", "Provider interaction not found");
      const request = parseInput(providerInteractionSchema, row.request), entry = pending.get(id);
      const answer = parseInput(providerAnswerSchema, raw);
      if (!validProviderAnswer(request.question, answer)) throw new StewardError("invalid", "Answer does not match question");
      assertPending(entry, workspaceId, db, now());
      entry.claimed = true;
      try {
        const run = await activeRun(request.runId);
        if (run.cancelRequestedAt || row.status !== "pending" || alreadyClosed(entry)) throw new StewardError("conflict", "Provider interaction already resolved");
        await entry.settle(answer, answer.decision === "cancel" ? "cancelled" : "answered");
        return { ok: true as const };
      } catch (error) { entry.claimed = false; throw error; }
    },
    cancel,
  };
}
