import type { Prisma, PrismaClient } from "@chrona/db";
import type { ProviderAdapter, ExecutionPrincipal, ExecutionRef, ExecutionSnapshot, ExecutionControl, ExecutionEventStore, ExecutionPorts, ExecutionProjectGrant } from "@chrona/contracts/steward";
import type { ExternalModuleInstaller } from "./module-install-types";
import type { ExecutionProjectGrantP2, WorkPlacement, ExecutionStartV2, ExecutorIdentity, ExecutorFence, ExecutorTarget, ExecutorAssignment, ExecutorMapping, ExecutorSourceRecord, ExecutorFinal, ExecutorStopProof, ExecutorController, ProviderInteraction } from "@chrona/contracts/steward";

/** P2 callbacks share the caller's writer transaction; none opens a transaction or performs network/process I/O. */
export type ExecutorAdmission = {
  online(tx: Prisma.TransactionClient, input: { executorId: string; now: Date }): Promise<(ExecutorFence & { authorizedUntil: Date }) | null>;
  reserve(tx: Prisma.TransactionClient, input: { ref: ExecutionRef; fence: ExecutorFence; mapping: ExecutorMapping; deadlineAt: Date }): Promise<ExecutorTarget>;
  prepare(tx: Prisma.TransactionClient, assignment: ExecutorAssignment, launchDigest: string): Promise<void>;
};
export type RemoteExecutionSink = {
  ingest(tx: Prisma.TransactionClient, input: { principal: ExecutionPrincipal; ref: ExecutorTarget; records: ExecutorSourceRecord[] }): Promise<{ acceptedThroughSourceSeq: number; storedHighWatermark: number }>;
  interaction(tx: Prisma.TransactionClient, principal: ExecutionPrincipal, request: ProviderInteraction, ref: ExecutionRef): Promise<void>;
};
/** Constructed only after R verifies the original assignment, journal identity and stop observation in the same tx. */
export type VerifiedDeviceStop = ExecutorIdentity & { target: ExecutorTarget; digest: string; proof: Exclude<ExecutorStopProof, { kind: "unknown" }> };
export type RemoteCompletion = {
  commit(tx: Prisma.TransactionClient, input: { principal: ExecutionPrincipal; target: ExecutorTarget; final: ExecutorFinal; digest: string; stop: VerifiedDeviceStop | null }): Promise<void>;
  committed(workspaceId: string, runId: string): Promise<void>;
};
export type ExecutionV2Admission = {
  start(principal: ExecutionPrincipal, input: ExecutionStartV2): Promise<{ execution: import("@chrona/contracts/steward").ExecutionView; placement: import("@chrona/contracts/steward").ExecutionPlacementView }>;
};
export type ExecutionClaimSelection = { kind: "ordinary" } | { kind: "execution"; executorId: string };
export type ExecutionRunTransactions = {
  finishRunIn(tx: Prisma.TransactionClient, runId: string, outcome: Awaited<ReturnType<ProviderAdapter["start"]>["done"]>, now: Date,
    evidence?: "provider_exited" | "never_started" | VerifiedDeviceStop): Promise<boolean>;
};
/** Authorized server preparation runs outside a DB transaction; its lock spans the final admission/claim transaction. */
export type ServerWorkspaceRequest = {
  principal: ExecutionPrincipal;
  input: ExecutionStartV2;
  grant: Extract<ExecutionProjectGrantP2, { executor: "server" }>;
  attemptId: string;
  workspaceRef: string;
  phase: "admission" | "claim";
};
export type PreparedServerWorkspace = {
  /** Digest of the complete request, including principal, grant, fixed identities and phase. */
  bindingDigest: string;
  cwd: string;
  projectDirectoryIdentity: string;
  workspaceDirectoryIdentity: string;
  workspace: import("@chrona/contracts/steward").WorkWorkspace;
  sourceReceipt: import("@chrona/contracts/steward").ExecutionSourceReceipt | null;
  verifiedAt: string;
  /** Called outside the DB transaction, including rejection paths. */
  release(): void;
};
/** U keeps parent/dependency state privately; these are requests against fixed authorized leaf workspaces. */
export type ExecutionWorkspaces = {
  cleanup(principal: ExecutionPrincipal, input: import("@chrona/contracts/steward").WorkCleanupInput): Promise<import("@chrona/contracts/steward").WorkCleanupReceipt>;
};
/** Only trusted owner routes may resolve. The caller executes the returned payload,
 * rechecking policy and atomically consuming a once grant with its action claim. */
