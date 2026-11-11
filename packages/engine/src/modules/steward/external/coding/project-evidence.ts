import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { codingError } from "./storage";
import { EXECUTION_CHANGES_LIMITS, type ExecutionResultSource } from "./contract.js";
import { safeGit } from "./project-changes";

/** A selected-project observation, never an Agent cwd attestation or permission grant. */
export async function observeProjectDirectory(path: string): Promise<{ path: string; identity: string }> {
  if (!isAbsolute(path)) throw codingError("invalid", "Coding project path must be absolute");
  try {
    const canonical = await realpath(path), info = await stat(canonical, { bigint: true });
    if (!info.isDirectory()) throw codingError("invalid", "Coding project must be a directory");
    await access(canonical, constants.R_OK | constants.W_OK | constants.X_OK);
    return { path: canonical, identity: `${info.dev}:${info.ino}` };
  } catch (error) {
    if ((error as { code?: string }).code === "invalid") throw error;
    throw codingError("unavailable", "Coding project directory cannot be observed");
  }
}
export async function verifyProjectDirectory(path: string, identity: string): Promise<void> {
  const observed = await observeProjectDirectory(path);
  if (observed.path !== path || observed.identity !== identity) throw codingError("conflict", "Selected Coding project directory changed");
}
/** Persist the returned baseline before run dispatch. Snapshot is provenance, not a content backup. */
export async function observeProjectBaseline(path: string, identity: string): Promise<ExecutionResultSource["baseline"]> {
  await verifyProjectDirectory(path, identity);
  const deadline = Date.now() + EXECUTION_CHANGES_LIMITS.timeoutMs;
  let commit: string | undefined;
  try {
    const root = (await safeGit(path, ["rev-parse", "--show-toplevel"], deadline)).toString().trimEnd();
    if (root === path) {
      const head = (await safeGit(path, ["rev-parse", "--verify", "HEAD^{commit}"], deadline)).toString().trim();
      if (/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head)) commit = head;
    }
  } catch { /* Non-Git and unborn repositories retain explicit snapshot provenance. */ }
  await verifyProjectDirectory(path, identity);
  return commit ? { kind: "commit", digest: commit } : { kind: "snapshot", digest: createHash("sha256").update(`${path}\0${identity}`).digest("hex") };
}
