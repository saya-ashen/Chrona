import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { moduleGitReleaseSource } from "./module-git-release";
import { applicationSourceDigest, type ApplicationInput } from "./restore-applications";

/** Pin an explicitly supplied, committed application checkout; never infer a remote or sibling path. */
export async function pinApplication(name: string, repository: string, root = resolve(import.meta.dirname, "..")) {
  const directory = join(root, "resources/application-inputs");
  await mkdir(directory, { recursive: true });
  const git = (args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", repository, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
  const manifest = JSON.parse(await readFile(join(repository, "module.json"), "utf8"));
  if (manifest.name !== name || !/^[a-z][a-z-]*$/.test(name)) throw new Error("Application name mismatch");
  if (git(["branch", "--show-current"]) !== "main" || git(["status", "--porcelain"])) throw new Error("Commit application source on main before pinning");
  const files = await moduleGitReleaseSource(repository);
  const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean).sort();
  if (JSON.stringify(tracked) !== JSON.stringify(files.map(file => file.path).sort())) throw new Error("Application Git tree must contain exactly its declared source and material record");
  const releasePath = join(root, "resources/module-git/lock.json");
  const releases = JSON.parse(await readFile(releasePath, "utf8"));
  const release = releases.modules.find((entry: { name: string }) => entry.name === name);
  if (release) git(["merge-base", "--is-ancestor", release.commit, "HEAD"]);
  const bundle = release ? `resources/module-git/${name}.bundle` : `resources/application-inputs/${name}.bundle`;
  git(["bundle", "create", join(root, bundle), "refs/heads/main"]);
  const hash = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
  const material = JSON.parse(await readFile(join(repository, "chrona-material.json"), "utf8"));
  let artifacts: ApplicationInput["artifacts"] = null;
  if (material.artifacts.length) {
    const file = `resources/application-inputs/${name}.artifacts`;
    execFileSync("tar", ["-czf", join(root, file), "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "-C", repository, "--null", "-T", "-"], {
      input: Buffer.from(material.artifacts.map((artifact: { path: string }) => artifact.path + "\0").join("")), stdio: ["pipe", "pipe", "pipe"],
    });
    artifacts = { file, sha256: await hash(join(root, file)) };
  } else await rm(join(directory, `${name}.artifacts`), { force: true });
  const entry: ApplicationInput = {
    name, commit: git(["rev-parse", "HEAD"]), bundle, bundleSha256: await hash(join(root, bundle)),
    sourceSha256: await applicationSourceDigest(repository), artifacts,
  };
  const path = join(directory, "lock.json");
  const lock = await Bun.file(path).exists() ? JSON.parse(await readFile(path, "utf8")) : { version: 1, applications: [] };
  lock.applications = [...lock.applications.filter((app: ApplicationInput) => app.name !== name), entry]
    .sort((a: ApplicationInput, b: ApplicationInput) => a.name.localeCompare(b.name));
  await writeFile(path, JSON.stringify(lock, null, 2) + "\n");
  if (release) {
    Object.assign(release, { repository: null, commit: entry.commit, bundleSha256: entry.bundleSha256 });
    await writeFile(releasePath, JSON.stringify(releases, null, 2) + "\n");
    const planPath = join(root, "resources/module-git/publish-plan.json");
    const plan = JSON.parse(await readFile(planPath, "utf8"));
    Object.assign(plan.modules.find((app: { name: string }) => app.name === name), {
      commit: entry.commit, localRepository: relative(join(root, "resources/module-git"), repository),
    });
    await writeFile(planPath, JSON.stringify(plan, null, 2) + "\n");
  }
  return entry;
}

if (import.meta.main) {
  const [name, repository] = process.argv.slice(2);
  if (!name || !repository || process.argv.length !== 4) throw new Error("Usage: bun scripts/pin-application.ts <name> <committed-repository>");
  await pinApplication(name, resolve(repository));
}
