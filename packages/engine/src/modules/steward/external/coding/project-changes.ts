import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { EXECUTION_CHANGES_LIMITS as LIMITS, type ExecutionResultSource } from "./contract.js";

type Changes = NonNullable<ExecutionResultSource["changes"]>;
class CaptureFailure extends Error {
  constructor(readonly reason: NonNullable<Changes["reason"]>) { super(reason); }
}
export function unavailableChanges(reason: Changes["reason"]): Changes {
  return { scope: "baseline_to_worktree", status: "unavailable", reason, patch: "", files: [] };
}
export async function safeGit(cwd: string, args: string[], deadline: number): Promise<Buffer> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new CaptureFailure("capture_failed");
  const { spawnSupervised } = await import("chrona/process");
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_") && !name.startsWith("CHRONA_")));
  Object.assign(env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" });
  const task = spawnSupervised("git", ["--no-pager", "--no-optional-locks", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "diff.external=", ...args], { cwd, env, helperPath: process.env.CHRONA_PROCESS_HELPER });
  const chunks: Buffer[] = [];
  let bytes = 0, failure: CaptureFailure | undefined;
  const timer = setTimeout(() => { failure = new CaptureFailure("capture_failed"); task.stop(); }, remaining);
  task.process.stdin.end();
  task.process.stdout.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > LIMITS.bytes) { failure = new CaptureFailure("limit"); task.stop(); }
    else chunks.push(chunk);
  });
  task.process.stderr.resume();
  try {
    const exit = await task.exited;
    if (failure) throw failure;
    if (exit.code !== 0 || exit.stop.state !== "stopped" || exit.stop.scope !== "descendants" || !exit.stop.treeClean) throw new CaptureFailure("capture_failed");
    return Buffer.concat(chunks);
  } finally { clearTimeout(timer); }
}
function bounded(changes: Changes): Changes {
  if (Buffer.byteLength(JSON.stringify(changes)) <= LIMITS.bytes) return changes;
  changes.status = "partial"; changes.reason = "limit"; changes.patch = "";
  for (const file of changes.files) if (file.text !== undefined) { delete file.text; file.omitted = "size"; }
  while (Buffer.byteLength(JSON.stringify(changes)) > LIMITS.bytes) changes.files.pop();
  return changes;
}
async function fileEvidence(cwd: string, path: string, kind: "tracked" | "untracked", binary: boolean): Promise<Changes["files"][number]> {
  const file: Changes["files"][number] = { path, kind };
  const full = resolve(cwd, path), rel = relative(cwd, full);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return { ...file, omitted: "unsupported" };
  let info;
  try { info = await lstat(full); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" && kind === "tracked") return file; throw error; }
  if (info.isSymbolicLink()) return { ...file, omitted: "symlink" };
  if (!info.isFile() || await realpath(full) !== full) return { ...file, omitted: "unsupported" };
  if (binary) return { ...file, omitted: "binary" };
  if (kind === "tracked") return file;
  return untrackedText(full, file);
}
async function untrackedText(full: string, file: Changes["files"][number]): Promise<Changes["files"][number]> {
  const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await handle.stat()).isFile()) return { ...file, omitted: "unsupported" };
    const bytes = Buffer.alloc(LIMITS.fileBytes + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > LIMITS.fileBytes) return { ...file, omitted: "size" };
    const content = bytes.subarray(0, bytesRead);
    if (content.includes(0)) return { ...file, omitted: "binary" };
    try { file.text = new TextDecoder("utf-8", { fatal: true }).decode(content); }
    catch { file.omitted = "encoding"; }
    return file;
  } finally { await handle.close(); }
}
async function baselineFailure(cwd: string, baseline: ExecutionResultSource["baseline"], deadline: number): Promise<Changes | undefined> {
  if (baseline.kind === "snapshot") return unavailableChanges("snapshot_unresolvable");
  if (!/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(baseline.digest)) return unavailableChanges("baseline_unverified");
  let root: string;
  try { root = (await safeGit(cwd, ["rev-parse", "--show-toplevel"], deadline)).toString().trimEnd(); }
  catch (error) { if (error instanceof CaptureFailure && error.reason === "limit") throw error; return unavailableChanges("not_git"); }
  if (root !== cwd || await realpath(cwd) !== cwd) return unavailableChanges("baseline_unverified");
  try { await safeGit(cwd, ["cat-file", "-e", `${baseline.digest}^{commit}`], deadline); }
  catch { return unavailableChanges("baseline_unverified"); }
  return undefined;
}
async function collect(cwd: string, baseline: ExecutionResultSource["baseline"], deadline: number): Promise<Changes> {
  const failure = await baselineFailure(cwd, baseline, deadline);
  if (failure) return failure;
  const diff = ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--ignore-submodules=none", baseline.digest, "--"];
  const tracked = (await safeGit(cwd, [...diff.slice(0, -1), "--name-only", "-z", "--"], deadline)).toString("utf8").split("\0").filter(Boolean);
  const untracked = (await safeGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"], deadline)).toString("utf8").split("\0").filter(Boolean);
  const stats = (await safeGit(cwd, [...diff.slice(0, -1), "--numstat", "-z", "--"], deadline)).toString("utf8").split("\0");
  const binaries = new Set(stats.filter(line => line.startsWith("-\t-\t")).map(line => line.slice(4)));
  const raw = (await safeGit(cwd, [...diff.slice(0, -1), "--raw", "-z", "--"], deadline)).toString("utf8").split("\0");
  const special = new Map<string, "symlink" | "unsupported">();
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const modes = raw[i]!.split(" ").slice(0, 2).map(mode => mode.replace(/^:/, ""));
    if (modes.includes("160000")) special.set(raw[i + 1]!, "unsupported");
    else if (modes.includes("120000")) special.set(raw[i + 1]!, "symlink");
  }
  const changes: Changes = { scope: "baseline_to_worktree", status: "complete", patch: "", files: [] };
  let patchEncoding = false;
  try { changes.patch = new TextDecoder("utf-8", { fatal: true }).decode(await safeGit(cwd, diff, deadline)); }
  catch (error) {
    if (error instanceof CaptureFailure && error.reason !== "limit") throw error;
    changes.status = "partial";
    if (error instanceof CaptureFailure) changes.reason = "limit";
    else patchEncoding = true;
  }
  const paths = [...tracked.map(path => ({ path, kind: "tracked" as const })), ...untracked.map(path => ({ path, kind: "untracked" as const }))];
  await collectFiles(cwd, paths, changes, { special, binaries, patchEncoding, deadline });
  return bounded(changes);
}
async function collectFiles(cwd: string, paths: { path: string; kind: "tracked" | "untracked" }[], changes: Changes, evidence: { special: Map<string, "symlink" | "unsupported">; binaries: Set<string>; patchEncoding: boolean; deadline: number }) {
  const { special, binaries, patchEncoding, deadline } = evidence;
  if (paths.length > LIMITS.files) { changes.status = "partial"; changes.reason = "limit"; }
  for (const { path, kind } of paths.slice(0, LIMITS.files)) {
    if (Date.now() >= deadline) throw new CaptureFailure("capture_failed");
    if (path.length > 4096 || path.includes("\ufffd")) { changes.status = "partial"; changes.reason = "limit"; continue; }
    const omitted = special.get(path);
    const file = omitted ? { path, kind, omitted } : await fileEvidence(cwd, path, kind, binaries.has(path));
    if (patchEncoding && kind === "tracked" && !file.omitted) file.omitted = "encoding";
    if (file.omitted) changes.status = "partial";
    changes.files.push(file);
  }
}
/** Bounded observation of the selected project; this does not attest the kernel run cwd. */
export async function captureWorkspaceChanges(cwd: string, baseline: ExecutionResultSource["baseline"]): Promise<Changes> {
  try { return await collect(cwd, baseline, Date.now() + LIMITS.timeoutMs); }
  catch (error) {
    const changes = unavailableChanges(error instanceof CaptureFailure ? error.reason : "capture_failed");
    if (changes.reason === "limit") changes.status = "partial";
    return changes;
  }
}
