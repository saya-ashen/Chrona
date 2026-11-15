/** Private Mind business contracts. CoreAccess is supplied by the trusted caller adapter, never tool JSON. */
export interface Scope { projectId?: string; sessionId?: string }
export interface CoreAccess {
  subject: string;
  role: "owner" | "application" | "runtime";
  scopes: Scope[];
  execution?: { actor: string; runRef: string };
  /** Trusted semantic admission adapter only; never read from tool arguments or Caller JSON. */
  semanticAdmission?: { digest: string };
}
export interface Versioned { id: string; revision: number; createdAt: string; updatedAt: string }
export interface Suppression { until: string; reason: "rejected" | "repeated-not-useful"; feedbackId: string }
export interface Evidence extends Versioned {
  sourceIdentity: string; epoch: string; eventId: string; cursor: string;
  object: { kind: string; id: string; revision: number };
  kind: "message" | "operation" | "result" | "correction" | "retract" | "scope-change";
  scope: Scope; actor: "user" | "assistant" | "application";
  origin: { rootId: string; parentId?: string; pursuitId?: string; runId?: string };
  occurredAt: string; receivedAt: string; scopeRevision: number;
  content?: { text?: string; artifactRefs?: string[]; truncated: boolean };
  visibilityRevision: number; sourceDigest: string; retractedAt?: string; expiredAt?: string;
  diagnostic?: boolean;
}
export interface Understanding extends Versioned {
  kind: "goal" | "preference" | "constraint" | "habit" | "environment";
  value: string; scope: Scope; explicitness: "explicit" | "inferred";
  supportingRefs: string[]; opposingRefs: string[];
  status: "active" | "candidate" | "needs-review" | "retracted";
  visibilityRevision: number; expiresAt?: string; suppression?: Suppression;
}
export type WaitFor = "user" | "permission" | "external" | "provider" | "budget" | "verification";
export type PursuitStatus = "candidate" | "active" | "waiting" | "done" | "ended";
export interface Responsibility { actor: string; runRef: string; claimedRevision: number; stopRequested: boolean }
export interface Pursuit extends Versioned {
  semanticKey: string; goal: string; completionCriteria: string[]; scope: Scope;
  reason: "explicit-goal" | "unfinished-commitment" | "important-blocker" | "improvement";
  evidenceRefs: string[]; understandingRefs: string[]; status: PursuitStatus;
  paused: boolean; waitFor?: WaitFor; waitReason?: string; nextStep?: string; nextCheckAt?: string;
  currentActor?: Responsibility; artifactRefs: string[]; suppression?: Suppression;
  verification?: { at: string; method: string; originalReceiptRef: string; runRef: string };
  visibilityRevision: number;
}
export interface SourceCheckpoint {
  id: string; revision: number; sourceIdentity: string; epoch: string; cursor: string;
  scopeRevision: number; coverage: { complete: boolean; oldestAvailableCursor?: string; gap?: string };
  capturedAt: string; batchDigest?: string; identityContinuityEpoch?: string;
}
export interface Retraction { id: string; revision: number; at: string; reason: "forgotten" | "source-retracted"; sourceScopeRevision?: number }
export interface ProgressCandidate extends Versioned {
  receipt: string; pursuitId: string; pursuitRevision: number; visibilityRevision: number;
  actor: string; runRef: string; actionKey: string; evidenceRefs: string[];
  summary: string; artifactRefs: string[]; originalReceiptRef: string;
  desiredStatus: "active" | "waiting" | "done"; waitFor?: WaitFor; nextStep?: string; waitReason?: string;
  state: "pending" | "applied" | "stale" | "rejected";
}
export interface ActionRecord {
  id: string; pursuitId: string; pursuitRevision: number; visibilityRevision: number;
  actor: string; runRef: string; argumentDigest: string; target: string;
  at: string; outcome: "intent" | "unknown" | "succeeded" | "failed";
  originalReceiptRef?: string;
}
export interface UserFeedback extends Versioned {
  targetKind: "understanding" | "pursuit"; targetId: string;
  scope: Scope; value: "useful" | "not-useful" | "reject" | "restart";
  evidenceRefs: string[]; suppressedUntil?: string;
}
export interface CoreSettings {
  revision: number; enabled: boolean; learningEnabled: boolean; notifyEnabled: boolean; autoSubmit: boolean;
  organizerProviderId?: string; organizerModel?: string; mainProviderId?: string; mainModel?: string;
  timezone: string; quietStart: string; quietEnd: string;
  eventRetentionDays: number; diagnosticRetentionDays: number;
  maxDatabaseBytes: number; restoreBlocked: boolean;
}
export interface CoreMeta { revision: number; visibilityRevision: number; degraded?: string }
export interface CoreRecords {
  evidence: Evidence; understanding: Understanding; pursuit: Pursuit;
  checkpoint: SourceCheckpoint; retraction: Retraction; candidate: ProgressCandidate;
  action: ActionRecord; feedback: UserFeedback;
}
export type RecordKind = keyof CoreRecords;
export interface CoreState extends CoreMeta {
  evidence: Evidence[]; understandings: Understanding[]; pursuits: Pursuit[];
  checkpoints: SourceCheckpoint[]; retractions: Retraction[]; candidates: ProgressCandidate[];
  actions: ActionRecord[]; feedback: UserFeedback[]; settings: CoreSettings;
}
export interface Receipt<T> {
  actionKey: string; at: string; outcome: "applied" | "compacted" | "forgotten"; value: T | null;
}
export interface Mutation { actionKey: string; expectedVisibilityRevision: number }
export interface IngestBatch {
  sourceIdentity: string; epoch: string; expectedCheckpointRevision: number;
  nextCursor: string; scopeRevision: number; capturedAt: string;
  coverage: SourceCheckpoint["coverage"];
  /** Runtime verified stable object/session IDs across epochs, or reconciled every retraction through an explicit mapping. */
  identityContinuityVerified?: boolean;
  events: Array<Omit<Evidence, keyof Versioned | "sourceIdentity" | "epoch" | "visibilityRevision" | "sourceDigest" | "retractedAt" | "expiredAt"> & { id: string }>;
}
export interface RememberInput extends Mutation {
  id?: string; expectedRevision: number; kind: Understanding["kind"]; value: string;
  scope: Scope; explicitness: Understanding["explicitness"];
  supportingRefs: string[]; opposingRefs?: string[]; expiresAt?: string;
}
export interface PursueInput extends Mutation {
  id?: string; expectedRevision: number; semanticKey: string; goal: string;
  completionCriteria: string[]; scope: Scope; reason: Pursuit["reason"];
  evidenceRefs: string[]; understandingRefs?: string[]; nextStep?: string;
}
export interface ClaimInput extends Mutation { pursuitId: string; expectedRevision: number }
export interface ReleaseInput extends ClaimInput { runRef: string; executionStopped: boolean; effectsReconciled: boolean }
export interface ProgressInput extends ClaimInput {
  summary: string; artifactRefs: string[]; originalReceiptRef: string;
  evidenceRefs: string[]; desiredStatus: "active" | "waiting" | "done";
  nextStep?: string; waitReason?: string; waitFor?: WaitFor;
}
/** Constructed by runtime after persisted tool-result and artifact inspection; never passed through tool JSON. */
export interface VerifiedProgress {
  candidateReceipt: string; runRef: string; originalReceiptRef: string;
  artifactRefs: string[]; method: string; criteriaSatisfied: boolean; executionTerminal: boolean;
}
export interface ApplyProgressInput extends Mutation { candidateId: string; expectedRevision: number; verified: VerifiedProgress }
export interface ControlInput extends Mutation {
  kind: "understanding" | "pursuit"; id: string; expectedRevision: number;
  operation: "pause" | "resume" | "end" | "correct";
  evidenceRefs?: string[]; value?: string; scope?: Scope; completionCriteria?: string[];
}
export interface FeedbackInput extends Mutation {
  targetKind: UserFeedback["targetKind"]; targetId: string; expectedRevision: number;
  value: UserFeedback["value"]; scope: Scope; evidenceRefs?: string[];
}
export type ForgetTarget =
  | { kind: "evidence" | "understanding"; id: string }
  | { kind: "object"; sourceIdentity: string; objectKind: string; objectId: string }
  | { kind: "session"; sessionId: string };
export interface ForgetInput extends Mutation { target: ForgetTarget }
export interface GuardActionInput extends ClaimInput { target: string; arguments: unknown }
export interface ContextInput { query?: string; scope: Scope; limit?: number; maxBytes?: number }
export interface ContextResult {
  revision: number; visibilityRevision: number; understandings: Understanding[];
  pursuits: Pursuit[]; evidence: Evidence[]; feedback: UserFeedback[]; checkpoints: SourceCheckpoint[];
  unknowns: string[]; truncated: boolean;
}
export interface OverviewInput { scope?: Scope; limit?: number; after?: string }
export interface OverviewResult {
  revision: number; visibilityRevision: number; items: Array<Understanding | Pursuit>;
  next?: string; settings: CoreSettings; degraded?: string;
}
export class CoreError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "FORBIDDEN" | "CONFLICT" | "NOT_FOUND" | "CAPACITY" | "RESTORE_BLOCKED", message: string) {
    super(message); this.name = "CoreError";
  }
}
