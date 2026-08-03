import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  aiFeatureSubjectSchema,
  createAiJsonObjectSchema,
  type AiFeatureRunStatus,
  type AiFeatureManifest,
} from "@chrona/contracts/ai-feature-runtime";
import {
  defineAiFeature,
  executeAiFeatureRunById,
  startOrAttachAiFeatureRun,
  runAiFeature,
  stableJsonHash,
  stableJsonStringify,
  type AiFeatureCommitContext,
  type AiFeatureProviderPort,
  type AiFeatureProviderStart,
  type AiFeatureRunActionRecord,
  type AiFeatureRunRecord,
  type AiFeatureRunRepositoryPort,
} from "@/modules/ai";


const at = "2026-03-15T12:00:00.000Z";
const inputSchema = createAiJsonObjectSchema({ topic: z.string().min(1) });
const outputSchema = createAiJsonObjectSchema({ answer: z.string().min(1) });
const baseManifest: Omit<AiFeatureManifest, "actions"> = {
  schemaVersion: 1,
  feature: { id: "test.feature", version: 1 },
  description: "A fake-port feature for runtime tests.",
  input: { id: "test.feature.input", version: 1 },
  observations: [{ observation: { id: "test.context", version: 1 }, delivery: { kind: "seed" as const }, required: true }],
  artifacts: [],
  output: { id: "test.feature.output", version: 1 },
  completion: { id: "test.feature.completion", version: 1 },
  supportedTerminalStatuses: ["completed" as const, "needs_input" as const, "cannot_complete" as const],
};

function observation(observationId: string, data: Record<string, string>, typeId = "test.context") {
  return {
    observationId,
    type: { id: typeId, version: 1 },
    key: observationId,
    revision: "r1",
    observedAt: at,
    canonicalizerId: "chrona.stable-json.v1",
    hashAlgorithm: "sha256" as const,
    contentHash: stableJsonHash(data),
    data,
  };
}

function testFeature(options: { invoke?: boolean; executionSemantics?: "domain_idempotent" | "at_most_once"; commit?: (context: AiFeatureCommitContext<{ answer: string }>) => Promise<{ commitReference?: Record<string, string> } | void> | { commitReference?: Record<string, string> } | void } = {}) {
  const action = { id: "test.apply", version: 1 };
  return defineAiFeature({
    manifest: { ...baseManifest, observations: options.invoke ? [...baseManifest.observations, { observation: { id: "test.action_result", version: 1 }, delivery: { kind: "action_result" as const, fromAction: action }, required: false }] : baseManifest.observations, actions: options.invoke ? [{ action, mode: "invoke" as const, executionSemantics: options.executionSemantics ?? "domain_idempotent" }] : [{ action, mode: "propose" as const }] },
    providerBindingFeature: "test.feature",
    inputSchema,
    outputSchema,
    subjectSchema: aiFeatureSubjectSchema,
    resolveSubject: ({ subject }) => subject,
    buildObjective: (input) => ({ statement: `Answer ${input.topic}`, expectedOutcome: "A checked answer", successCriteria: ["Returns an answer"], constraints: [] }),
    buildInstructions: ({ objective }) => objective.statement,
    observations: [{ binding: baseManifest.observations[0], build: () => observation("observation-1", { source: "fake" }) }],
    actions: [{
      binding: options.invoke ? { action, mode: "invoke", executionSemantics: options.executionSemantics ?? "domain_idempotent" } : { action, mode: "propose" },
      execute: options.invoke ? async ({ featureInput, actionInput }) => observation("action-observation-1", { outcome: `${featureInput.topic}:${actionInput.topic}` }, "test.action_result") : undefined,
      inputSchema: options.invoke ? createAiJsonObjectSchema({ topic: z.string().min(1) }) : undefined,
    }],
    validateCompletion: () => ({ valid: true, validator: { id: "test.feature.completion", version: 1 }, issues: [] }),
    commitResult: options.commit ? async (context) => options.commit!(context) : undefined,
  });
}

