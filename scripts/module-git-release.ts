#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildArtifacts } from "../build/manifest";

export type ModuleGitReleaseEntry = { name: string; repository: string | null; branch: string; commit: string; bundle: string; bundleSha256: string };
type ReleaseLock = { version: 1; modules: ModuleGitReleaseEntry[] };
type PublishPlan = { version: 1; modules: { name: string; proposedRepository: string; localRepository: string; branch: string; commit: string }[] };
const oid = /^[a-f0-9]{40}$/;
const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
const ignored = new Set([".git", "node_modules", ".venv", ".chrona"]);

function git(dir: string, args: string[], input?: Uint8Array, dates?: string): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  try {
    return execFileSync("git", ["--no-replace-objects", "-c", `core.hooksPath=${nullDevice}`, "-C", dir, ...args], {
      env: { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: nullDevice, GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "Chrona Release", GIT_AUTHOR_EMAIL: "noreply@chrona.local", GIT_COMMITTER_NAME: "Chrona Release", GIT_COMMITTER_EMAIL: "noreply@chrona.local", ...(dates ? { GIT_AUTHOR_DATE: dates, GIT_COMMITTER_DATE: dates } : {}) },
      input, encoding: "utf8", timeout: 30_000, maxBuffer: 32 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch { throw new Error(`Module release Git command failed (${args[0]}); Git must be installed and the seed repository must be valid`); }
}

async function sourceFiles(root: string, relative = ""): Promise<{ path: string; bytes: Buffer }[]> {
  const files: { path: string; bytes: Buffer }[] = [];
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!relative && ignored.has(entry.name)) continue;
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.name === ".git" || entry.name.includes("\\")) throw new Error("Unsafe module release source path");
    if (entry.isDirectory()) files.push(...await sourceFiles(root, path));
    else if (entry.isFile()) files.push({ path, bytes: await readFile(join(root, path)) });
    else throw new Error("Module release sources must contain regular files and directories only");
  }
  return files;
}

type Tree = Map<string, string | Tree>;
async function sourceTree(repo: string, codeDir: string, name: string) {
  const manifest = JSON.parse(await readFile(join(codeDir, "module.json"), "utf8"));
  if (manifest.name !== name) throw new Error(`Module release manifest mismatch: ${name}`);
  const root: Tree = new Map();
  for (const file of await sourceFiles(codeDir)) {
    const parts = file.path.split("/"), leaf = parts.pop()!;
    let tree = root;
    for (const part of parts) {
      if (!tree.has(part)) tree.set(part, new Map());
      tree = tree.get(part) as Tree;
    }
    tree.set(leaf, git(repo, ["hash-object", "-w", "--stdin"], file.bytes));
  }
  function save(tree: Tree): string {
    const entries = [...tree].map(([name, value]) => typeof value === "string" ? `100644 blob ${value}\t${name}\0` : `040000 tree ${save(value)}\t${name}\0`);
    return git(repo, ["mktree", "-z"], Buffer.from(entries.join("")));
  }
  return save(root);
}

async function writeJson(path: string, value: unknown) {
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2) + "\n");
  await rename(`${path}.tmp`, path);
}
function validateReleaseIdentity(entry: ModuleGitReleaseEntry, names: Set<string>) {
  if (!buildArtifacts.moduleGit.modules.some(module => module.name === entry.name) || names.has(entry.name) || entry.branch !== "main" || !oid.test(entry.commit) || entry.bundle !== `${entry.name}.bundle` || !/^[a-f0-9]{64}$/.test(entry.bundleSha256) || (entry.repository !== null && entry.repository !== `https://github.com/chrona-core/chrona-module-${entry.name}`)) throw new Error("Invalid module Git release identity");
}
async function readLock(seedDir: string): Promise<ReleaseLock> {
  const raw: unknown = JSON.parse(await readFile(join(seedDir, "lock.json"), "utf8"));
  if (typeof raw !== "object" || raw === null || !("version" in raw) || raw.version !== 1 || !("modules" in raw) || !Array.isArray(raw.modules)) throw new Error("Invalid module Git release lock");
  const lock = raw as ReleaseLock, names = new Set<string>();
  for (const entry of lock.modules) {
    validateReleaseIdentity(entry, names);
    names.add(entry.name);
  }
  if (names.size !== buildArtifacts.moduleGit.modules.length) throw new Error("Module Git release lock is incomplete");
  return lock;
}

/** Stage the same license in maintained seeds and every packaged module tree. */
export async function stageModuleGitLicense(resourcesRoot: string, licensePath: string, noticesPath: string) {
  for (const module of buildArtifacts.moduleGit.modules) {
    await cp(licensePath, join(resourcesRoot, module.source, "LICENSE"));
    if (["web", "coding", "editor"].includes(module.name)) await cp(noticesPath, join(resourcesRoot, module.source, "THIRD-PARTY-NOTICES.txt"));
  }
}

