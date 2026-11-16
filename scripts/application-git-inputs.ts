import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applicationSourcePath, type ApplicationInput } from "./restore-applications";
import { parseReleaseLock } from "./module-git-release";

const lockPath = "resources/application-inputs/lock.json";
const releaseLockPath = "resources/module-git/lock.json";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function gitObject(root: string, object: string): Buffer | null {
  const result = Bun.spawnSync(["git", "show", object], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return result.exitCode === 0 ? Buffer.from(result.stdout) : null;
}
function temporaryInputs(root: string) {
  mkdirSync(join(root, ".tmp"), { recursive: true });
  return mkdtempSync(join(root, ".tmp/application-git-inputs-"));
}
function verifyBundle(directory: string, app: ApplicationInput, bytes: Buffer) {
  if (sha256(bytes) !== app.bundleSha256) throw new Error(`Application bundle checksum mismatch: ${app.name}`);
  const path = join(directory, `${app.name}.bundle`);
  writeFileSync(path, bytes);
  const head = execFileSync("git", ["bundle", "list-heads", path, "refs/heads/main"], { encoding: "utf8", stdio: "pipe" }).trim();
  if (head !== `${app.commit} refs/heads/main`) throw new Error(`Application commit mismatch: ${app.name}`);
  return path;
}

/** A post-extraction baseline owns source in its fixed bundles, regardless of the current checkout's history. */
export function applicationBaselineSources(root: string, ref: string): Map<string, string> | null {
  const bytes = gitObject(root, `${ref}:${lockPath}`);
  if (!bytes) return null;
  const lock = JSON.parse(bytes.toString()) as { applications: ApplicationInput[] };
  const directory = temporaryInputs(root), sources = new Map<string, string>();
  try {
    for (const app of lock.applications) {
      const bundle = gitObject(root, `${ref}:${app.bundle}`);
      if (!bundle) throw new Error(`Baseline application bundle missing: ${app.name}`);
      const path = verifyBundle(directory, app, bundle), checkout = join(directory, app.name);
      execFileSync("git", ["-c", "core.hooksPath=/dev/null", "clone", "--branch", "main", path, checkout], { stdio: "pipe" });
      const files = execFileSync("git", ["-C", checkout, "ls-files", "-z"], { encoding: "utf8", stdio: "pipe" }).split("\0").filter(Boolean);
      for (const file of files) sources.set(`${applicationSourcePath}/${app.name}/${file}`, readFileSync(join(checkout, file), "utf8"));
    }
    return sources;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function matchingWorkingTree(root: string, path: string, indexed: Buffer) {
  if (!existsSync(join(root, path)) || !readFileSync(join(root, path)).equals(indexed)) {
    throw new Error(`Application input differs between index and working tree: ${path}`);
  }
}
function checkStagedReleaseLock(root: string, applications: ApplicationInput[]) {
  const release = gitObject(root, `:${releaseLockPath}`);
  if (!release) throw new Error(`Staged module Git release lock missing: ${releaseLockPath}`);
  matchingWorkingTree(root, releaseLockPath, release);
  const lock = parseReleaseLock(JSON.parse(release.toString()));
  for (const entry of lock.modules) {
    const app = applications.find(app => app.name === entry.name);
    if (!app || app.commit !== entry.commit || app.bundleSha256 !== entry.bundleSha256 || app.bundle !== `resources/module-git/${entry.bundle}`) throw new Error(`Staged release lock differs from application inputs: ${entry.name}`);
  }
}

/** Hooks inspect the bytes being committed; a complete working tree cannot excuse partial fixed-input staging. */
export function checkStagedApplicationInputs(root: string) {
  const bytes = gitObject(root, `:${lockPath}`);
  if (!bytes) {
    if (existsSync(join(root, lockPath))) throw new Error("Stage the application input lock together with its bundles and artifacts");
    return;
  }
  const lock = JSON.parse(bytes.toString()) as { applications: ApplicationInput[] };
  const directory = temporaryInputs(root);
  try {
    matchingWorkingTree(root, lockPath, bytes);
    for (const app of lock.applications) {
      const bundle = gitObject(root, `:${app.bundle}`);
      if (!bundle) throw new Error(`Staged application bundle missing: ${app.name}`);
      verifyBundle(directory, app, bundle);
      matchingWorkingTree(root, app.bundle, bundle);
      if (app.artifacts) {
        const artifact = gitObject(root, `:${app.artifacts.file}`);
        if (!artifact || sha256(artifact) !== app.artifacts.sha256) throw new Error(`Staged application artifact mismatch: ${app.name}`);
        matchingWorkingTree(root, app.artifacts.file, artifact);
      }
    }
    checkStagedReleaseLock(root, lock.applications);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
