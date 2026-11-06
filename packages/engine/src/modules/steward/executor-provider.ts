import type { ExecutorPrincipal, ExecutorRequests, ExecutorResponses, ProviderAnswer, ProviderInteraction, ProviderAdapter, ExecutionPrincipal } from "@chrona/contracts/steward";
import { executorDigest } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { assertExecutorRequest, assertExecutorTarget } from "./executor-auth";
import { createProviderChannel } from "./provider-channel";
import { liveRuns } from "./runs";
import { reserveDeviceCommandIn } from "./execution-control-budget";
import { CallError } from "./module-calls";

type LiveQuestion = { who: ExecutorPrincipal; input: ExecutorRequests["question"]; requestId: string | null; reply: ExecutorResponses["poll"]["questions"][number] | null; controller: AbortController; channel: ReturnType<typeof createProviderChannel> };
/** Uses the existing Provider interaction channel; only answer delivery is transient. */
export class ExecutorQuestions {
  readonly entries = new Map<string, LiveQuestion>();
  constructor(readonly ports: StewardPorts) {}
  async question(who: ExecutorPrincipal, input: ExecutorRequests["question"], signal: AbortSignal): Promise<ExecutorResponses["question"]> {
    const key = JSON.stringify([input.target.assignmentId, input.questionKey]);
    const current = this.entries.get(key);
    if (current && !current.requestId) throw new CallError("conflict", "Question registration in progress");
    if (current?.requestId) return { target: input.target, questionKey: input.questionKey, requestId: current.requestId, state: current.reply ? "interrupted" : "pending" };
    const digest = await executorDigest(input.value), commandKey = `remote-question:${await executorDigest(input.questionKey)}`;
    const row = await this.ports.db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "ExecutionExecutor" SET "id" = "id" WHERE 0`;
      await assertExecutorRequest(tx, who, "question", input);
      const assignment = await assertExecutorTarget(tx, who, input.target);
      const prior = await tx.executionCommand.findUnique({ where: { attemptId_commandKey: { attemptId: input.target.attemptId, commandKey } } });
      if (prior && prior.requestDigest !== digest) throw new CallError("conflict", "Question key content conflict");
      if (!prior && await tx.executionCommand.count({ where: { attemptId: input.target.attemptId, operation: "remote_question" } }) >= 12) throw new CallError("capacity", "Remote question budget reached");
      return { assignment, prior, run: await tx.run.findUniqueOrThrow({ where: { id: input.target.runId } }) };
    });
    if (row.prior) return { target: input.target, questionKey: input.questionKey, requestId: (row.prior.receipt as { requestId: string }).requestId, state: "interrupted" };
    if (!row.run.deadlineAt || row.run.status !== "running" || !liveRuns.has(row.run.id)) throw new CallError("conflict", "Remote run is not live");
    if (this.entries.size >= 6) throw new CallError("capacity", "Remote question capacity reached");
    const guard = async (tx: Parameters<typeof assertExecutorRequest>[0]) => {
      await assertExecutorRequest(tx, who, "question", input);
      const executor = await tx.executionExecutor.findUniqueOrThrow({ where: { id: who.executorId } });
      if (!executor.authorizedUntil || executor.authorizedUntil <= this.ports.now()) throw new CallError("forbidden", "Device authorization expired");
    };
    let resolve!: (request: ProviderInteraction) => void, reject!: (error: unknown) => void;
    const registered = new Promise<ProviderInteraction>((yes, no) => { resolve = yes; reject = no; });
    const a = row.assignment.attempt;
    const principal: ExecutionPrincipal = { workspaceId: who.workspaceId, ownerId: who.ownerId, caller: questionCaller(a) };
    const channel = createProviderChannel(this.ports, { id: row.run.id, workspaceId: who.workspaceId, sessionId: row.run.sessionId, deadlineAt: row.run.deadlineAt }, async interaction => {
      await this.ports.db.$transaction(async tx => {
        await tx.$executeRaw`UPDATE "ExecutionExecutor" SET "id" = "id" WHERE 0`;
        await guard(tx);
        if (!this.ports.remoteExecutionSink) throw new CallError("unavailable", "Remote interaction ingress unavailable");
        await this.ports.remoteExecutionSink.interaction(tx, principal, interaction, { workId: input.target.workId, sessionId: input.target.sessionId, runId: input.target.runId, attemptId: input.target.attemptId });
        const prior = await tx.executionCommand.findUnique({ where: { attemptId_commandKey: { attemptId: input.target.attemptId, commandKey } } });
        if (!prior) {
          const data = { attemptId: input.target.attemptId, commandKey, operation: "remote_question", requestDigest: digest, receipt: { requestId: interaction.id } };
          await reserveDeviceCommandIn(tx, who.executorId, data);
          await tx.executionCommand.create({ data });
        }
      });
      resolve(interaction);
    }, guard);
    const controller = new AbortController(), entry: LiveQuestion = { who, input, requestId: null, reply: null, controller, channel };
    this.entries.set(key, entry);
    // HTTP disconnect only loses its receipt; the original live question remains bounded by its deadline.
    if (signal.aborted) controller.abort();
    void channel.events.question(input.value, controller.signal).then((answer: ProviderAnswer) => {
      if (entry.requestId) entry.reply = { target: input.target, questionKey: input.questionKey, requestId: entry.requestId, state: "answer", answer };
    }).catch(error => {
      if (entry.requestId) entry.reply = { target: input.target, questionKey: input.questionKey, requestId: entry.requestId, state: "interrupted" };
      else this.entries.delete(key);
      reject(error);
    });
    const interaction = await registered; entry.requestId = interaction.id;
    return { target: input.target, questionKey: input.questionKey, requestId: interaction.id, state: "pending" };
  }
  replies(who: ExecutorPrincipal) {
    return [...this.entries.values()].filter(entry => entry.who.executorId === who.executorId && entry.who.generation === who.generation && entry.who.incarnation === who.incarnation).flatMap(entry => entry.reply ? [entry.reply] : []);
  }
  consumed(who: ExecutorPrincipal, replies: ExecutorResponses["poll"]["questions"]) {
    for (const [key, entry] of this.entries) if (entry.who.executorId === who.executorId && replies.some(reply => reply.requestId === entry.requestId)) this.entries.delete(key);
  }
  interrupt(runId: string) {
    for (const [key, entry] of this.entries) if (entry.input.target.runId === runId) { entry.controller.abort(); this.entries.delete(key); }
  }
  async close(runId: string) {
    for (const [key, entry] of this.entries) if (entry.input.target.runId === runId) { entry.controller.abort(); await entry.channel.close(); this.entries.delete(key); }
  }
}

/** Runtime installs this relay for an already claimed device Run; no launch or claim occurs here. */
export function createExecutorProvider() {
  const completions = new Map<string, (value: Awaited<ReturnType<ProviderAdapter["start"]>["done"]>) => void>();
  const provider: ProviderAdapter = { name: "fixed-device", async health() { return { available: true, sandboxed: false, error: null }; }, start(input) {
    let settle!: (value: Awaited<ReturnType<ProviderAdapter["start"]>["done"]>) => void;
    const done = new Promise<Awaited<ReturnType<ProviderAdapter["start"]>["done"]>>(resolve => { settle = resolve; });
    if (completions.has(input.runId)) throw new CallError("conflict", "Device Run already live");
    completions.set(input.runId, settle);
    return { done, async abort() {}, async inject() { throw new CallError("forbidden", "Use the durable execution command control path"); } };
  } };
  return { provider, complete(runId: string, outcome: Awaited<ReturnType<ProviderAdapter["start"]>["done"]>) { completions.get(runId)?.(outcome); completions.delete(runId); } };
}

function questionCaller(a: { moduleId: string | null; callerHash: string | null }): ExecutionPrincipal["caller"] { return a.moduleId ? { kind: "module", moduleId: a.moduleId, hash: a.callerHash! } : { kind: "owner" }; }
