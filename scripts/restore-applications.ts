import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { moduleGitReleaseSource } from "./module-git-release";

export const applicationSourcePath = "packages/engine/src/modules/steward/applications";
export type ApplicationInput = {
  name: string; commit: string; bundle: string; bundleSha256: string; sourceSha256: string;
  artifacts: { file: string; sha256: string } | null;
};
const ROOT = resolve(import.meta.dirname, "..");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** The existing material validator checks coverage, artifact bytes, limits and executable modes. */
export async function applicationSourceDigest(directory: string) {
  const files = await moduleGitReleaseSource(directory);
  return sha256(Buffer.from(JSON.stringify(files.map(file => [file.path, file.executable, sha256(file.bytes)]))));
}

/** Enumerate declared source for lint and slice checks, including ignored restored checkouts. */
export async function restoredApplicationSources(root = ROOT) {
  const lock = JSON.parse(await readFile(join(root, "resources/application-inputs/lock.json"), "utf8")) as { applications: ApplicationInput[] };
  const sources = await Promise.all(lock.applications.map(async app => {
    const directory = join(applicationSourcePath, app.name);
    const material = JSON.parse(await readFile(join(root, directory, "chrona-material.json"), "utf8")) as { source: string[] };
    return material.source.map(path => `${directory}/${path}`);
  }));
  return sources.flat();
}

async function publishRestoredApplication(temporary: string, target: string) {
  try { await rename(temporary, target); }
  catch (error) {
    if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    console.error(JSON.stringify({ component: "application-inputs", event: "concurrent_restore_winner", error: String(error) }));
  }
}

/** Restore only pinned local inputs; sibling editing checkouts are never build inputs. */
export async function restoreApplications(root = ROOT, destination = join(root, applicationSourcePath)) {
  const lock = JSON.parse(await readFile(join(root, "resources/application-inputs/lock.json"), "utf8")) as { version: number; applications: ApplicationInput[] };
  if (lock.version !== 1) throw new Error("Unsupported application input lock");
  await mkdir(destination, { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  for (const app of lock.applications) {
    const bundle = join(root, app.bundle);
    if (sha256(await readFile(bundle)) !== app.bundleSha256) throw new Error(`Application bundle checksum mismatch: ${app.name}`);
    const head = execFileSync("git", ["bundle", "list-heads", bundle, "refs/heads/main"], { env, encoding: "utf8", stdio: "pipe" }).trim();
    if (head !== `${app.commit} refs/heads/main`) throw new Error(`Application commit mismatch: ${app.name}`);
    if (app.artifacts && sha256(await readFile(join(root, app.artifacts.file))) !== app.artifacts.sha256) throw new Error(`Application artifact input checksum mismatch: ${app.name}`);
    const target = join(destination, app.name);
    if (!existsSync(target)) {
      const temporary = await mkdtemp(join(dirname(target), `.${app.name}-`));
      try {
        execFileSync("git", ["-c", "core.hooksPath=/dev/null", "clone", "--no-hardlinks", "--branch", "main", bundle, temporary], { env, stdio: "pipe" });
        await rm(join(temporary, ".git"), { recursive: true });
        if (app.artifacts) execFileSync("tar", ["-xf", join(root, app.artifacts.file), "-C", temporary], { stdio: "pipe" });
        await publishRestoredApplication(temporary, target);
      } finally { await rm(temporary, { recursive: true, force: true }); }
    }
    if (await applicationSourceDigest(target) !== app.sourceSha256) throw new Error(`Restored application changed: ${app.name}; commit edits in its independent repository and refresh the fixed inputs`);
  }
}

if (import.meta.main) await restoreApplications();
