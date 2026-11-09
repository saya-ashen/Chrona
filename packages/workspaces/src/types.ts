/** Physical workspace contracts. Placement and binding are opaque host-owned values.
 * Callers authorize/validate requests before I/O; no device or Run protocol lives here.
 */
export type WorkspaceBaseline = { kind: "commit" | "snapshot"; digest: string };
export type WorkspaceSource = { files: { path: string; sha256: string }[] };
export type WorkspaceSourceReceipt<Placement = unknown> = {
  placement: Placement;
  baseline: WorkspaceBaseline;
  manifestDigest: string;
  fileCount: number;
  verifiedAt: string;
  stage: "claim";
};
export type WorkspaceState<Placement = unknown> = {
  workspaceRef: string;
  mode: "existing" | "independent_worktree";
  baseline: WorkspaceBaseline;
  state: "requested" | "ready" | "failed" | "retained" | "removed" | "unknown";
  sourceReceipt: WorkspaceSourceReceipt<Placement> | null;
  retained: boolean;
};
export type LocalWorkspaceInput<Placement = unknown> = {
  binding: unknown;
  work: { workId: string; workspaceRef: string; workspaceMode: "existing" | "independent_worktree"; baseline: WorkspaceBaseline; source?: WorkspaceSource };
  mapping: { placement: Placement; canonicalPath: string; directoryIdentity: string; baseline: WorkspaceBaseline };
  managedRoot: string;
};
export type WorkspaceLock = { key: string; token: string };
export type WorkspaceLockOptions = {
  /** Opaque durable owner binding. Omit for process-local release only. */
  owner?: unknown;
  /** Persist the key/token before creating the lock; a throw prevents acquisition. */
  recordLock?: (lock: WorkspaceLock) => void;
};
export type WorkspaceCleanupInput =
  | { action: "preview"; workId: string; commandKey: string }
  | { action: "confirm"; workId: string; commandKey: string; previewDigest: string };
export type WorkspaceCleanupReceipt = {
  workId: string;
  workspaceRef: string;
  state: "retained" | "blocked" | "removed" | "unknown";
  reason: string;
  previewDigest: string | null;
};
