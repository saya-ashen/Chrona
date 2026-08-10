import type {
  AiContractRef,
  AiFeatureManifest,
  AiFeatureOperation,
  AiFeatureRuntimeError,
  AiFeatureRunStatus,
  AiFeatureSubject,
  AiJsonObject,
  AiObjective,
  AiObservationEnvelope,
  AiRunResult,
  CompletionValidation,
  ProposedAction,
} from "@chrona/contracts/ai-feature-runtime";

export type AiFeatureActionExecutionSemantics = "shared_transaction" | "domain_idempotent" | "read_only" | "idempotent_external" | "at_most_once";

export type AiFeatureRunRecord = {
  id: string;
  workspaceId: string;
  feature: AiContractRef;
  /** Immutable canonical manifest captured at creation, never the live registry definition. */
  manifest: AiFeatureManifest;
  manifestHash: string;
  subject: AiFeatureSubject;
  operation: AiFeatureOperation;
  input: AiJsonObject;
  inputHash: string;
  /** Immutable canonical objective captured at creation. */
  objective: AiObjective;
  status: AiFeatureRunStatus;
  stateVersion: number;
  attempt: number;
  observations: readonly AiObservationEnvelope[];
  proposedActions: readonly ProposedAction[];
  result?: AiRunResult;
  terminalCandidate?: unknown;
  completion?: CompletionValidation;
  error?: AiFeatureRuntimeError;
  commitReference?: AiJsonObject;
  providerRunRef?: string;
  providerResumeRef?: string;
  startedAt?: string;
  providerClientId?: string;
  providerName?: string;
  providerConfigFingerprint?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
  /** Opaque ownership token for an active runner lease; never publicly projected. */
  leaseOwner?: string;
  leaseExpiresAt?: string;
};

export type CreateAiFeatureRunInput = Omit<
  AiFeatureRunRecord,
  "status" | "stateVersion" | "attempt" | "observations" | "proposedActions" | "createdAt" | "updatedAt"
>;

export type CreateAiFeatureRunResult =
  | { kind: "created"; run: AiFeatureRunRecord }
  | { kind: "existing"; run: AiFeatureRunRecord };

export type UpdateAiFeatureRunInput = {
  runId: string;
  expectedStateVersion: number;
  status: AiFeatureRunStatus;
  /** When supplied, the update succeeds only while this runner owns the lease. */
  leaseOwner?: string;
  result?: AiRunResult;
  terminalCandidate?: unknown;
  completion?: CompletionValidation;
  error?: AiFeatureRuntimeError;
  observations?: readonly AiObservationEnvelope[];
  proposedActions?: readonly ProposedAction[];
  commitReference?: AiJsonObject;
  providerRunRef?: string;
  providerResumeRef?: string;
  startedAt?: string;
  finishedAt?: string;
};

export type ClaimAiFeatureRunInput = {
  runId: string;
  expectedStateVersion: number;
  leaseOwner: string;
  leaseExpiresAt: string;
  now: string;
};
/** Owner-fenced liveness update. It must not advance `stateVersion`. */
export type HeartbeatAiFeatureRunLeaseInput = {
  runId: string;
  leaseOwner: string;
  leaseExpiresAt: string;
  now: string;
};

export type ReleaseAiFeatureRunLeaseInput = {
  runId: string;
  expectedStateVersion: number;
  leaseOwner: string;
};

export type ClaimAiFeatureRunActionResult =
  | { kind: "claimed"; action: AiFeatureRunActionRecord }
  | { kind: "existing"; action: AiFeatureRunActionRecord }
  | { kind: "outcome_unknown"; action: AiFeatureRunActionRecord };

export type AiFeatureActionExecutionPort = {
  /**
   * The implementation must make this domain mutation and `completeAction`
   * durable in one transaction when the action binding requires it. Other
   * semantics must honour the stable `executionKey` as their idempotency key.
   */
  execute(input: {
    runId: string;
    action: AiFeatureRunActionRecord;
    workspaceId: string;
    subject: AiFeatureSubject;
    observations: readonly AiObservationEnvelope[];
  }): Promise<AiObservationEnvelope>;
};

/** Deliberately redacted DTO for subject-authorized progress surfaces. */
export type AiFeatureRunPublicRead = {
  status: AiFeatureRunStatus;
  stateVersion: number;
  attempt: number;
  error?: { code: AiFeatureRuntimeError["code"]; messageKey: string };
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ReadAiFeatureRunPublicInput = {
  workspaceId: string;
  feature: AiContractRef;
  subject: AiFeatureSubject;
  runId: string;
};


export type AiFeatureRunActionRecord = {
  id: string;
  runId: string;
  callId: string;
  executionKey: string;
  action: AiContractRef;
  status: "pending" | "executing" | "completed" | "failed" | "outcome_unknown";
  /** Initial execution is attempt 1; replayable actions may be reclaimed once. */
  attempt: number;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  input: AiJsonObject;
  inputHash: string;
  outputObservation?: AiObservationEnvelope;
  error?: AiFeatureRuntimeError;
};

export type ClaimAiFeatureRunActionInput = Omit<AiFeatureRunActionRecord, "status" | "attempt" | "outputObservation" | "error"> & {
  executionSemantics: AiFeatureActionExecutionSemantics;
  expectedRunStateVersion: number;
  leaseOwner: string;
  leaseExpiresAt: string;
  /** Repository-time comparison point for deterministic expiry CAS. */
  now: string;
  maxCalls?: number;
};

/**
 * Persistence boundary. Implementations atomically enforce operation uniqueness,
 * run state-version compare-and-swap, and owner-bound leases. `claimAction`
 * records an executing action before any side effect, CAS-reclaims one expired
 * replayable execution, and stores at-most-once ambiguity as a failed action
 * with `action_outcome_unknown` for durable reconciliation. `completeAction`
 * atomically stores action output with the run before provider submission.
 */
export interface AiFeatureRunRepositoryPort {
  createOrRead(input: CreateAiFeatureRunInput): Promise<CreateAiFeatureRunResult>;
  update(input: UpdateAiFeatureRunInput): Promise<AiFeatureRunRecord | null>;
  claim(input: ClaimAiFeatureRunInput): Promise<AiFeatureRunRecord | null>;
  heartbeatLease(input: HeartbeatAiFeatureRunLeaseInput): Promise<AiFeatureRunRecord | null>;
  releaseLease(input: ReleaseAiFeatureRunLeaseInput): Promise<AiFeatureRunRecord | null>;
  claimAction(input: ClaimAiFeatureRunActionInput): Promise<ClaimAiFeatureRunActionResult | null>;
  completeAction(input: {
    actionId: string;
    executionKey: string;
    expectedRunStateVersion: number;
    leaseOwner: string;
    outputObservation: AiObservationEnvelope;
  }): Promise<{ action: AiFeatureRunActionRecord; run: AiFeatureRunRecord } | null>;
  failAction(input: {
    actionId: string;
    executionKey: string;
    leaseOwner: string;
    error: AiFeatureRuntimeError;
  }): Promise<AiFeatureRunActionRecord | null>;
  getById(runId: string): Promise<AiFeatureRunRecord | null>;
  listRecoverableRuns?(before: string, queuedBefore: string, limit: number): Promise<AiFeatureRunRecord[]>;
  readPublic?(input: ReadAiFeatureRunPublicInput): Promise<AiFeatureRunPublicRead | null>;
}