function fakeRuns(): AiFeatureRunRepositoryPort & {
  records: Map<string, AiFeatureRunRecord>;
  actions: Map<string, AiFeatureRunActionRecord>;
  transitions: AiFeatureRunStatus[];
  claims: string[];
  renewals: string[];
  releases: string[];
} {
  const records = new Map<string, AiFeatureRunRecord>();
  const actions = new Map<string, AiFeatureRunActionRecord>();
  const transitions: AiFeatureRunStatus[] = [];
  const mutate = (current: AiFeatureRunRecord, changes: Partial<AiFeatureRunRecord>) => {
    const next = { ...current, ...changes, stateVersion: current.stateVersion + 1, updatedAt: at };
    records.set(next.id, next);
    return next;
  };
  return {
    records, actions, transitions, claims: [], renewals: [], releases: [],
    async createOrRead(input) {
      const existing = [...records.values()].find((record) => record.workspaceId === input.workspaceId && record.feature.id === input.feature.id && record.feature.version === input.feature.version && record.subject.type === input.subject.type && record.subject.id === input.subject.id && record.operation.kind === input.operation.kind && record.operation.operationId === input.operation.operationId);
      if (existing) return { kind: "existing", run: existing };
      const run: AiFeatureRunRecord = { ...input, status: "queued", stateVersion: 0, attempt: 0, observations: [], proposedActions: [], createdAt: at, updatedAt: at };
      records.set(run.id, run);
      return { kind: "created", run };
    },
    async getById(runId) { return records.get(runId) ?? null; },
    async claim(input) {
      const current = records.get(input.runId);
      if (!current || current.stateVersion !== input.expectedStateVersion || (current.leaseOwner && current.leaseOwner !== input.leaseOwner)) return null;
      this.claims.push(input.leaseOwner);
      return mutate(current, { leaseOwner: input.leaseOwner, leaseExpiresAt: input.leaseExpiresAt });
    },
    async heartbeatLease(input) {
      const current = records.get(input.runId);
      if (!current || current.leaseOwner !== input.leaseOwner) return null;
      this.renewals.push(input.leaseOwner);
      const next = { ...current, leaseExpiresAt: input.leaseExpiresAt, updatedAt: input.now };
      records.set(next.id, next);
      return next;
    },
    async releaseLease(input) {
      const current = records.get(input.runId);
      if (!current || current.stateVersion !== input.expectedStateVersion || current.leaseOwner !== input.leaseOwner) return null;
      this.releases.push(input.leaseOwner);
      return mutate(current, { leaseOwner: undefined, leaseExpiresAt: undefined });
    },
    async update(input) {
      const current = records.get(input.runId);
      if (!current || current.stateVersion !== input.expectedStateVersion || (input.leaseOwner && current.leaseOwner !== input.leaseOwner)) return null;
      const { runId: _runId, expectedStateVersion: _version, leaseOwner: _owner, ...changes } = input;
      const updated = mutate(current, changes);
      transitions.push(updated.status);
      return updated;
    },
    async claimAction(input) {
      const run = records.get(input.runId);
      const existing = actions.get(input.executionKey);
      if (!run || run.stateVersion !== input.expectedRunStateVersion || run.leaseOwner !== input.leaseOwner) return null;
      if (existing) {
        if (existing.status === "executing" && existing.leaseExpiresAt! <= input.now) {
          if (input.executionSemantics === "at_most_once" || existing.attempt >= 2) {
            const outcomeUnknown = { ...existing, status: "outcome_unknown" as const, error: { code: "action_outcome_unknown" as const, message: "reconciliation required" } };
            actions.set(existing.executionKey, outcomeUnknown);
            return { kind: "outcome_unknown" as const, action: outcomeUnknown };
          }
          const reclaimed = { ...existing, attempt: existing.attempt + 1, leaseOwner: input.leaseOwner, leaseExpiresAt: input.leaseExpiresAt };
          actions.set(existing.executionKey, reclaimed);
          return { kind: "claimed" as const, action: reclaimed };
        }
        return { kind: "existing" as const, action: existing };
      }
      const count = [...actions.values()].filter((candidate) => candidate.runId === input.runId && candidate.action.id === input.action.id).length;
      if (input.maxCalls !== undefined && count >= input.maxCalls) return null;
      const action = { ...input, status: "executing" as const, attempt: 1 };
      actions.set(action.executionKey, action);
      return { kind: "claimed" as const, action };
    },
    async completeAction(input) {
      const action = [...actions.values()].find((candidate) => candidate.id === input.actionId && candidate.executionKey === input.executionKey);
      if (!action) return null;
      const run = records.get(action.runId);
      if (!run || run.stateVersion !== input.expectedRunStateVersion || run.leaseOwner !== input.leaseOwner) return null;
      const completed = { ...action, status: "completed" as const, outputObservation: input.outputObservation };
      actions.set(completed.executionKey, completed);
      const updatedRun = mutate(run, { observations: [...run.observations, input.outputObservation] });
      return { action: completed, run: updatedRun };
    },
    async failAction(input) {
      const action = [...actions.values()].find((candidate) => candidate.id === input.actionId && candidate.executionKey === input.executionKey);
      if (!action) return null;
      const failed = { ...action, status: "failed" as const, error: input.error };
      actions.set(failed.executionKey, failed);
      return failed;
    },
  };
}

