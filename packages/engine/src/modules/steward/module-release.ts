import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { BUILTIN_MODULE_NAMES, OFFICIAL_EXTERNAL_MODULE_NAMES, moduleManifestSchema, type ModuleManifest } from "@chrona/contracts/steward";
import { z } from "zod";
import { verifyModuleGitBundle } from "./module-git-upstream";
import type { StewardPorts } from "./ports";
import { readModuleFiles } from "./module-preview";
import { StewardError } from "./errors";

export type ModuleReleaseGit = { repository: string | null; branch: string; commit: string; bundlePath: string };
export type ModuleRelease = { name: string; origin: "builtin" | "external"; codeDir: string; hash: string; manifest: ModuleManifest; git: ModuleReleaseGit | null };
export class ModuleReleaseError extends StewardError {
  constructor(code: "not_found" | "invalid" | "forbidden" | "conflict", public readonly reason: "release_not_found" | "invalid_release" | "release_drift", message: string) { super(code, message); }
}
function releaseManifest(bytes: Buffer, name: string): ModuleManifest {
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString("utf8")); } catch { throw new ModuleReleaseError("invalid", "invalid_release", "Release manifest is not JSON"); }
  const parsed = moduleManifestSchema.safeParse(raw);
  if (!parsed.success || parsed.data.name !== name) throw new ModuleReleaseError("invalid", "invalid_release", "Release manifest mismatch");
  return parsed.data;
}
async function releaseDirectory(rootPath: string, name: string) {
  const root = await realpath(rootPath), codeDir = join(root, name), stat = await lstat(codeDir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !(await realpath(codeDir)).startsWith(root + sep)) throw new ModuleReleaseError("forbidden", "invalid_release", "Unsafe release directory");
  return codeDir;
}
function verifyLegacyReleaseHash(files: { path: string; bytes: Buffer }[], expectedHash: string) {
  const digest = createHash("sha256");
  for (const file of files) digest.update(file.path).update("\0").update(file.bytes).update("\0");
  if (digest.digest("hex") !== expectedHash) throw new ModuleReleaseError("conflict", "release_drift", "Release contents differ from the registered hash");
}
/** Host-configured resources only. Neither a manifest nor a routed request can supply the root. */
async function resolveRelease(rootPath: string | undefined, name: string, origin: ModuleRelease["origin"], expectedHash?: string): Promise<ModuleRelease> {
  const names: readonly string[] = origin === "builtin" ? BUILTIN_MODULE_NAMES : OFFICIAL_EXTERNAL_MODULE_NAMES;
  if (!names.includes(name)) throw new ModuleReleaseError("not_found", "release_not_found", `Unknown ${origin} release ${name}`);
  if (!rootPath) throw new ModuleReleaseError("not_found", "release_not_found", `${origin} release resources are not configured`);
  try {
    const codeDir = await releaseDirectory(rootPath, name);
    const files = (await readModuleFiles(codeDir, "Unsafe release file")).sort((a, b) => a.path.localeCompare(b.path));
    const file = files.find(file => file.path === "module.json");
    if (!file) throw new ModuleReleaseError("invalid", "invalid_release", "Release manifest missing");
    const manifest = releaseManifest(file.bytes, name);
    // Legacy hashes remain approval identities; new releases use their authentic Git commit.
    if (expectedHash && /^[a-f0-9]{64}$/.test(expectedHash)) {
      verifyLegacyReleaseHash(files, expectedHash);
      return { name, origin, codeDir, hash: expectedHash, manifest, git: null };
    }
    const git = await releaseGit(rootPath, name, files);
    if (expectedHash !== undefined && expectedHash !== git.commit) throw new ModuleReleaseError("conflict", "release_drift", "Release commit differs from the registered version");
    return { name, origin, codeDir, hash: git.commit, manifest, git };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ModuleReleaseError("not_found", "release_not_found", `Release resources missing for ${name}`);
    throw error;
  }
}
export function resolveBuiltinRelease(ports: Pick<StewardPorts, "moduleBuiltinResources">, name: string, expectedHash?: string): Promise<ModuleRelease> {
  return resolveRelease(ports.moduleBuiltinResources, name, "builtin", expectedHash);
}
export function resolveExternalRelease(ports: Pick<StewardPorts, "moduleExternalResources">, name: string): Promise<ModuleRelease> {
  return resolveRelease(ports.moduleExternalResources, name, "external");
}

const releaseLockSchema = z.object({ version: z.literal(1), modules: z.array(z.object({
  name: z.string(), repository: z.string().regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/).nullable(),
  branch: z.string().min(1), commit: z.string().regex(/^[a-f0-9]{40}$/), bundle: z.string(), bundleSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()) }).strict();
async function regularResource(root: string, path: string) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || !(await realpath(path)).startsWith(root + sep)) throw new ModuleReleaseError("forbidden", "invalid_release", "Unsafe release Git resource");
  return readFile(path);
}
async function releaseGit(rootPath: string, name: string, files: { path: string; bytes: Buffer }[]): Promise<ModuleReleaseGit> {
  const parent = dirname(await realpath(rootPath)), seedPath = join(parent, "module-git");
  const stat = await lstat(seedPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ModuleReleaseError("forbidden", "invalid_release", "Unsafe release Git directory");
  const seedRoot = await realpath(seedPath);
  if (!seedRoot.startsWith(parent + sep)) throw new ModuleReleaseError("forbidden", "invalid_release", "Unsafe release Git directory");
  const bytes = await regularResource(seedRoot, join(seedRoot, "lock.json"));
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString("utf8")); } catch { throw new ModuleReleaseError("invalid", "invalid_release", "Release Git lock is not JSON"); }
  const parsed = releaseLockSchema.safeParse(raw);
  if (!parsed.success) throw new ModuleReleaseError("invalid", "invalid_release", "Invalid release Git lock");
  const entries = parsed.data.modules.filter(entry => entry.name === name), entry = entries[0];
  if (entries.length !== 1 || entry.bundle !== `${name}.bundle`) throw new ModuleReleaseError("invalid", "invalid_release", "Release Git descriptor missing or ambiguous");
  const bundlePath = join(seedRoot, entry.bundle), bundle = await regularResource(seedRoot, bundlePath);
  if (createHash("sha256").update(bundle).digest("hex") !== entry.bundleSha256) throw new ModuleReleaseError("conflict", "release_drift", "Release Git bundle integrity mismatch");
  const revision = await verifyModuleGitBundle({ bundlePath, commit: entry.commit, branch: entry.branch, repository: entry.repository });
  if (files.length !== revision.files.length || files.some((file, index) => file.path !== revision.files[index]?.path || !file.bytes.equals(Buffer.from(revision.files[index]!.bytes)))) throw new ModuleReleaseError("conflict", "release_drift", "Release source differs from pinned Git commit");
  return { repository: entry.repository, branch: entry.branch, commit: entry.commit, bundlePath };
}
