import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { StewardError } from "./errors";
import { checkoutModule, INSTALLED_DIRS } from "./module-files";

export type ModuleGitFile = { path: string; bytes: Uint8Array };
export type ModuleGitRevision = { commit: string; tree: string };
type Repository = { platform: string; moduleId: string };
const oid = /^[a-f0-9]{40}$/;
const zero = "0".repeat(40);
function component(value: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new StewardError("invalid", "Invalid module repository identity");
  return value;
}
export function moduleGitPath(platform: string, moduleId: string) {
  return join(resolve(platform), "repos", `${component(moduleId)}.git`);
}
function git(repo: string, args: string[], input?: Uint8Array): Promise<Buffer> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  return new Promise((accept, reject) => {
    const child = execFile("git", ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "maintenance.auto=false", "-c", "gc.auto=0", "-c", "credential.helper=", "-c", "core.askPass=", "-c", "http.extraHeader=", "-c", "http.followRedirects=false", "--git-dir", repo, ...args], {
      env: { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "Chrona", GIT_AUTHOR_EMAIL: "chrona@localhost", GIT_COMMITTER_NAME: "Chrona", GIT_COMMITTER_EMAIL: "chrona@localhost" },
      encoding: "buffer", timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout) => {
      if (!error) accept(stdout);
      else reject(Object.assign(new StewardError("conflict", (error as NodeJS.ErrnoException).code === "ENOENT" ? "Git is required for module source repositories" : "Module Git operation failed"), { exitCode: typeof error.code === "number" ? error.code : undefined }));
    });
    child.stdin?.on("error", () => { /* execFile reports process failure. */ });
    child.stdin?.end(input);
  });
}
async function directory(path: string) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== resolve(path)) throw new StewardError("forbidden", "Unsafe module repository directory");
}
export async function ensureModuleGit(platform: string, moduleId: string) {
  const repo = moduleGitPath(platform, moduleId);
  await mkdir(platform, { recursive: true });
  await directory(platform);
  const repos = join(resolve(platform), "repos");
  try { await mkdir(repos); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  await directory(repos);
  try { await mkdir(repo); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  await directory(repo);
  try { await lstat(join(repo, "HEAD")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await git(repo, ["init", "--bare", "--object-format=sha1", "--template=", "--initial-branch=local"]);
  }
  return repo;
}
function validateFiles(files: ModuleGitFile[]) {
  let bytes = 0;
  const paths = new Set<string>();
  for (const file of files) {
    const parts = file.path.split("/");
    if (file.path.includes("\\") || file.path.includes("\0") || parts.some(part => !part || part === "." || part === ".." || part === ".git") || INSTALLED_DIRS.has(parts[0]!)) throw new StewardError("invalid", "Invalid module source path");
    if (paths.has(file.path)) throw new StewardError("invalid", "Duplicate module source path");
    paths.add(file.path); bytes += file.bytes.byteLength;
  }
  if (files.length > 200 || bytes > 1024 * 1024) throw new StewardError("invalid", "Module exceeds file limits");
}
async function revision(repo: string, commit: string): Promise<ModuleGitRevision> {
  if (!oid.test(commit)) throw new StewardError("invalid", "Invalid module Git commit");
  const tree = (await git(repo, ["rev-parse", "--verify", `${commit}^{tree}`])).toString().trim();
  // Verify a commit, rather than accepting a tree object as source history.
  await git(repo, ["rev-parse", "--verify", `${commit}^{commit}`]);
  return { commit, tree };
}
async function localHead(repo: string) {
  // show-ref --verify uses a distinct missing-ref exit, but no stderr contents escape.
  const refs = (await git(repo, ["for-each-ref", "--format=%(objectname)", "refs/heads/local"])).toString().trim();
  return refs || undefined;
}
export async function getModuleLocalHead(input: Repository): Promise<string | undefined> {
  const repo = await ensureModuleGit(input.platform, input.moduleId);
  return localHead(repo);
}
type Tree = Map<string, string | Tree>;
async function writeTree(repo: string, files: ModuleGitFile[]) {
  validateFiles(files);
  const root: Tree = new Map();
  for (const file of files) {
    const parts = file.path.split("/"), name = parts.pop()!;
    let tree = root;
    for (const part of parts) {
      if (!tree.has(part)) tree.set(part, new Map());
      const next = tree.get(part)!;
      if (typeof next === "string") throw new StewardError("invalid", "Conflicting module source paths");
      tree = next;
    }
    if (tree.has(name)) throw new StewardError("invalid", "Conflicting module source paths");
    tree.set(name, (await git(repo, ["hash-object", "-w", "--stdin"], file.bytes)).toString().trim());
  }
  async function save(tree: Tree): Promise<string> {
    const entries: string[] = [];
    for (const [name, value] of tree) entries.push(typeof value === "string" ? `100644 blob ${value}\t${name}\0` : `040000 tree ${await save(value)}\t${name}\0`);
    return (await git(repo, ["mktree", "-z"], Buffer.from(entries.join("")))).toString().trim();
  }
  return save(root);
}
async function createRevision(repo: string, files: ModuleGitFile[], message: string, parent?: string): Promise<ModuleGitRevision> {
  const previous = parent ? await revision(repo, parent) : undefined;
  const tree = await writeTree(repo, files);
  if (previous?.tree === tree) return previous;
  const commit = (await git(repo, ["commit-tree", tree, ...(parent ? ["-p", parent] : [])], Buffer.from(message + "\n"))).toString().trim();
  return { commit, tree };
}
async function pin(repo: string, ref: string, commit: string) {
  const current = (await git(repo, ["for-each-ref", "--format=%(objectname)", ref])).toString().trim();
  if (current === commit) return;
  if (current) throw new StewardError("conflict", "Module source version is already pinned");
  await git(repo, ["update-ref", ref, commit, zero]);
}
export async function commitModuleSource(input: Repository & { versionId: string; files: ModuleGitFile[]; parent?: string; message: string }): Promise<ModuleGitRevision> {
  component(input.versionId);
  const repo = await ensureModuleGit(input.platform, input.moduleId), current = await localHead(repo);
  if (input.parent && current && input.parent !== current) throw new StewardError("conflict", "Module source changed; submit from the latest source");
  const result = await createRevision(repo, input.files, input.message, input.parent ?? current);
  // Pin first: a racing branch update must never discard the submitted source.
  await pin(repo, `refs/chrona/candidates/${input.versionId}`, result.commit);
  await git(repo, ["update-ref", "refs/heads/local", result.commit, current ?? zero]);
  return result;
}
export async function adoptModuleGitCandidate(input: Repository & { versionId: string; commit: string; parent?: string }): Promise<ModuleGitRevision> {
  component(input.versionId);
  const repo = await ensureModuleGit(input.platform, input.moduleId), current = await localHead(repo);
  if (input.parent && current && input.parent !== current) throw new StewardError("conflict", "Module source changed; submit from the latest source");
  const result = await revision(repo, input.commit);
  await readModuleSource(input);
  await pin(repo, `refs/chrona/candidates/${input.versionId}`, result.commit);
  await git(repo, ["update-ref", "refs/heads/local", result.commit, current ?? zero]);
  return result;
}
export async function readModuleSource(input: Repository & { commit: string }): Promise<ModuleGitFile[]> {
  const repo = moduleGitPath(input.platform, input.moduleId);
  await directory(repo);
  await revision(repo, input.commit);
  const entries = (await git(repo, ["ls-tree", "-rz", input.commit])).toString("utf8").split("\0").filter(Boolean);
  if (entries.length > 200) throw new StewardError("invalid", "Module exceeds file limits");
  const files: ModuleGitFile[] = [];
  let total = 0;
  for (const entry of entries) {
    const tab = entry.indexOf("\t"), [mode, type, hash] = entry.slice(0, tab).split(" ");
    if (!["100644", "100755"].includes(mode!) || type !== "blob") throw new StewardError("forbidden", "Unsafe module Git source entry");
    const bytes = await git(repo, ["cat-file", "blob", hash!]);
    total += bytes.byteLength;
    if (total > 1024 * 1024) throw new StewardError("invalid", "Module exceeds file limits");
    files.push({ path: entry.slice(tab + 1), bytes });
  }
  validateFiles(files);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export async function exportModuleSource(input: Repository & { commit: string; root: string; dir: string }) {
  await checkoutModule(input.root, input.dir, await readModuleSource(input));
}
export async function importLegacyModuleSource(input: Repository & { legacyHash: string; files: ModuleGitFile[] }): Promise<ModuleGitRevision> {
  if (!/^[a-f0-9]{64}$/.test(input.legacyHash)) throw new StewardError("invalid", "Invalid legacy module hash");
  validateFiles(input.files);
  const digest = createHash("sha256");
  for (const file of [...input.files].sort((a, b) => a.path.localeCompare(b.path))) digest.update(file.path).update("\0").update(file.bytes).update("\0");
  if (digest.digest("hex") !== input.legacyHash) throw new StewardError("conflict", "Legacy module source does not match its recorded hash; existing artifacts were preserved");
  const repo = await ensureModuleGit(input.platform, input.moduleId), ref = `refs/chrona/legacy/${input.legacyHash}`;
  const existing = (await git(repo, ["for-each-ref", "--format=%(objectname)", ref])).toString().trim();
  if (existing) return revision(repo, existing);
  const result = await createRevision(repo, input.files, `Import verified legacy module ${input.legacyHash}`);
  await pin(repo, ref, result.commit);
  return result;
}
// Shared only with module-git-upstream: callers use the source operations above.
export { git as moduleGitCommand, revision as moduleGitRevision, pin as pinModuleGitRef };
