import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { BUILTIN_MODULE_NAMES, OFFICIAL_EXTERNAL_MODULE_NAMES, moduleManifestSchema, type ModuleManifest } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { readModuleFiles } from "./module-preview";
import { StewardError } from "./errors";

export type ModuleRelease = { name: string; origin: "builtin" | "external"; codeDir: string; hash: string; manifest: ModuleManifest };
export class ModuleReleaseError extends StewardError {
  constructor(code: "not_found" | "invalid" | "forbidden" | "conflict", public readonly reason: "release_not_found" | "invalid_release" | "release_drift", message: string) { super(code, message); }
}
/** Host-configured resources only. Neither a manifest nor a routed request can supply the root. */
async function resolveRelease(rootPath: string | undefined, name: string, origin: ModuleRelease["origin"], expectedHash?: string): Promise<ModuleRelease> {
  const names: readonly string[] = origin === "builtin" ? BUILTIN_MODULE_NAMES : OFFICIAL_EXTERNAL_MODULE_NAMES;
  if (!names.includes(name)) throw new ModuleReleaseError("not_found", "release_not_found", `Unknown ${origin} release ${name}`);
  if (!rootPath) throw new ModuleReleaseError("not_found", "release_not_found", `${origin} release resources are not configured`);
  try {
    const root = await realpath(rootPath), codeDir = join(root, name), stat = await lstat(codeDir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !(await realpath(codeDir)).startsWith(root + sep)) throw new ModuleReleaseError("forbidden", "invalid_release", "Unsafe release directory");
    const files = (await readModuleFiles(codeDir, "Unsafe release file")).sort((a, b) => a.path.localeCompare(b.path));
    const file = files.find(file => file.path === "module.json");
    if (!file) throw new ModuleReleaseError("invalid", "invalid_release", "Release manifest missing");
    let raw: unknown;
    try { raw = JSON.parse(file.bytes.toString("utf8")); } catch { throw new ModuleReleaseError("invalid", "invalid_release", "Release manifest is not JSON"); }
    const parsed = moduleManifestSchema.safeParse(raw);
    if (!parsed.success || parsed.data.name !== name) throw new ModuleReleaseError("invalid", "invalid_release", "Release manifest mismatch");
    const digest = createHash("sha256");
    for (const file of files) digest.update(file.path).update("\0").update(file.bytes).update("\0");
    const hash = digest.digest("hex");
    if (expectedHash !== undefined && expectedHash !== hash) throw new ModuleReleaseError("conflict", "release_drift", "Release contents differ from the registered hash");
    return { name, origin, codeDir, hash, manifest: parsed.data };
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
