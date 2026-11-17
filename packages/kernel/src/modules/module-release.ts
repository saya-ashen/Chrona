import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { moduleInstallRequestSchema, moduleManifestSchema, type ModuleManifest } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import { moduleMaterialDigest, snapshotModuleMaterial } from "./module-artifacts";
import type { ModuleFile } from "./module-files";
import { StewardError } from "../errors";

export type ModuleRelease = { name: string; origin: "external"; codeDir: string; hash: string; manifest: ModuleManifest };
class ModuleReleaseError extends StewardError {
  constructor(code: "not_found" | "invalid" | "forbidden" | "conflict", public readonly reason: "release_not_found" | "invalid_release" | "release_drift", message: string) { super(code, message); }
}
function releaseManifest(bytes: Buffer, name: string): ModuleManifest {
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString("utf8")); }
  catch (error) { throw Object.assign(new ModuleReleaseError("invalid", "invalid_release", "Release manifest is not JSON"), { cause: error }); }
  const parsed = moduleManifestSchema.safeParse(raw);
  if (!parsed.success || parsed.data.name !== name) throw new ModuleReleaseError("invalid", "invalid_release", "Release manifest mismatch");
  return parsed.data;
}
async function releaseDirectory(rootPath: string, name: string) {
  const root = await realpath(rootPath), codeDir = join(root, name), stat = await lstat(codeDir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !(await realpath(codeDir)).startsWith(root + sep)) throw new ModuleReleaseError("forbidden", "invalid_release", "Unsafe release directory");
  return codeDir;
}
export function readReleaseMaterial(codeDir: string): Promise<ModuleFile[]> {
  return snapshotModuleMaterial(dirname(codeDir), basename(codeDir), { verifyTree: true });
}
/** Only host configuration supplies the release root; request arguments cannot grant a host path. */
export async function resolveExternalRelease(ports: Pick<StewardPorts, "moduleExternalResources">, name: string, expectedHash?: string): Promise<ModuleRelease> {
  if (!moduleInstallRequestSchema.shape.package.safeParse(name).success) throw new ModuleReleaseError("not_found", "release_not_found", `Unknown release ${name}`);
  if (!ports.moduleExternalResources) throw new ModuleReleaseError("not_found", "release_not_found", "External release resources are not configured");
  try {
    const codeDir = await releaseDirectory(ports.moduleExternalResources, name);
    const files = await readReleaseMaterial(codeDir), hash = moduleMaterialDigest(files);
    const file = files.find(file => file.path === "module.json");
    if (!file) throw new ModuleReleaseError("invalid", "invalid_release", "Release manifest missing");
    const manifest = releaseManifest(Buffer.from(file.bytes), name);
    if (expectedHash !== undefined && expectedHash !== hash) throw new ModuleReleaseError("conflict", "release_drift", "Release material differs from the selected version");
    return { name, origin: "external", codeDir, hash, manifest };
  } catch (error) {
    if (error instanceof ModuleReleaseError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw Object.assign(new ModuleReleaseError("not_found", "release_not_found", `Release resources missing for ${name}`), { cause: error });
    if (error instanceof StewardError) throw Object.assign(new ModuleReleaseError(error.code === "conflict" ? "conflict" : "invalid", error.code === "conflict" ? "release_drift" : "invalid_release", error.message), { cause: error });
    throw error;
  }
}