export type ApprovedAction = { workspaceId: string; approvalId: string; payload: Prisma.JsonValue };
/** V5 seam: the executor must claim idempotently, recheck policy, consume once grants,
 * and record delivery outcomes. A resolved approval alone never means sent. */
export type OnApproved = (action: ApprovedAction) => Promise<void>;

/** G participates in F's existing SQLite transaction; these methods never open/commit their own transaction. */
export type ExecutionEventTransactions = {
  /** Reserve active final/control headroom before F commits its Run/receipt. Full capacity throws and rolls back admission. */
  admit(tx: Prisma.TransactionClient, principal: ExecutionPrincipal, ref: ExecutionRef): Promise<void>;
  /** Fixed bounded control fact; F commits before aborting/revoking externally. */
  control(tx: Prisma.TransactionClient, principal: ExecutionPrincipal, ref: ExecutionRef, fact: ExecutionControl): Promise<void>;
  /** Final snapshot and unused-headroom release share F's Run/stop-evidence transaction. Also accepts bounded live snapshots. */
  saveSnapshot(tx: Prisma.TransactionClient, principal: ExecutionPrincipal, snapshot: ExecutionSnapshot): Promise<void>;
};
export type StewardPorts = {
  db: PrismaClient; now(): Date; dataDir: string; publicUrl: string | null;
  provider?: ProviderAdapter;
  /** Host-owned project mapping; resolves and authorizes against the real caller moduleId/hash, never a body path. */
  resolveExecutionProject?: (principal: ExecutionPrincipal, projectRef: string) => Promise<ExecutionProjectGrant>;
  executions?: ExecutionPorts;
  /** P2 host snapshot; tx is used only for fresh identity/authorization reads, never remote filesystem I/O. */
  resolveExecutionPlacement?: (principal: ExecutionPrincipal, placement: WorkPlacement, tx: Prisma.TransactionClient) => Promise<ExecutionProjectGrantP2>;
  /** Enumerates only the caller's host-configured placements; no filesystem I/O or new grants. */
  executionLocations?: (principal: ExecutionPrincipal, tx: Prisma.TransactionClient) => Promise<WorkPlacement[]>;
  executionWorkspaces?: ExecutionWorkspaces;
  /** Bounded cleanup commands and receipts use the existing device transport and its writer transaction. */
  executionWorkspaceCleanupTransport?: {
    poll(tx: Prisma.TransactionClient, who: import("@chrona/contracts/steward").ExecutorPrincipal): Promise<NonNullable<import("@chrona/contracts/steward").ExecutorResponses["poll"]["cleanupOperations"]>>;
    report(tx: Prisma.TransactionClient, who: import("@chrona/contracts/steward").ExecutorPrincipal, input: import("@chrona/contracts/steward").ExecutorRequests["report"]): Promise<void>;
  };
  executionV2Admission?: ExecutionV2Admission;
  executionServerWorkspace?: { prepare(input: ServerWorkspaceRequest): Promise<PreparedServerWorkspace> };
  executorAdmission?: ExecutorAdmission;
  executorController?: ExecutorController;
  /** Waiting relay for already claimed device Runs. Its completion never supplies physical stop evidence. */
  executorProvider?: ProviderAdapter;
  /** Trusted runtime closure selects owner/workspace; HTTP inputs contain neither. */
  executorOwner?: {
    createPairing(input: { label: string }): Promise<{ code: string; expiresAt: string; label: string }>;
    revoke(input: { executorId: string; generation: number; commandKey: string }): Promise<{ executorId: string; generation: number; revoked: true }>;
    prepareIncarnation(input: import("@chrona/contracts/steward").ExecutorOwnerIncarnation): Promise<{ executorId: string; generation: number; incarnation: string; reconciled: false }>;
  };
  remoteExecutionSink?: RemoteExecutionSink;
  remoteCompletion?: RemoteCompletion;
  /** Existing ExecutionCommand key, consumed before this one-shot live delivery; server inject stays unchanged. */
  deliverRemoteControl?: (input: { target: ExecutorTarget; commandKey: string; text: string }) => Promise<void>;
  executionEvents?: ExecutionEventStore & ExecutionEventTransactions;
  /** Credentials from the service environment (qq_bot: { appId, clientSecret }); others are saved under `<dataDir>/secrets` (v2-16). */
  secrets?(name: string): Promise<Record<string, string> | null>;
  /** Presence metadata for host-owned credentials; never reads or returns credential values. */
  secretConfigured?(name: string): Promise<boolean>;
  /** v2-6 dependency installer: lockfile libraries and host system programs, into a staging module directory. */
  packages?: {
    backend: "nix" | "system";
    install(input: { dir: string; packages: string[]; gcroot: string }): Promise<{ errors: string[]; installed: { npm: boolean; python: boolean; packages: Record<string, string[]> } }>;
  };
  /** The `chrona` SDK package directory (sdk.ts, testing.ts) given to module builds. */
  moduleSdk?: string;
  /** v2-25: the module type check (check.ts, with TypeScript and Bun types beside it); without it builds skip the check. */
  moduleTypecheck?: string;
  /** Trusted resources from the running release: built-in installation and development-reference checkout, never app data. */
  moduleBuiltinResources?: string;
  /** Trusted official external packages from this release; never a request-provided host path. */
  moduleExternalResources?: string;
  /** B's bounded adapter to the existing proposal/build/activation queue. Must not run checks inline. */
  moduleExternalInstaller?: ExternalModuleInstaller;
  chatTimeoutMs?: number;
  onQueued?: () => Promise<unknown>;
  /** Queue the existing completion invocation in the same writer transaction as execution finalization. No I/O. */
  onExecutionFinishedIn?: (tx: Prisma.TransactionClient, workspaceId: string, runId: string) => Promise<void>;
  /** Post-commit wake only; durable execution completion is queued by onExecutionFinishedIn. */
  onRunFinished?: (workspaceId: string, runId: string) => Promise<void>;
  onApproved?: OnApproved;
  sandbox?: {
    /** Set by the host, never inferred from missing isolation or supplied by a module. */
    executionMode?: "trusted-local" | "required-isolation";
    /** Modules can run (an interpreter exists and required isolation is available). */
    available: boolean;
    /** Modules run inside bubblewrap; otherwise local OS permissions apply, not manifest isolation. */
    isolated: boolean;
    startModule?(input: { codeDir: string; dataDir: string; contentDir?: string; httpDir?: string; env?: Record<string, string>; entry: string; socketPath: string; network?: boolean; memoryMb?: number }): { pid: number; exited: Promise<{ code: number | null; signal: string | null }>; stderr(): string; kill(): void; limits?: { virtualMemoryMb: number } };
    runModule?(input: { codeDir: string; dataDir: string; contentDir?: string; entry: string; input: unknown; network?: boolean; timeoutMs?: number; maxOutputBytes?: number; memoryMb?: number }): Promise<{ status: "succeeded" | "failed" | "timed_out" | "unavailable"; output: string; error: string | null; exitCode?: number }>;
  };

  gitHealth?: () => Promise<boolean>;
};