const request = (definition = testFeature()) => ({ workspaceId: "workspace-1", definition, subject: { type: "test.subject", id: "subject-1", revision: "r1" }, operation: { kind: "generate", operationId: "operation-1" }, input: { topic: "the subject" } });
const terminal = () => ({ kind: "terminal" as const, candidate: { status: "completed", output: { answer: "Done" }, artifacts: [], proposedActions: [], evidence: [{ observationId: "observation-1" }] } });
const durableProvider = (turns: (() => { kind: "terminal"; candidate: unknown } | { kind: "invoke_action"; action: { id: string; version: number }; callId: string; input: { topic: string } })[]): AiFeatureProviderPort & { starts: number; resumes: number; submitted: number } => ({
  capabilities: { supportsClientOperationId: true, supportsResume: true, actionInvocation: "engine_managed" },
  starts: 0, resumes: 0, submitted: 0,
  async startOrAttach() { const turn = turns.shift(); if (!turn) throw new Error("No fake provider turn."); this.starts += 1; return { ...turn(), providerRunRef: "provider-run-1", providerResumeRef: "resume-1" }; },
  async resume() { const turn = turns.shift(); if (!turn) throw new Error("No fake provider turn."); this.resumes += 1; return turn(); },
  async submitActionResult() { const turn = turns.shift(); if (!turn) throw new Error("No fake provider turn."); this.submitted += 1; return turn(); },
});

function manualHeartbeatScheduler() {
  const callbacks: (() => void)[] = [];
  return {
    scheduler: { schedule: (_delayMs: number, callback: () => void) => { callbacks.push(callback); return () => {}; } },
    fire() { callbacks.shift()?.(); },
  };
}

