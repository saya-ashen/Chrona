import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ModuleManifest } from "@chrona/contracts/steward";
import type { ModuleContext } from "../module-context";
import { assertBuildOwnership, holdBuildOwnership } from "./module-build-ownership";

function requiredHostPrograms(manifest: Pick<ModuleManifest, "entry" | "packages">) {
  return [...new Set([...manifest.packages, ...(typeof manifest.entry === "object" && manifest.entry.runtime ? [manifest.entry.runtime] : [])])];
}

/** Lockfile libraries and system programs go into the staging copy before anything runs it. */
export async function installDependencies(context: ModuleContext, staging: string, manifest: ModuleManifest) {
  const packages = requiredHostPrograms(manifest);
  if (!packages.length && !existsSync(join(staging, "package.json")) && !existsSync(join(staging, "pyproject.toml"))) return null;
  if (!context.ports.packages) return { errors: ["Dependency installation is not available on this host"], installed: { npm: false, python: false, packages: {} } };
  assertBuildOwnership(context, staging);
  try { return await context.ports.packages.install({ dir: staging, packages }); }
  catch (error) { holdBuildOwnership(context, staging, error); throw error; }
}