async function restoreSeedRepository(repo: string, seedDir: string, old?: ModuleGitReleaseEntry) {
  await mkdir(repo, { recursive: true });
  await gitDirectory(repo);
  try { await lstat(join(repo, "HEAD")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    git(repo, ["init", "--bare", "--object-format=sha1", "--template=", "--initial-branch=main"]);
  }
  let parent = git(repo, ["for-each-ref", "--format=%(objectname)", "refs/heads/main"]);
  if (!parent && old) {
    const bundlePath = resolve(seedDir, old.bundle);
    if (createHash("sha256").update(await readFile(bundlePath)).digest("hex") !== old.bundleSha256) throw new Error(`Module seed checksum mismatch: ${old.name}`);
    git(repo, ["bundle", "verify", bundlePath]);
    git(repo, ["fetch", "--no-tags", bundlePath, "refs/heads/main:refs/heads/main"]);
    parent = git(repo, ["rev-parse", "refs/heads/main"]);
    if (parent !== old.commit) throw new Error(`Module seed commit mismatch: ${old.name}`);
  }
  return parent;
}

async function writeSeedBundle(input: { repo: string; seedDir: string; name: string; commit: string; unchanged: boolean; old?: ModuleGitReleaseEntry }): Promise<ModuleGitReleaseEntry> {
  const { repo, seedDir, name, commit, unchanged, old } = input;
  const bundle = `${name}.bundle`, bundlePath = resolve(seedDir, bundle);
  if (!unchanged || old?.commit !== commit) {
    git(repo, ["bundle", "create", `${bundlePath}.tmp`, "refs/heads/main"]);
    await rename(`${bundlePath}.tmp`, bundlePath);
  }
  git(repo, ["bundle", "verify", bundlePath]);
  const bundleSha256 = createHash("sha256").update(await readFile(bundlePath)).digest("hex");
  if (unchanged && old?.commit === commit && old.bundleSha256 !== bundleSha256) throw new Error(`Module seed checksum mismatch: ${name}`);
  return { name, repository: old?.commit === commit ? old.repository : null, branch: "main", commit, bundle, bundleSha256 };
}

type PreparedModuleInput = { resourcesRoot: string; seedDir: string; hostCommit: string; hostTimestamp: string };
async function prepareModuleSeed(input: PreparedModuleInput, module: { name: string; source: string }, old?: ModuleGitReleaseEntry) {
  const repo = resolve(input.seedDir, "repos", `${module.name}.git`);
  const parent = await restoreSeedRepository(repo, input.seedDir, old);
  const { hostCommit, hostTimestamp } = input;
  const tree = await sourceTree(repo, join(input.resourcesRoot, module.source), module.name);
  const unchanged = !!parent && git(repo, ["rev-parse", `${parent}^{tree}`]) === tree;
  const message = `${parent ? "Update" : "Extract initial"} module release from Chrona ${hostCommit}\n\nExtracted from the build input working source; this is not inherited monorepo history.\nLICENSE copied unchanged from the Chrona repository MIT License; bundled dependencies retain their third-party notices.\n`;
  const commit = unchanged ? parent : git(repo, ["commit-tree", tree, ...(parent ? ["-p", parent] : [])], Buffer.from(message), `@${hostTimestamp} +0000`);
  git(repo, ["update-ref", "refs/heads/main", commit, parent || "0".repeat(40)]);
  return writeSeedBundle({ repo, seedDir: input.seedDir, name: module.name, commit, unchanged, old });
}

/** Extract current sources, not rewritten monorepo history. A stable tree reuses its existing commit. */
export async function prepareModuleGitRelease(input: { root: string; resourcesRoot: string; seedDir: string; hostCommit?: string; hostTimestamp?: string }): Promise<ReleaseLock> {
  const hostCommit = input.hostCommit ?? git(input.root, ["rev-parse", "HEAD"]);
  const hostTimestamp = input.hostTimestamp ?? git(input.root, ["show", "-s", "--format=%ct", "HEAD"]);
  if (!oid.test(hostCommit) || !/^\d+$/.test(hostTimestamp)) throw new Error("Module seeds require a real Chrona base commit and commit timestamp");
  await stageModuleGitLicense(input.resourcesRoot, join(input.root, "LICENSE"), join(input.root, buildArtifacts.moduleGit.seedDir, "THIRD-PARTY-NOTICES.txt"));
  await mkdir(input.seedDir, { recursive: true });
  await writeFile(join(input.seedDir, "LICENSE"), await readFile(join(input.root, "LICENSE")));
  await writeFile(join(input.seedDir, "THIRD-PARTY-NOTICES.txt"), await readFile(join(input.root, buildArtifacts.moduleGit.seedDir, "THIRD-PARTY-NOTICES.txt")));
  let previous: ReleaseLock | undefined;
  try { previous = await readLock(input.seedDir); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const modules: ModuleGitReleaseEntry[] = [], plan: PublishPlan = { version: 1, modules: [] };
  for (const module of buildArtifacts.moduleGit.modules) {
    const entry = await prepareModuleSeed({ ...input, hostCommit, hostTimestamp }, module, previous?.modules.find(entry => entry.name === module.name));
    modules.push(entry);
    plan.modules.push({ name: module.name, proposedRepository: `chrona-core/chrona-module-${module.name}`, localRepository: resolve(input.seedDir, "repos", `${module.name}.git`), branch: "main", commit: entry.commit });
  }
  const lock: ReleaseLock = { version: 1, modules };
  await writeJson(join(input.seedDir, "lock.json"), lock);
  await writeJson(join(input.seedDir, "publish-plan.json"), plan);
  return lock;
}
async function gitDirectory(path: string) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe module seed repository directory");
}

/** Consume fixed seeds, including published histories, without generating a new initial commit. */
export async function copyModuleGitRelease(seedDir: string, resourcesRoot: string) {
  const lock = await readLock(seedDir), target = join(resourcesRoot, buildArtifacts.moduleGit.resourcesDir);
  await mkdir(target, { recursive: true });
  for (const file of ["LICENSE", "THIRD-PARTY-NOTICES.txt"]) {
    const bytes = await readFile(join(seedDir, file));
    if (resolve(seedDir, file) !== resolve(target, file)) await writeFile(join(target, file), bytes);
  }
  for (const entry of lock.modules) {
    const bundlePath = resolve(seedDir, entry.bundle), bytes = await readFile(bundlePath);
    if (createHash("sha256").update(bytes).digest("hex") !== entry.bundleSha256) throw new Error(`Module seed checksum mismatch: ${entry.name}`);
    const module = buildArtifacts.moduleGit.modules.find(module => module.name === entry.name)!;
    // Verify against a temporary bare repository, never trust a mutable cache ref or the caller's Git config.
    const temp = await mkdtemp(join(tmpdir(), "chrona-release-seed-"));
    try {
      git(temp, ["init", "--bare", "--object-format=sha1", "--template="]);
      git(temp, ["bundle", "verify", bundlePath]);
      git(temp, ["fetch", "--no-tags", bundlePath, `refs/heads/${entry.branch}:refs/heads/main`]);
      if (git(temp, ["rev-parse", "refs/heads/main"]) !== entry.commit || git(temp, ["cat-file", "-t", entry.commit]) !== "commit") throw new Error(`Module seed commit mismatch: ${entry.name}`);
      if (await sourceTree(temp, join(resourcesRoot, module.source), entry.name) !== git(temp, ["rev-parse", `${entry.commit}^{tree}`])) throw new Error(`Module seed differs from packaged source: ${entry.name}`);
    } finally { await rm(temp, { recursive: true, force: true }); }
    if (resolve(bundlePath) !== resolve(target, entry.bundle)) await cp(bundlePath, join(target, entry.bundle));
  }
  await writeJson(join(target, "lock.json"), lock);
  return lock;
}

/** Read-only remote checks; it never creates a GitHub repository or pushes. */
export async function verifyPublishedModuleGitRelease(seedDir: string) {
  const lock = await readLock(seedDir);
  for (const entry of lock.modules) {
    const name = `chrona-core/chrona-module-${entry.name}`;
    const repo = JSON.parse(execFileSync("gh", ["repo", "view", name, "--json", "visibility,url,nameWithOwner,owner"], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }));
    const url = `https://github.com/${name}`;
    if (repo.visibility !== "PUBLIC" || repo.url !== url || repo.nameWithOwner !== name || repo.owner?.login !== "chrona-core" || git(seedDir, ["ls-remote", "--exit-code", url, `refs/heads/${entry.branch}`]) !== `${entry.commit}\trefs/heads/${entry.branch}`) throw new Error(`Public module upstream is not at the packaged commit: ${entry.name}`);
    entry.repository = url;
  }
  await writeJson(join(seedDir, "lock.json"), lock);
  return lock;
}

if (import.meta.main) {
  const [command, directory, resources] = process.argv.slice(2);
  if (command === "prepare" && directory && resources) {
    await prepareModuleGitRelease({ root: resolve(import.meta.dirname, ".."), seedDir: resolve(directory), resourcesRoot: resolve(resources), hostCommit: process.env.CHRONA_MODULE_GIT_COMMIT, hostTimestamp: process.env.CHRONA_MODULE_GIT_TIMESTAMP });
  } else if (command === "verify-published" && directory && !resources) await verifyPublishedModuleGitRelease(resolve(directory));
  else throw new Error("Usage: bun scripts/module-git-release.ts prepare <seed-directory> <staged-resources-root> | verify-published <seed-directory>");
}
