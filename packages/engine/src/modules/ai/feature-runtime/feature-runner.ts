/* eslint-disable max-lines-per-function, max-statements, complexity, @typescript-eslint/no-unnecessary-condition -- Durable feature execution keeps lease and outcome authority in one auditable flow. */
import { randomUUID } from "node:crypto";
import type {
  AiFeatureRuntimeError as AiFeatureRuntimeErrorDetail,
  AiFeatureRunStatus,
  AiJsonObject,
  AiRunResult,
  CompletionValidation,
  ProposedAction,
} from "@chrona/contracts/ai-feature-runtime";
import { aiFeatureOperationSchema, aiFeatureSubjectSchema, aiJsonObjectSchema, aiObjectiveSchema, aiRuntimeIdSchema, isBoundedAiJsonObject } from "@chrona/contracts/ai-feature-runtime";
import type { AiFeatureDefinition } from "./define-feature";
import { compileAiFeatureRequest, type AiFeatureProviderPort, type AiFeatureProviderTurn } from "./feature-compiler";
import { buildSeedObservations } from "./observation-registry";
import type { AiFeatureActionExecutionPort, AiFeatureRunRecord, AiFeatureRunRepositoryPort } from "./run-repository";
import { executeAiFeatureAction, type AiFeatureLeaseGuard } from "./action-execution";
import { validateAiFeatureResult } from "./result-validator";
import { freezeCanonical, stableJsonHash } from "./stable-json";
import { validateProviderCapabilities } from "./provider-capabilities";

const DEFAULT_LEASE_MS = 30_000;
export type AiFeatureLeaseHeartbeatScheduler = {
  schedule(delayMs: number, callback: () => void): () => void;
};

