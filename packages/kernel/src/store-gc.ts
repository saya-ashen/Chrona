import { Prisma } from "@chrona/db";
import { join } from "node:path";
import { collectMaterialObjects, withMaterialPublication } from "./modules/module-artifacts";
import { sweepModuleDirectories } from "./modules/module-files";
import { moduleSupervisor } from "./modules/module-supervisor";
import type { StewardPorts } from "./ports";

const DAY_MS = 24 * 3600_000;
const VERSION_RETENTION_MS = 30 * DAY_MS;
const MAX_VERSIONS = 200;
const passes = new WeakMap<StewardPorts["db"], number>();

async function expireVersions(db: StewardPorts["db"], cutoff: Date, live: Set<string>) {
  return db.$executeRaw(Prisma.sql`DELETE FROM "ModuleVersion" WHERE "id" IN (
    SELECT v."id" FROM "ModuleVersion" v JOIN "Module" m ON m."id" = v."moduleId"
    WHERE v."createdAt" < ${cutoff} AND v."status" IN ('approved', 'rejected', 'cancelled', 'failed')
      AND v."hash" IS NOT m."activeHash"
      ${live.size ? Prisma.sql`AND v."hash" NOT IN (${Prisma.join([...live])})` : Prisma.empty}
      AND NOT EXISTS (SELECT 1 FROM "ModuleMigration" g WHERE m."status" = 'migrating'
        AND g."moduleId" = v."moduleId" AND g."hash" = v."hash")
      AND v."hash" IS NOT (SELECT a."previousHash" FROM "ModuleActivation" a
        WHERE a."moduleId" = m."id" AND a."candidateHash" = m."activeHash"
        ORDER BY a."createdAt" DESC, a."activationId" DESC LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM "CandidateMember" b JOIN "CandidateReceipt" r ON r."id" = b."receiptId"
        WHERE b."versionId" = v."id" AND r."state" NOT IN ('approved', 'rejected'))
      AND NOT EXISTS (SELECT 1 FROM "ModuleInstallation" i WHERE i."workspaceId" = m."workspaceId"
        AND i."package" = m."name" AND i."hash" = v."hash" AND (i."moduleId" IS NULL OR i."moduleId" = m."id")
        AND i."status" IN ('pending', 'building', 'pending_approval'))
      AND NOT EXISTS (SELECT 1 FROM "ModuleInstallationSubmission" s JOIN "ModuleInstallation" i ON i."id" = s."installationId"
        WHERE i."status" = 'pending' AND i."workspaceId" = m."workspaceId" AND i."package" = m."name"
        AND s."hash" = v."hash" AND (s."moduleId" IS NULL OR s."moduleId" = m."id") AND s."phase" IN ('proposing', 'submitted')
        AND (s."existingVersionId" = v."id" OR EXISTS (
          SELECT 1 FROM json_each(v."intent", '$.changes') change WHERE change.value = s."marker")))
      AND NOT EXISTS (SELECT 1 FROM "Approval" p WHERE p."moduleId" = m."id" AND p."action" = 'activate_module'
        AND json_extract(p."payload", '$.hash') = v."hash"
        AND (p."status" = 'open' OR (p."status" = 'approved' AND p."resolvedAt" IS NOT NULL
          AND json_type(p."payload", '$.restore') = 'object' AND NOT EXISTS (
            SELECT 1 FROM "ModuleActivation" a WHERE a."moduleId" = m."id" AND a."createdAt" > p."resolvedAt"))))
    ORDER BY v."createdAt", v."id" LIMIT ${MAX_VERSIONS})`);
}

export async function collectStore(ports: StewardPorts, now: Date) {
  const at = now.getTime(), prior = passes.get(ports.db);
  if (prior !== undefined && at - prior < DAY_MS) return;
  passes.set(ports.db, at);
  const platform = join(ports.dataDir, "platform");
  return withMaterialPublication(platform, async () => {
    const live = moduleSupervisor(ports).liveHashes();
    const versionsRemoved = await expireVersions(ports.db, new Date(at - VERSION_RETENTION_MS), live);
    const [versions, modules] = await Promise.all([
      ports.db.moduleVersion.findMany({ distinct: ["hash"], select: { hash: true } }),
      ports.db.module.findMany({ where: { activeHash: { not: null } }, select: { activeHash: true } }),
    ]);
    const retained = new Set([...live, ...versions.map(version => version.hash)]);
    for (const module of modules) retained.add(module.activeHash!);
    const checkoutsRemoved = await sweepModuleDirectories(platform, "store", retained);
    const result = { versionsRemoved, checkoutsRemoved, ...await collectMaterialObjects(platform, retained) };
    if (Object.values(result).some(Boolean)) console.info(JSON.stringify({ component: "store-gc", event: "store_gc.collected", ...result }));
    return result;
  });
}
