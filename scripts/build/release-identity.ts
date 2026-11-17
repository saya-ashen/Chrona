import { deepStrictEqual } from "node:assert";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const RELEASE_IDENTITY_FILE = "release-identity.json";

async function releaseFiles(releaseDir: string) {
  const files: { path: string; mode: number; sha256?: string; symlink?: string }[] = [];
  async function visit(relative: string) {
    for (const name of (await readdir(join(releaseDir, relative))).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      if (path === RELEASE_IDENTITY_FILE) continue;
      const absolute = join(releaseDir, path), info = await lstat(absolute);
      if (info.isDirectory()) await visit(path);
      else if (info.isSymbolicLink()) files.push({ path, mode: info.mode & 0o777, symlink: await readlink(absolute) });
      else files.push({ path, mode: info.mode & 0o777, sha256: createHash("sha256").update(await readFile(absolute)).digest("hex") });
    }
  }
  await visit("");
  return files;
}

export async function writeReleaseIdentity(releaseDir: string, sourceRoot: string) {
  const files = await releaseFiles(releaseDir);
  const git = (args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: sourceRoot, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) console.error(JSON.stringify({
      component: "release-identity", event: "git_metadata_unavailable", command: ["git", ...args],
      exitCode: result.exitCode, error: result.stderr.toString().trim().slice(0, 2000),
    }));
    return result;
  };
  const head = git(["rev-parse", "HEAD"]), status = git(["status", "--porcelain"]);
  const record = {
    schema: 1,
    host: { commit: head.exitCode === 0 ? head.stdout.toString().trim() : null, workingTree: status.exitCode === 0 ? (status.stdout.length ? "modified" : "clean") : "unavailable" },
    build: { bun: Bun.version, platform: process.platform, arch: process.arch, lockSha256: createHash("sha256").update(await readFile(join(sourceRoot, "bun.lock"))).digest("hex") },
    files,
  };
  await writeFile(resolve(releaseDir, RELEASE_IDENTITY_FILE), JSON.stringify(record, null, 2) + "\n");
  return record;
}

export async function verifyReleaseIdentity(releaseDir: string) {
  const record = JSON.parse(await readFile(join(releaseDir, RELEASE_IDENTITY_FILE), "utf8"));
  deepStrictEqual(record.schema, 1, "Unsupported release identity schema");
  deepStrictEqual(record.files, await releaseFiles(releaseDir), "Release payload differs from the recorded combination");
}
