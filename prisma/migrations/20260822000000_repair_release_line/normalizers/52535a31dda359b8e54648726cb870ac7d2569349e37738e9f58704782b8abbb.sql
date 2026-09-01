-- Normalize the known pre-amendment mutable release line before its history is collapsed.
-- This exact source retained legacy task/workspace runtime selectors.
ALTER TABLE "TaskSession" ADD COLUMN "providerClientId" TEXT;
ALTER TABLE "TaskSession" ADD COLUMN "providerName" TEXT;
ALTER TABLE "TaskSession" ADD COLUMN "providerConfigFingerprint" TEXT;
ALTER TABLE "Run" ADD COLUMN "providerClientId" TEXT;
ALTER TABLE "Run" ADD COLUMN "providerName" TEXT;
ALTER TABLE "Run" ADD COLUMN "providerConfigFingerprint" TEXT;
ALTER TABLE "TaskPlanProviderRun" ADD COLUMN "providerName" TEXT;

-- Archive every retired selector before removing it. These records preserve
-- historical configuration without granting it provider-selection authority.
CREATE TABLE "LegacyRuntimeSelectorArchive" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "legacyRuntime" TEXT NOT NULL,
    "sourceMigration" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "LegacyRuntimeSelectorArchive_entityType_entityId_sourceMigration_key"
  ON "LegacyRuntimeSelectorArchive"("entityType", "entityId", "sourceMigration");
CREATE INDEX "LegacyRuntimeSelectorArchive_workspaceId_capturedAt_idx"
  ON "LegacyRuntimeSelectorArchive"("workspaceId", "capturedAt");
INSERT INTO "LegacyRuntimeSelectorArchive" (
  "id", "entityType", "entityId", "workspaceId", "legacyRuntime", "sourceMigration"
)
SELECT
  'legacy-runtime-selector:task:' || "id", 'task', "id", "workspaceId", "executionRuntime",
  '20260822000000_repair_release_line'
FROM "Task";
INSERT INTO "LegacyRuntimeSelectorArchive" (
  "id", "entityType", "entityId", "workspaceId", "legacyRuntime", "sourceMigration"
)
SELECT
  'legacy-runtime-selector:workspace:' || "id", 'workspace', "id", "id", "defaultRuntime",
  '20260822000000_repair_release_line'
FROM "Workspace";
ALTER TABLE "Task" DROP COLUMN "executionRuntime";
ALTER TABLE "Workspace" DROP COLUMN "defaultRuntime";

-- Align TaskPlanRun nullability and indexes with prisma/schema.prisma.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TaskPlanRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionScopeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workBlockId" TEXT,
    "workBlockScopeKey" TEXT NOT NULL DEFAULT '',
    "occurrenceId" TEXT,
    "planId" TEXT NOT NULL,
    "planRun" JSONB NOT NULL,
    "executionOwnerId" TEXT,
    "executionOwnerScope" TEXT,
    "executionLeaseUntil" DATETIME,
    "executionEpoch" INTEGER NOT NULL DEFAULT 0,
    "latestEventId" TEXT,
    "latestRawEventId" TEXT,
    "latestEventSequence" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskPlanRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanRun_workBlockId_fkey" FOREIGN KEY ("workBlockId") REFERENCES "WorkBlock" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanRun_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TaskPlan" ("planId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanRun_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "TaskOccurrence" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TaskPlanRun" ("createdAt", "executionEpoch", "executionLeaseUntil", "executionOwnerId", "executionOwnerScope", "executionScopeId", "id", "latestEventId", "latestEventSequence", "latestRawEventId", "occurrenceId", "planId", "planRun", "taskId", "updatedAt", "workBlockId", "workBlockScopeKey", "workspaceId") SELECT "createdAt", "executionEpoch", "executionLeaseUntil", "executionOwnerId", "executionOwnerScope", "executionScopeId", "id", "latestEventId", "latestEventSequence", "latestRawEventId", "occurrenceId", "planId", "planRun", "taskId", "updatedAt", "workBlockId", "workBlockScopeKey", "workspaceId" FROM "TaskPlanRun";
DROP TABLE "TaskPlanRun";
ALTER TABLE "new_TaskPlanRun" RENAME TO "TaskPlanRun";
CREATE UNIQUE INDEX "TaskPlanRun_executionScopeId_key" ON "TaskPlanRun"("executionScopeId");
CREATE INDEX "TaskPlanRun_taskId_planId_executionOwnerId_idx" ON "TaskPlanRun"("taskId", "planId", "executionOwnerId");
CREATE INDEX "TaskPlanRun_taskId_workBlockId_planId_idx" ON "TaskPlanRun"("taskId", "workBlockId", "planId");
CREATE INDEX "TaskPlanRun_taskId_planId_workBlockScopeKey_idx" ON "TaskPlanRun"("taskId", "planId", "workBlockScopeKey");
CREATE INDEX "TaskPlanRun_executionLeaseUntil_idx" ON "TaskPlanRun"("executionLeaseUntil");
CREATE INDEX "TaskPlanRun_workspaceId_taskId_updatedAt_idx" ON "TaskPlanRun"("workspaceId", "taskId", "updatedAt");
CREATE INDEX "TaskPlanRun_occurrenceId_updatedAt_idx" ON "TaskPlanRun"("occurrenceId", "updatedAt");
CREATE UNIQUE INDEX "TaskPlanRun_taskId_planId_workBlockScopeKey_key" ON "TaskPlanRun"("taskId", "planId", "workBlockScopeKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