describe("runAiFeature durable lifecycle", () => {
  it("claims, renews, and releases an active lease around an idempotent provider start", async () => {
    const runs = fakeRuns();
    const provider = durableProvider([terminal]);
    const result = await runAiFeature(request(), { runs, provider, clock: () => new Date(at), ids: { next: () => "run-1" } });
    expect(result.status).toBe("completed");
    expect(runs.claims).toHaveLength(1);
    expect(runs.renewals.length).toBeGreaterThan(0);
    expect(runs.releases).toEqual(runs.claims);
    expect(provider.starts).toBe(1);
  });

  it("starts or attaches a validated durable run before any provider call", async () => {
    const runs = fakeRuns();
    const definition = testFeature();
    const run = await startOrAttachAiFeatureRun(request(definition), { runs, ids: { next: () => "run-1" } });
    expect(run).toMatchObject({ id: "run-1", status: "queued", workspaceId: "workspace-1" });
    expect(runs.claims).toEqual([]);
    const result = await executeAiFeatureRunById({ definition, runId: run.id }, { runs, provider: durableProvider([terminal]), clock: () => new Date(at), ids: { next: () => "lease-1" } });
    expect(result.status).toBe("completed");
  });

  it("rejects unbounded operation identities before creating a run", async () => {
    const runs = fakeRuns();
    await expect(startOrAttachAiFeatureRun({ ...request(), operation: { kind: "generate", operationId: " " } }, { runs, ids: { next: () => "run-1" } })).rejects.toMatchObject({ detail: { code: "input_invalid" } });
    expect(runs.records).toHaveLength(0);
  });

  it("does not fall back to an unsafe provider run call when start outcome is unknown", async () => {
    const runs = fakeRuns();
    const provider: AiFeatureProviderPort = {
      capabilities: { supportsClientOperationId: true, supportsResume: true, actionInvocation: "engine_managed" },
      async startOrAttach() { throw new Error("connection closed"); },
      async resume() { throw new Error("unreachable"); },
      async submitActionResult() { throw new Error("unreachable"); },
    };
    const result = await runAiFeature(request(), { runs, provider, clock: () => new Date(at), ids: { next: () => "run-1" } });
    expect(result.status).toBe("starting_provider");
    expect(runs.records.get("run-1")?.providerRunRef).toBeUndefined();
  });

  it("persists the action observation before submitting it and never reexecutes it after recovery", async () => {
    let executions = 0;
    const definition = testFeature({ invoke: true });
    definition.actions[0].execute = async ({ featureInput, actionInput }) => {
      expect(featureInput).toEqual({ topic: "the subject" });
      expect(actionInput).toEqual({ topic: "apply" });
      executions += 1;
      return observation("action-observation-1", { outcome: "applied" }, "test.action_result");
    };
    const runs = fakeRuns();
    const provider = durableProvider([
      () => ({ kind: "invoke_action", action: { id: "test.apply", version: 1 }, callId: "call-1", input: { topic: "apply" } }),
      () => ({ kind: "invoke_action", action: { id: "test.apply", version: 1 }, callId: "call-1", input: { topic: "apply" } }),
      terminal,
    ]);
    let submitted = 0;
    provider.submitActionResult = async (input) => {
      submitted += 1;
      expect(runs.records.get("run-1")?.observations.map(({ observationId }) => observationId)).toContain(input.outputObservation.observationId);
      if (submitted === 1) throw new Error("lost acknowledgement");
      return terminal();
    };
    const ports = { runs, provider, clock: () => new Date(at), ids: { next: () => "run-1" } };
    expect((await runAiFeature(request(definition), ports)).status).toBe("running");
    expect((await runAiFeature(request(definition), ports)).status).toBe("completed");
    expect(executions).toBe(1);
    expect(submitted).toBe(2);
  });

  it("rejects a non-canonical invoke observation before persistence or provider submission", async () => {
    const runs = fakeRuns();
    const definition = testFeature({ invoke: true });
    definition.actions[0].execute = async () => ({
      ...observation("action-observation-1", { outcome: "applied" }, "test.action_result"),
      canonicalizerId: "untrusted.canonicalizer",
    });
    const provider = durableProvider([
      () => ({ kind: "invoke_action", action: { id: "test.apply", version: 1 }, callId: "call-1", input: { topic: "apply" } }),
    ]);

    const result = await runAiFeature(request(definition), { runs, provider, clock: () => new Date(at), ids: { next: () => "run-1" } });

    expect(result.status).toBe("failed");
    expect(provider.submitted).toBe(0);
    expect(runs.actions.get("run-1:invoke:call-1")?.status).toBe("failed");
  });

  it("accepts only an authoritative atomic committer terminal state", async () => {
    const runs = fakeRuns();
    let context: AiFeatureCommitContext<{ answer: string }> | undefined;
    const definition = testFeature({ commit: async (received) => {
      context = received;
      const commitReference = { receipt: "commit-1" };
      await runs.update({ runId: received.runId, expectedStateVersion: received.expectedStateVersion, leaseOwner: received.leaseOwner, status: received.terminal.result.status, result: received.terminal.result, completion: received.terminal.completion, proposedActions: received.terminal.proposedActions, commitReference, finishedAt: received.terminal.finishedAt });
      return { commitReference };
    } });
    const result = await runAiFeature(request(definition), { runs, provider: durableProvider([terminal]), clock: () => new Date(at), ids: { next: () => "run-1" } });
    expect(context).toMatchObject({ runId: "run-1", leaseOwner: "feature-runner:run-1", leaseExpiresAt: "2026-03-15T12:00:30.000Z", terminal: { result: { status: "completed", output: { answer: "Done" } }, completion: { valid: true }, proposedActions: [], finishedAt: at } });
    expect(context?.expectedStateVersion).toBeGreaterThan(0);
    expect(runs.transitions.filter((status) => status === "completed")).toHaveLength(1);
    expect(result.status).toBe("completed");
    expect(result.commitReference).toEqual({ receipt: "commit-1" });
    expect(result.leaseOwner).toBeUndefined();
    expect(result.stateVersion).toBe(runs.records.get("run-1")!.stateVersion);
  });



  it("rejects atomic terminal records whose payload fields do not exactly match", async () => {
    const runs = fakeRuns();
    const definition = testFeature({ commit: async (received) => {
      const persistedReference = { receipt: "persisted" };
      await runs.update({
        runId: received.runId,
        expectedStateVersion: received.expectedStateVersion,
        leaseOwner: received.leaseOwner,
        status: received.terminal.result.status,
        result: received.terminal.result,
        completion: received.terminal.completion,
        proposedActions: [{
          proposalId: "mismatched-proposal",
          action: { id: "test.apply", version: 1 },
          input: { topic: "mismatch" },
          rationale: "Mismatched persisted proposal",
          evidence: [],
        }],
        commitReference: persistedReference,
        finishedAt: "2026-03-15T12:00:01.000Z",
      });
      return { commitReference: { receipt: "returned" } };
    } });

    await expect(runAiFeature(request(definition), {
      runs,
      provider: durableProvider([terminal]),
      clock: () => new Date(at),
      ids: { next: () => "run-mismatched-terminal" },
    })).rejects.toMatchObject({ detail: { code: "internal_error" } });
  });

  it("rejects an atomic terminal commit that advances more than one state version", async () => {
    const runs = fakeRuns();
    const definition = testFeature({ commit: async (received) => {
      const commitReference = { receipt: "commit-version-jump" };
      const first = await runs.update({
        runId: received.runId,
        expectedStateVersion: received.expectedStateVersion,
        leaseOwner: received.leaseOwner,
        status: received.terminal.result.status,
        result: received.terminal.result,
        completion: received.terminal.completion,
        proposedActions: received.terminal.proposedActions,
        commitReference,
        finishedAt: received.terminal.finishedAt,
      });
      if (!first) throw new Error("Expected first terminal update");
      await runs.update({
        runId: received.runId,
        expectedStateVersion: first.stateVersion,
        leaseOwner: received.leaseOwner,
        status: received.terminal.result.status,
      });
      return { commitReference };
    } });

    await expect(runAiFeature(request(definition), {
      runs,
      provider: durableProvider([terminal]),
      clock: () => new Date(at),
      ids: { next: () => "run-version-jump" },
    })).rejects.toMatchObject({ detail: { code: "internal_error" } });
  });

  it("rejects an undeclared commit reference when the committer returns void", async () => {
    const runs = fakeRuns();
    const definition = testFeature({ commit: async (received) => {
      await runs.update({
        runId: received.runId,
        expectedStateVersion: received.expectedStateVersion,
        leaseOwner: received.leaseOwner,
        status: received.terminal.result.status,
        result: received.terminal.result,
        completion: received.terminal.completion,
        proposedActions: received.terminal.proposedActions,
        commitReference: { receipt: "undeclared" },
        finishedAt: received.terminal.finishedAt,
      });
    } });

    await expect(runAiFeature(request(definition), {
      runs,
      provider: durableProvider([terminal]),
      clock: () => new Date(at),
      ids: { next: () => "run-undeclared-reference" },
    })).rejects.toMatchObject({ detail: { code: "internal_error" } });
  });
  it("re-reads durable state after an ambiguous provider start before returning", async () => {
    const runs = fakeRuns();
    const provider: AiFeatureProviderPort = {
      capabilities: { supportsClientOperationId: true, supportsResume: true, actionInvocation: "engine_managed" },
      async startOrAttach() { throw new Error("connection closed"); },
      async resume() { throw new Error("unreachable"); },
      async submitActionResult() { throw new Error("unreachable"); },
    };
    const result = await runAiFeature(request(), { runs, provider, clock: () => new Date(at), ids: { next: () => "run-1" } });
    expect(result.status).toBe("starting_provider");
    expect(result.leaseOwner).toBeUndefined();
    expect(result.stateVersion).toBe(runs.records.get("run-1")!.stateVersion);
  });
});

