import { join } from "node:path";
import type { ModuleManifest } from "@chrona/contracts/steward";
import { dataEmpty } from "../module-data";
import type { ModuleContext, ContinuityReport, requireModule } from "../module-context";
import { assertBuildOwnership } from "./module-build-ownership";

export async function checkContinuity(context: ModuleContext, staging: string, module: Awaited<ReturnType<typeof requireModule>>, manifest: ModuleManifest, continuity: ContinuityReport) {
  assertBuildOwnership(context, staging);
  const from = module.dataSchema, to = manifest.data.schema;
  let empty: boolean;
  try { empty = await dataEmpty(join(context.platform, "data", module.id)); }
  catch (error) {
    console.error(JSON.stringify({ component: "module-build", event: "data.check_failed", moduleId: module.id, error: String(error) }));
    continuity.status = "failed"; continuity.reason = "Module data directory is unavailable or unsafe";
    return { passed: false, needsMigration: false };
  }
  const needsMigration = from !== null && to > from && !empty;
  const reason = from !== null && to < from ? "schema 不能降低；降级只能经回滚"
    : needsMigration && !manifest.data.migrate ? "schema 升级需要 migrate" : null;
  continuity.status = reason ? "failed" : "skipped";
  continuity.reason = reason ?? "Application checks belong to the application; migration runs only after approval";
  return { passed: !reason, needsMigration };
}
