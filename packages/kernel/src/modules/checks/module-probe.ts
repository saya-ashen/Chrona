import { assertBuildOwnership, buildOwnershipError, holdBuildOwnership } from "./module-build-ownership";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ModuleManifest } from "@chrona/contracts/steward";
import { checkBuildStartup } from "./module-build-process";
import type { ModuleContext } from "../module-context";

/** Loading and SDK connection only; business handlers require module-owned tests and fixtures. */
export async function smokeRun(context: ModuleContext, staging: string, manifest: ModuleManifest) {
  assertBuildOwnership(context, staging);
  const data = await mkdtemp(join(tmpdir(), "chrona-module-smoke-"));
  try {
    await checkBuildStartup(context, staging, data, manifest);
    return [];
  } catch (error) {
    if (holdBuildOwnership(context, staging, error)) throw error;
    return ["Module startup or SDK connection failed"];
  } finally { if (!buildOwnershipError(context, staging)) await rm(data, { recursive: true, force: true }); }
}
