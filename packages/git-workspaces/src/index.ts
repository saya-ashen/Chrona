export { prepareLocalWorkspace, prepareLockedLocalWorkspace, verifyLocalSource } from "./workspaces";
export type { VerifiedLocalMapping } from "./workspaces";
export { cleanupLocalWorkspace } from "./workspace-cleanup";
export type { CleanupWorkspace } from "./workspace-cleanup";
export { localDirectoryIdentity, physicalLockIdentity, privateRoot } from "./workspace-identity";
export { recoverWorkspaceLocks } from "./workspace-locks";
export { workspaceDigest } from "./digest";
export type { LocalWorkspaceInput, WorkspaceBaseline, WorkspaceSource, WorkspaceSourceReceipt, WorkspaceState, WorkspaceLock, WorkspaceLockOptions, WorkspaceCleanupInput, WorkspaceCleanupReceipt } from "./types";
