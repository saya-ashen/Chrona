import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { EXECUTION_CHANGES_LIMITS as LIMITS, executionResultSourceSchema, type ExecutionRef, type ExecutionResultSource } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";

type Changes = NonNullable<ExecutionResultSource["changes"]>;
type ResultRow = { id: string; workId: string; runId: string; logDir: string; baseline: string; run: { sessionId: string | null } };
class CaptureFailure extends Error {
  constructor(readonly reason: NonNullable<Changes["reason"]>) { super(reason); }
}
function provenance(row: ResultRow) {
  const separator = row.baseline.indexOf(":"), kind = row.baseline.slice(0, separator), digest = row.baseline.slice(separator + 1);
  const ref: ExecutionRef = { workId: row.workId, runId: row.runId, attemptId: row.id, sessionId: row.run.sessionId! };
  return { ...ref, baseline: { kind, digest } };
}
function unavailable(reason: Changes["reason"]): Changes {
  return { scope: "baseline_to_worktree", status: "unavailable", reason, patch: "", files: [] };
}
function git(cwd: string, args: string[], deadline: number): Promise<Buffer> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new CaptureFailure("capture_failed"));
  return new Promise((resolveOutput, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
    Object.assign(env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" });
    const child = spawn("git", ["--no-pager", "--no-optional-locks", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "diff.external=", ...args], { cwd, env, stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let bytes = 0, failure: CaptureFailure | undefined;
    const timer = setTimeout(() => { failure = new CaptureFailure("capture_failed"); child.kill("SIGKILL"); }, remaining);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > LIMITS.bytes) { failure = new CaptureFailure("limit"); child.kill("SIGKILL"); }
      else chunks.push(chunk);
    });
    child.once("error", () => { clearTimeout(timer); reject(new CaptureFailure("capture_failed")); });
    child.once("close", code => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new CaptureFailure("capture_failed"));
      else resolveOutput(Buffer.concat(chunks));
    });
  });
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
  const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
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
  if (baseline.kind === "snapshot") return unavailable("snapshot_unresolvable");
  if (!/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(baseline.digest)) return unavailable("baseline_unverified");
  let root: string;
  try { root = (await git(cwd, ["rev-parse", "--show-toplevel"], deadline)).toString().trimEnd(); }
  catch (error) { if (error instanceof CaptureFailure && error.reason === "limit") throw error; return unavailable("not_git"); }
  if (root !== cwd || await realpath(cwd) !== cwd) return unavailable("baseline_unverified");
  try { await git(cwd, ["cat-file", "-e", `${baseline.digest}^{commit}`], deadline); }
  catch { return unavailable("baseline_unverified"); }
  return undefined;
}
async function collect(cwd: string, baseline: ExecutionResultSource["baseline"], deadline: number): Promise<Changes> {
  const failure = await baselineFailure(cwd, baseline, deadline);
  if (failure) return failure;
  const diff = ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--ignore-submodules=none", baseline.digest, "--"];
  const tracked = (await git(cwd, [...diff.slice(0, -1), "--name-only", "-z", "--"], deadline)).toString("utf8").split("\0").filter(Boolean);
  const untracked = (await git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"], deadline)).toString("utf8").split("\0").filter(Boolean);
  const stats = (await git(cwd, [...diff.slice(0, -1), "--numstat", "-z", "--"], deadline)).toString("utf8").split("\0");
  const binaries = new Set(stats.filter(line => line.startsWith("-\t-\t")).map(line => line.slice(4)));
  const raw = (await git(cwd, [...diff.slice(0, -1), "--raw", "-z", "--"], deadline)).toString("utf8").split("\0");
  const special = new Map<string, "symlink" | "unsupported">();
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const modes = raw[i]!.split(" ").slice(0, 2).map(mode => mode.replace(/^:/, ""));
    if (modes.includes("160000")) special.set(raw[i + 1]!, "unsupported");
    else if (modes.includes("120000")) special.set(raw[i + 1]!, "symlink");
  }
  const changes: Changes = { scope: "baseline_to_worktree", status: "complete", patch: "", files: [] };
  let patchEncoding = false;
  try { changes.patch = new TextDecoder("utf-8", { fatal: true }).decode(await git(cwd, diff, deadline)); }
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
/** Shared bounded capture on the executor that owns cwd; never called in a DB transaction. */
export async function captureWorkspaceChanges(cwd: string, baseline: ExecutionResultSource["baseline"]): Promise<Changes> {
  try { return await collect(cwd, baseline, Date.now() + LIMITS.timeoutMs); }
  catch (error) {
    const changes = unavailable(error instanceof CaptureFailure ? error.reason : "capture_failed");
    if (changes.reason === "limit") changes.status = "partial";
    return changes;
  }
}
/** Called only after actual Provider.done and before Run.finish releases heldDirectory. Disk errors propagate for auditing. */
export async function captureExecutionChanges(ports: Pick<StewardPorts, "db">, runId: string): Promise<void> {
  const row = await ports.db.executionAttempt.findUnique({ where: { runId }, include: { run: true } });
  if (!row) return;
  if (row.executorId !== "server" || row.resolvedCwd === null) throw new Error("Device changes must come from the verified remote final");
  const source = executionResultSourceSchema.parse(provenance(row));
  const ownsDirectory = row.queueExpiresAt ? row.heldDirectory !== null : row.heldDirectory === row.resolvedCwd;
  const changes = ownsDirectory ? await captureWorkspaceChanges(row.resolvedCwd, source.baseline) : unavailable("capture_failed");
  const sidecar = executionResultSourceSchema.parse({ ...source, changes });
  await mkdir(row.logDir, { recursive: true });
  const path = join(row.logDir, "execution-changes.json");
  await writeFile(`${path}.tmp`, JSON.stringify(sidecar));
  await rename(`${path}.tmp`, path);
}
/** Authorization happens in resultSource before this fixed-file read; never re-open the released project. */
export async function readExecutionChanges(row: ResultRow): Promise<ExecutionResultSource["changes"]> {
  let text: string;
  try {
    const handle = await open(join(row.logDir, "execution-changes.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const bytes = Buffer.alloc(LIMITS.bytes + 4097);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead > LIMITS.bytes + 4096) throw new Error("Execution change sidecar exceeds limit");
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, bytesRead));
    } finally { await handle.close(); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  const stored = executionResultSourceSchema.parse(JSON.parse(text));
  const expected = provenance(row);
  if (stored.workId !== expected.workId || stored.runId !== expected.runId || stored.attemptId !== expected.attemptId || stored.sessionId !== expected.sessionId
    || stored.baseline.kind !== expected.baseline.kind || stored.baseline.digest !== expected.baseline.digest) throw new Error("Execution change sidecar identity mismatch");
  return stored.changes;
}