const platformHeartbeatScheduler: AiFeatureLeaseHeartbeatScheduler = {
  schedule(delayMs, callback) {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
};

const MIN_HEARTBEAT_MS = 1;

export class AiFeatureRuntimeError extends Error {
  constructor(public readonly detail: AiFeatureRuntimeErrorDetail) {
    super(detail.message);
    this.name = "AiFeatureRuntimeError";
  }
}

export type AiFeatureRunnerPorts = {
  runs: AiFeatureRunRepositoryPort;
  provider: AiFeatureProviderPort;
  actionExecutor?: AiFeatureActionExecutionPort;
  clock?: () => Date;
  ids?: { next(): string };
  leaseTtlMs?: number;
  heartbeatScheduler?: AiFeatureLeaseHeartbeatScheduler;
};

export type RunAiFeatureInput = {
  workspaceId: string;
  definition: AiFeatureDefinition;
  subject: unknown;
  operation: { kind: string; operationId: string };
  input: unknown;
};
export type ExecuteAiFeatureRunByIdInput = {
  definition: AiFeatureDefinition;
  runId: string;
};

function now(clock: (() => Date) | undefined): string {
  return (clock?.() ?? new Date()).toISOString();
}

function leaseExpiry(clock: (() => Date) | undefined, ttlMs: number): string {
  return new Date((clock?.() ?? new Date()).getTime() + ttlMs).toISOString();
}

function runtimeError(code: AiFeatureRuntimeErrorDetail["code"], message: string): AiFeatureRuntimeErrorDetail {
  return { code, message };
}

function isTerminal(status: AiFeatureRunStatus): boolean {
  return status === "completed" || status === "needs_input" || status === "cannot_complete" || status === "failed" || status === "cancelled";
}

function sameRunIdentity(run: AiFeatureRunRecord, input: RunAiFeatureInput, subject: { type: string; id: string }): boolean {
  return run.workspaceId === input.workspaceId
    && run.feature.id === input.definition.manifest.feature.id
    && run.feature.version === input.definition.manifest.feature.version
    && run.subject.type === subject.type && run.subject.id === subject.id
    && run.operation.kind === input.operation.kind && run.operation.operationId === input.operation.operationId;
}

async function transition(
  runs: AiFeatureRunRepositoryPort,
  run: AiFeatureRunRecord,
  leaseOwner: string,
  status: AiFeatureRunStatus,
  changes: Omit<Parameters<AiFeatureRunRepositoryPort["update"]>[0], "runId" | "expectedStateVersion" | "status" | "leaseOwner"> = {},
): Promise<AiFeatureRunRecord> {
  const updated = await runs.update({ runId: run.id, expectedStateVersion: run.stateVersion, leaseOwner, status, ...changes });
  if (!updated) throw new AiFeatureRuntimeError(runtimeError("internal_error", "Feature run state changed or its lease was lost."));
  return updated;
}

async function fail(runs: AiFeatureRunRepositoryPort, run: AiFeatureRunRecord, leaseOwner: string, error: AiFeatureRuntimeErrorDetail, clock?: () => Date): Promise<AiFeatureRunRecord> {
  return transition(runs, run, leaseOwner, "failed", { error, finishedAt: now(clock) });
}

/** Validates, resolves, freezes, and durably creates or reads a queued feature run without calling a provider. */
export async function startOrAttachAiFeatureRun(input: RunAiFeatureInput, ports: Pick<AiFeatureRunnerPorts, "runs" | "ids">): Promise<AiFeatureRunRecord> {
  const parsedInput = input.definition.inputSchema.safeParse(input.input);
  if (!parsedInput.success) throw new AiFeatureRuntimeError(runtimeError("input_invalid", "Feature input does not satisfy its contract."));
  const parsedSubject = input.definition.subjectSchema.safeParse(input.subject);
  if (!parsedSubject.success) throw new AiFeatureRuntimeError(runtimeError("subject_invalid", "Feature subject does not satisfy its contract."));
  const workspaceId = aiRuntimeIdSchema.safeParse(input.workspaceId);
  if (!workspaceId.success) throw new AiFeatureRuntimeError(runtimeError("input_invalid", "Workspace identifier is invalid."));
  const operation = aiFeatureOperationSchema.safeParse(input.operation);
  if (!operation.success) throw new AiFeatureRuntimeError(runtimeError("input_invalid", "Feature operation identity is invalid."));
  const subject = aiFeatureSubjectSchema.parse(await input.definition.resolveSubject({ workspaceId: workspaceId.data, subject: parsedSubject.data, input: parsedInput.data }));
  const manifest = freezeCanonical(input.definition.manifest);
  const runId = aiRuntimeIdSchema.safeParse(ports.ids?.next() ?? randomUUID());
  if (!runId.success) throw new AiFeatureRuntimeError(runtimeError("input_invalid", "Feature run identifier is invalid."));
  const runInput = {
    id: runId.data, workspaceId: workspaceId.data, feature: manifest.feature, manifest,
    manifestHash: stableJsonHash(manifest), subject, operation: operation.data, input: freezeCanonical(parsedInput.data),
    inputHash: stableJsonHash(parsedInput.data), objective: freezeCanonical(aiObjectiveSchema.parse(input.definition.buildObjective(parsedInput.data))),
  };
  const created = await ports.runs.createOrRead(runInput);
  if (created.kind === "existing" && (!sameRunIdentity(created.run, { ...input, workspaceId: workspaceId.data, operation: operation.data }, subject) || created.run.inputHash !== runInput.inputHash || created.run.manifestHash !== runInput.manifestHash)) {
    throw new AiFeatureRuntimeError(runtimeError("idempotency_conflict", "Operation identity was already used with different frozen input or feature state."));
  }
  return created.run;
}

/** Lease-claims and drives an already persisted feature run. */
export async function executeAiFeatureRunById(input: ExecuteAiFeatureRunByIdInput, ports: AiFeatureRunnerPorts): Promise<AiFeatureRunRecord> {
  const runId = aiRuntimeIdSchema.safeParse(input.runId);
  if (!runId.success) throw new AiFeatureRuntimeError(runtimeError("input_invalid", "Feature run identifier is invalid."));
  const persisted = await ports.runs.getById(runId.data);
  if (!persisted) throw new AiFeatureRuntimeError(runtimeError("internal_error", "Feature run was not found."));
  let run: AiFeatureRunRecord = persisted;
  const executionInput: RunAiFeatureInput = { workspaceId: run.workspaceId, definition: input.definition, subject: run.subject, operation: run.operation, input: run.input };
  if (run.feature.id !== input.definition.manifest.feature.id || run.feature.version !== input.definition.manifest.feature.version || run.manifestHash !== stableJsonHash(freezeCanonical(input.definition.manifest))) {
    throw new AiFeatureRuntimeError(runtimeError("idempotency_conflict", "Feature run does not match the supplied feature definition."));
  }
  if (isTerminal(run.status)) return run;

  const leaseOwner = `feature-runner:${ports.ids?.next() ?? randomUUID()}`;
  const leaseTtlMs = ports.leaseTtlMs ?? DEFAULT_LEASE_MS;
  const claimed = await ports.runs.claim({ runId: run.id, expectedStateVersion: run.stateVersion, leaseOwner, leaseExpiresAt: leaseExpiry(ports.clock, leaseTtlMs), now: now(ports.clock) });
  if (!claimed) return (await ports.runs.getById(run.id)) ?? run;
  run = claimed;
  let leaseHeld = true;
  let leaseLost = false;
  const releaseAndRead = async (fallback: AiFeatureRunRecord): Promise<AiFeatureRunRecord> => {
    if (leaseHeld) {
      await ports.runs.releaseLease({ runId: fallback.id, expectedStateVersion: fallback.stateVersion, leaseOwner });
      leaseHeld = false;
    }
    return (await ports.runs.getById(fallback.id)) ?? fallback;
  };
  const failAndRead = async (error: AiFeatureRuntimeErrorDetail): Promise<AiFeatureRunRecord> => releaseAndRead(await fail(ports.runs, run, leaseOwner, error, ports.clock));
  const compileProviderRequest = () => {
    const context = { workspaceId: run.workspaceId, subject: run.subject, input: run.input, objective: run.objective, observations: run.observations };
    return compileAiFeatureRequest({ definition: input.definition, manifest: run.manifest, context, instructions: input.definition.buildInstructions(context), clientOperationId: run.id });
  };
  const verifyAtomicCommit = async (expected: {
    stateVersion: number;
    result: AiRunResult;
    completion: CompletionValidation | undefined;
    proposedActions: readonly ProposedAction[];
    finishedAt: string;
    commitReference: AiJsonObject | undefined;
    verifyCommitReference?: boolean;
  }): Promise<AiFeatureRunRecord> => {
    const committed = await ports.runs.getById(run.id);
    if (!committed
      || !sameRunIdentity(committed, executionInput, run.subject)
      || committed.stateVersion !== expected.stateVersion + 1
      || committed.status !== expected.result.status
      || !committed.result
      || stableJsonHash(committed.result) !== stableJsonHash(expected.result)
      || stableJsonHash(committed.completion ?? {}) !== stableJsonHash(expected.completion ?? {})
      || stableJsonHash(committed.proposedActions) !== stableJsonHash(expected.proposedActions)
      || committed.finishedAt !== expected.finishedAt
      || (expected.verifyCommitReference !== false
        && stableJsonHash(committed.commitReference ?? null) !== stableJsonHash(expected.commitReference ?? null))) {
      throw new AiFeatureRuntimeError(runtimeError("internal_error", "Feature committer did not atomically persist the expected terminal run."));
    }
    return committed;
  };
  const renew = async (): Promise<boolean> => {
    if (leaseLost) return false;
    const renewed = await ports.runs.heartbeatLease({ runId: run.id, leaseOwner, leaseExpiresAt: leaseExpiry(ports.clock, leaseTtlMs), now: now(ports.clock) });
    if (!renewed) {
      leaseLost = true;
      return false;
    }
    run = { ...run, leaseExpiresAt: renewed.leaseExpiresAt };
    return true;
  };
  const lease: AiFeatureLeaseGuard = {
    async await<T>(operation: () => Promise<T>, options?: { confirmAfter?: boolean }): Promise<T | undefined> {
      if (!await renew()) return undefined;
      let stopped = false;
      let cancelHeartbeat = () => {};
      let renewal: Promise<void> | undefined;
      const scheduler = ports.heartbeatScheduler ?? platformHeartbeatScheduler;
      const schedule = () => {
        cancelHeartbeat = scheduler.schedule(Math.max(MIN_HEARTBEAT_MS, Math.floor(leaseTtlMs / 3)), () => {
          renewal = renew().then(() => undefined).finally(() => {
            renewal = undefined;
            if (!stopped && !leaseLost) schedule();
          });
        });
      };
      schedule();
      try {
        const outcome = await operation();
        if (renewal) await renewal;
        if (leaseLost) return undefined;
        if (options?.confirmAfter !== false && !await renew()) return undefined;
        return outcome;
      } finally {
        stopped = true;
        cancelHeartbeat();
      }
    },
    currentRun: () => leaseLost ? null : run,
  };
  const persistTurnRefs = async (turn: AiFeatureProviderTurn): Promise<void> => {
    if (turn.providerRunRef && turn.providerResumeRef && (run.providerRunRef !== turn.providerRunRef || run.providerResumeRef !== turn.providerResumeRef)) {
      run = await transition(ports.runs, run, leaseOwner, "running", { providerRunRef: turn.providerRunRef, providerResumeRef: turn.providerResumeRef });
    }
  };

  try {
    const capabilityError = validateProviderCapabilities(run.manifest, ports.provider.capabilities);
    if (capabilityError) return await failAndRead(runtimeError("provider_capability_mismatch", capabilityError));

    if (run.status === "queued") {
      run = await transition(ports.runs, run, leaseOwner, "preparing_observations");
      const built = await buildSeedObservations({ definition: input.definition, context: { workspaceId: run.workspaceId, subject: run.subject, input: run.input } });
      if (!built.ok) return await failAndRead(runtimeError(built.error.code, built.error.message));
      run = await transition(ports.runs, run, leaseOwner, "starting_provider", { observations: freezeCanonical(built.observations), startedAt: run.startedAt ?? now(ports.clock) });
    }

    let turn: AiFeatureProviderTurn;
    if (run.status === "starting_provider") {
      const started = await lease.await(() => ports.provider.startOrAttach(compileProviderRequest(), run.providerRunRef));
      if (!started) return await releaseAndRead(run);
      run = await transition(ports.runs, run, leaseOwner, "running", { providerRunRef: started.providerRunRef, providerResumeRef: started.providerResumeRef });
      turn = started;
    } else if (run.status === "running") {
      if (!run.providerRunRef || !run.providerResumeRef) return await failAndRead(runtimeError("provider_run_unrecoverable", "Provider run has no durable recovery reference."));
      const resumed = await lease.await(() => ports.provider.resume({ providerRunRef: run.providerRunRef!, providerResumeRef: run.providerResumeRef!, clientOperationId: run.id, request: compileProviderRequest() }));
      if (!resumed) return await releaseAndRead(run);
      turn = resumed;
      await persistTurnRefs(turn);
    } else if (run.status === "validating" && run.terminalCandidate !== undefined) {
      turn = { kind: "terminal", candidate: run.terminalCandidate };
    } else if (run.status === "committing_result" && run.result) {
      turn = { kind: "terminal", candidate: run.result };
    } else {
      return await failAndRead(runtimeError("provider_run_unrecoverable", "Run has no recoverable provider state."));
    }

    while (turn.kind === "invoke_action") {
      const actionTurn = turn;
      await persistTurnRefs(turn);
      if (!run.providerRunRef || !run.providerResumeRef) return await failAndRead(runtimeError("provider_run_unrecoverable", "Provider action request has no durable recovery reference."));
      const action = await executeAiFeatureAction({ definition: input.definition, runs: ports.runs, executor: ports.actionExecutor, run, leaseOwner, leaseExpiresAt: run.leaseExpiresAt ?? leaseExpiry(ports.clock, leaseTtlMs), now: now(ports.clock), lease, workspaceId: run.workspaceId, subject: run.subject, action: actionTurn.action, callId: actionTurn.callId, input: actionTurn.input, observations: run.observations });
      if (!action.ok) {
        if (action.error.code === "action_outcome_unknown") return await releaseAndRead(run);
        return await failAndRead(runtimeError(action.error.code === "action_not_allowed" ? "action_not_allowed" : action.error.code === "action_input_invalid" ? "action_input_invalid" : "internal_error", action.error.message));
      }
      run = action.run;
      const submitted = await lease.await(() => ports.provider.submitActionResult({ providerRunRef: run.providerRunRef!, providerResumeRef: run.providerResumeRef!, clientOperationId: run.id, request: compileProviderRequest(), callId: actionTurn.callId, action: actionTurn.action, outputObservation: action.outputObservation }));
      if (!submitted) return await releaseAndRead(run);
      turn = submitted;
      await persistTurnRefs(turn);
    }

    const persistedCandidate = run.status === "validating" ? run.terminalCandidate : turn.candidate;
    if (!isBoundedAiJsonObject(persistedCandidate)) return await failAndRead(runtimeError("result_invalid", "Provider returned an unbounded or non-object terminal result."));
    const boundedCandidate = aiJsonObjectSchema.safeParse(persistedCandidate);
    if (!boundedCandidate.success) return await failAndRead(runtimeError("result_invalid", "Provider returned an unbounded or non-object terminal result."));
    const candidate = boundedCandidate.data;
    if (run.status !== "validating" && run.status !== "committing_result") run = await transition(ports.runs, run, leaseOwner, "validating", { terminalCandidate: freezeCanonical(candidate) });
    const validation = await validateAiFeatureResult({ definition: input.definition, candidate, observations: run.observations, workspaceId: run.workspaceId, subject: run.subject });
    if (!validation.ok) return await failAndRead(runtimeError(validation.error.code, validation.error.message));

    const terminal = validation.result;
    let completion: CompletionValidation | undefined;
    if (terminal.status === "completed") {
      completion = input.definition.validateCompletion({ workspaceId: run.workspaceId, subject: run.subject, input: run.input, result: terminal, observations: run.observations });
      if (!completion.valid || completion.issues.length > 0) return await failAndRead(runtimeError("completion_invalid", "Feature completion validation failed."));
    }
    const finishedAt = now(ports.clock);
    if (input.definition.commitResult) {
      if (run.status !== "committing_result") {
        run = await transition(ports.runs, run, leaseOwner, "committing_result", { result: terminal as AiRunResult, completion, proposedActions: validation.proposedActions });
      }
      let receipt: Awaited<ReturnType<NonNullable<typeof input.definition.commitResult>>>;
      try {
        receipt = await lease.await(() => Promise.resolve(input.definition.commitResult!({
          workspaceId: run.workspaceId,
          subject: run.subject,
          input: run.input,
          observations: run.observations,
          runId: run.id,
          expectedStateVersion: run.stateVersion,
          leaseOwner,
          leaseExpiresAt: run.leaseExpiresAt,
          terminal: { result: terminal, completion, proposedActions: validation.proposedActions, finishedAt },
        })), { confirmAfter: false });
        if (leaseLost) return await releaseAndRead(run);
      } catch (cause) {
        try {
          return await releaseAndRead(await verifyAtomicCommit({ stateVersion: run.stateVersion, result: terminal, completion, proposedActions: validation.proposedActions, finishedAt, commitReference: undefined, verifyCommitReference: false }));
        } catch {
          if (cause instanceof AiFeatureRuntimeError) return await failAndRead(cause.detail);
          return await failAndRead(runtimeError("commit_failed", "Validated feature result could not be committed."));
        }
      }
      try {
        return await releaseAndRead(await verifyAtomicCommit({ stateVersion: run.stateVersion, result: terminal, completion, proposedActions: validation.proposedActions, finishedAt, commitReference: receipt?.commitReference }));
      } catch (cause) {
        if (cause instanceof AiFeatureRuntimeError) return await failAndRead(cause.detail);
        return await failAndRead(runtimeError("commit_failed", "Validated feature result could not be committed."));
      }
    }
    return await releaseAndRead(await transition(ports.runs, run, leaseOwner, terminal.status, { result: terminal as AiRunResult, completion, proposedActions: validation.proposedActions, finishedAt }));
  } catch (cause) {
    if (leaseLost) return await releaseAndRead(run);
    if (cause instanceof AiFeatureRuntimeError) return await failAndRead(cause.detail);
    return await releaseAndRead(run);
  } finally {
    if (leaseHeld) await ports.runs.releaseLease({ runId: run.id, expectedStateVersion: run.stateVersion, leaseOwner });
  }
}

/** Convenience composition for callers that should attach and execute immediately. */
export async function runAiFeature(input: RunAiFeatureInput, ports: AiFeatureRunnerPorts): Promise<AiFeatureRunRecord> {
  const run = await startOrAttachAiFeatureRun(input, ports);
  return executeAiFeatureRunById({ definition: input.definition, runId: run.id }, ports);
}
