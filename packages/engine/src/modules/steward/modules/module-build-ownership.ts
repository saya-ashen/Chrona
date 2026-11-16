import type { ModuleContext } from "./module-context";

// A failed guardian proof is not a completed build. Keep its code and private data
// owned for this runtime; recovery must not recreate/copy the same worktree.
const held = new WeakMap<ModuleContext["db"], Map<string, Error>>();
export function buildOwnershipError(context: ModuleContext, staging: string) {
  return held.get(context.db)?.get(staging);
}
export function holdBuildOwnership(context: ModuleContext, staging: string, error: unknown) {
  if (!(error instanceof Error) || error.name !== "ProcessStopUnknownError") return false;
  let paths = held.get(context.db);
  if (!paths) { paths = new Map(); held.set(context.db, paths); }
  paths.set(staging, error);
  return true;
}
export function assertBuildOwnership(context: ModuleContext, staging: string) {
  const error = buildOwnershipError(context, staging);
  if (error) throw error;
}