describe("feature runtime lease fencing and recovery", () => {
  it("heartbeats a provider call that spans its lease TTL", async () => {
    const runs = fakeRuns();
    const pending = Promise.withResolvers<AiFeatureProviderStart>();
    const heartbeat = manualHeartbeatScheduler();
    const provider = durableProvider([]);
    provider.startOrAttach = async () => pending.promise;
    const execution = runAiFeature(request(), { runs, provider, clock: () => new Date(at), ids: { next: () => "run-heartbeat" }, leaseTtlMs: 3, heartbeatScheduler: heartbeat.scheduler });
    await Promise.resolve();
    heartbeat.fire();
    await Promise.resolve();
    pending.resolve({ ...terminal(), providerRunRef: "provider-run-1", providerResumeRef: "resume-1" });
    expect((await execution).status).toBe("completed");
    expect(runs.renewals.length).toBeGreaterThan(0);
  });

  it("fences stale provider completion after heartbeat loss", async () => {
    const runs = fakeRuns();
    const pending = Promise.withResolvers<AiFeatureProviderStart>();
    const heartbeat = manualHeartbeatScheduler();
    const provider = durableProvider([]);
    provider.startOrAttach = async () => pending.promise;
    runs.heartbeatLease = async () => null;
    const execution = runAiFeature(request(), { runs, provider, clock: () => new Date(at), ids: { next: () => "run-fenced" }, leaseTtlMs: 3, heartbeatScheduler: heartbeat.scheduler });
    await Promise.resolve();
    heartbeat.fire();
    await Promise.resolve();
    pending.resolve({ ...terminal(), providerRunRef: "provider-run-1", providerResumeRef: "resume-1" });
    expect((await execution).status).toBe("starting_provider");
    expect(runs.records.get("run-fenced")?.terminalCandidate).toBeUndefined();
  });

  it("reclaims one expired replayable action after a crash", async () => {
    const definition = testFeature({ invoke: true });
    const runs = fakeRuns();
    const run = await startOrAttachAiFeatureRun(request(definition), { runs, ids: { next: () => "run-reclaim" } });
    const owner = "crashed-worker";
    const claimed = await runs.claim({ runId: run.id, expectedStateVersion: run.stateVersion, leaseOwner: owner, leaseExpiresAt: "2026-03-15T12:00:01.000Z", now: at });
    const seeded = await runs.update({ runId: claimed!.id, expectedStateVersion: claimed!.stateVersion, leaseOwner: owner, status: "running", providerRunRef: "provider-run-1", providerResumeRef: "resume-1", observations: [observation("observation-1", { source: "fake" })] });
    await runs.claimAction({ id: "run-reclaim:action:call-1", runId: seeded!.id, callId: "call-1", executionKey: "run-reclaim:invoke:call-1", action: { id: "test.apply", version: 1 }, input: { topic: "apply" }, inputHash: stableJsonHash({ topic: "apply" }), executionSemantics: "domain_idempotent", expectedRunStateVersion: seeded!.stateVersion, leaseOwner: owner, leaseExpiresAt: "2026-03-15T12:00:01.000Z", now: at });
    runs.records.set(seeded!.id, { ...seeded!, leaseOwner: undefined, leaseExpiresAt: undefined });
    const result = await executeAiFeatureRunById({ definition, runId: run.id }, { runs, provider: durableProvider([() => ({ kind: "invoke_action", action: { id: "test.apply", version: 1 }, callId: "call-1", input: { topic: "apply" } }), terminal]), clock: () => new Date("2026-03-15T12:00:02.000Z"), ids: { next: () => "reclaimer" } });
    expect(result.status).toBe("completed");
    expect(runs.actions.get("run-reclaim:invoke:call-1")?.attempt).toBe(2);
  });

  it("records expired at-most-once action ambiguity instead of replaying it", async () => {
    const definition = testFeature({ invoke: true, executionSemantics: "at_most_once" });
    const runs = fakeRuns();
    const run = await startOrAttachAiFeatureRun(request(definition), { runs, ids: { next: () => "run-unknown" } });
    const owner = "crashed-worker";
    const claimed = await runs.claim({ runId: run.id, expectedStateVersion: run.stateVersion, leaseOwner: owner, leaseExpiresAt: "2026-03-15T12:00:01.000Z", now: at });
    const seeded = await runs.update({ runId: claimed!.id, expectedStateVersion: claimed!.stateVersion, leaseOwner: owner, status: "running", providerRunRef: "provider-run-1", providerResumeRef: "resume-1", observations: [observation("observation-1", { source: "fake" })] });
    await runs.claimAction({ id: "run-unknown:action:call-1", runId: seeded!.id, callId: "call-1", executionKey: "run-unknown:invoke:call-1", action: { id: "test.apply", version: 1 }, input: { topic: "apply" }, inputHash: stableJsonHash({ topic: "apply" }), executionSemantics: "at_most_once", expectedRunStateVersion: seeded!.stateVersion, leaseOwner: owner, leaseExpiresAt: "2026-03-15T12:00:01.000Z", now: at });
    runs.records.set(seeded!.id, { ...seeded!, leaseOwner: undefined, leaseExpiresAt: undefined });
    const result = await executeAiFeatureRunById({ definition, runId: run.id }, { runs, provider: durableProvider([() => ({ kind: "invoke_action", action: { id: "test.apply", version: 1 }, callId: "call-1", input: { topic: "apply" } })]), clock: () => new Date("2026-03-15T12:00:02.000Z"), ids: { next: () => "reclaimer" } });
    expect(result.status).toBe("running");
    expect(runs.actions.get("run-unknown:invoke:call-1")?.status).toBe("outcome_unknown");
  });

  it("rejects oversized and deep terminal candidates before terminalCandidate persistence", async () => {
    const deepCandidate: Record<string, unknown> = {};
    let cursor = deepCandidate;
    for (let depth = 0; depth < 17; depth += 1) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    for (const [index, candidate] of [{ value: "x".repeat(16_001) }, deepCandidate].entries()) {
      const runs = fakeRuns();
      const provider = durableProvider([() => ({ kind: "terminal" as const, candidate })]);
      const result = await runAiFeature(request(), { runs, provider, clock: () => new Date(at), ids: { next: () => `run-bounded-${index}` } });
      expect(result.status).toBe("failed");
      expect([...runs.records.values()][0]?.terminalCandidate).toBeUndefined();
    }
  });
});


describe("feature runtime invariants", () => {
  it("uses canonical stable JSON regardless of object insertion order", () => {
    expect(stableJsonStringify({ b: 2, a: { z: 1, c: 3 } })).toBe(stableJsonStringify({ a: { c: 3, z: 1 }, b: 2 }));
    expect(stableJsonHash({ b: 2, a: 1 })).toBe(stableJsonHash({ a: 1, b: 2 }));
  });
});
