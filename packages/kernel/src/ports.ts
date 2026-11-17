import type { VerifiedExecutionStop } from "./execution/execution-delivery-stop-types";
import type { Prisma, PrismaClient } from "@chrona/db";
import type { ProviderAdapter, ExecutionPrincipal, ExecutionRef, ExecutionSnapshot, ExecutionControl, ExecutionEventStore, ExecutionPorts, ExecutionProjectGrant, ModuleEntry } from "@chrona/contracts/steward";
import type { ExternalModuleInstaller } from "./modules/module-install-types";
import type { LocalExecutionProjectGrant, WorkPlacement, ExecutionStartV2 } from "@chrona/contracts/steward";

export type ExecutionV2Admission = {
  start(principal: ExecutionPrincipal, input: ExecutionStartV2): Promise<{ execution: import("@chrona/contracts/steward").ExecutionView; placement: import("@chrona/contracts/steward").ExecutionPlacementView }>;
};
export type ExecutionClaimSelection = { kind: "ordinary" } | { kind: "application" } | { kind: "execution"; executorId: string };
export type ExecutionRunTransactions = {
  finishRunIn(tx: Prisma.TransactionClient, runId: string, outcome: Awaited<ReturnType<ProviderAdapter["start"]>["done"]>, now: Date,
    evidence?: "provider_exited" | "never_started" | VerifiedExecutionStop): Promise<boolean>;
};
/** Authorized server preparation runs outside a DB transaction; its lock spans the final admission/claim transaction. */
export type ServerWorkspaceRequest = {
  principal: ExecutionPrincipal;
  input: ExecutionStartV2;
  grant: LocalExecutionProjectGrant;
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
  /** Host bindings keyed by module name; supervisor requires the approved identity and exact trusted release. */
  providerModules?: Record<string, { env: Record<string, string>; startModule: NonNullable<NonNullable<StewardPorts["sandbox"]>["startModule"]> }>;
  /** Host-owned project mapping; resolves and authorizes against the real caller moduleId/hash, never a body path. */
  resolveExecutionProject?: (principal: ExecutionPrincipal, projectRef: string) => Promise<ExecutionProjectGrant>;
  /** Host directory grants, scoped to the admitted owner/module; no business session state. */
  executionProjects?: {
    list(principal: ExecutionPrincipal): Promise<{ projects: { projectRef: string; path: string; label: string }[] }>;
    register(principal: ExecutionPrincipal, path: string): Promise<{ projectRef: string; path: string; label: string }>;
    create(principal: ExecutionPrincipal, name: string): Promise<{ projectRef: string; path: string; label: string }>;
  };
  executions?: ExecutionPorts;
  /** P2 host snapshot; tx is used only for fresh identity/authorization reads, never remote filesystem I/O. */
  resolveExecutionPlacement?: (principal: ExecutionPrincipal, placement: WorkPlacement, tx: Prisma.TransactionClient) => Promise<LocalExecutionProjectGrant>;
  /** Enumerates only the caller's host-configured placements; no filesystem I/O or new grants. */
  executionLocations?: (principal: ExecutionPrincipal, tx: Prisma.TransactionClient) => Promise<WorkPlacement[]>;
  executionWorkspaces?: ExecutionWorkspaces;
  executionV2Admission?: ExecutionV2Admission;
  executionServerWorkspace?: { prepare(input: ServerWorkspaceRequest): Promise<PreparedServerWorkspace> };
  executionEvents?: ExecutionEventStore & ExecutionEventTransactions;
  /** Optional host-private credential defaults, used only for approved declared reads when no saved vault value exists. */
  secrets?(name: string): Promise<Record<string, string> | null>;
  /** Presence metadata for host-owned credentials; never reads or returns credential values. */
  secretConfigured?(name: string): Promise<boolean>;
  /** v2-6 dependency installer: lockfile libraries and host system programs, into a staging module directory. */
  packages?: {
    install(input: { dir: string; packages: string[] }): Promise<{ errors: string[]; installed: { npm: boolean; python: boolean; packages: Record<string, string[]> } }>;
  };
  /** The `chrona` SDK package directory (sdk.ts, testing.ts) given to module builds. */
  moduleSdk?: string;
  /** v2-25: the module type check (check.ts, with TypeScript and Bun types beside it); without it builds skip the check. */
  moduleTypecheck?: string;
  /** Trusted host-resolved native process guardian, never supplied by module material. */
  processHelper?: string;
  /** Language-neutral host runtime declarations; checks are optional per entry extension. */
  moduleRuntimes?: { version: number; runtimes: { extensions: string[]; check?: { programs: { default: string[]; [platform: string]: string[] }; argv: string[] } }[] };
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
    executionMode?: "trusted-local";
    /** Host runtime is configured; entry-specific interpreter availability is checked at launch. */
    available: boolean;
    /** Legacy health projection; trusted local execution uses OS permissions. */
    isolated: boolean;
    startModule?(input: { codeDir: string; dataDir: string; contentDir?: string; env?: Record<string, string>; entry: ModuleEntry; ipcEndpoint: string; ipcToken: string; network?: boolean }): { pid: number; exited: Promise<{ code: number | null; signal: string | null }>; stderr(): string; kill(): void };
    runModule?(input: { codeDir: string; dataDir: string; contentDir?: string; entry: string; input: unknown; network?: boolean; timeoutMs?: number; maxOutputBytes?: number }): Promise<{ status: "succeeded" | "failed" | "timed_out" | "unavailable"; output: string; error: string | null; exitCode?: number }>;
  };

  gitHealth?: () => Promise<boolean>;
};
