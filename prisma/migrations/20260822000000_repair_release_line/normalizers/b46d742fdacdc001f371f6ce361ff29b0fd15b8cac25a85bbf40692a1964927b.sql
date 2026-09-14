-- The full known legacy development line already has the corrected release-line schema.
-- History rewrite remains fingerprint- and complete-checksum-gated by release-metadata.json.

-- The legacy source has already dropped selectors, so only create the current
-- inspectable archive shape; no retired values remain to capture.
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


-- Management MCP: credentials, durable commands and configuration CAS.
ALTER TABLE "Task" ADD COLUMN "configRevision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "ManagementClient" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenDigest" TEXT NOT NULL,
  "scopes" JSONB NOT NULL,
  "publicUrl" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "defaultMode" TEXT NOT NULL DEFAULT 'plan',
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "ManagementClient_tokenDigest_key" ON "ManagementClient"("tokenDigest");
CREATE INDEX "ManagementClient_workspaceId_idx" ON "ManagementClient"("workspaceId");
CREATE TABLE "ManagementCommand" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clientId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "toolName" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "input" JSONB NOT NULL,
  "taskId" TEXT,
  "workBlockId" TEXT,
  "phase" TEXT NOT NULL DEFAULT 'pending',
  "state" TEXT NOT NULL DEFAULT 'queued',
  "stageData" JSONB,
  "result" JSONB,
  "errorCode" TEXT,
  "leaseOwner" TEXT,
  "leaseUntil" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ManagementCommand_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ManagementClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ManagementCommand_clientId_toolName_requestId_key" ON "ManagementCommand"("clientId", "toolName", "requestId");
CREATE INDEX "ManagementCommand_state_leaseUntil_createdAt_idx" ON "ManagementCommand"("state", "leaseUntil", "createdAt");
CREATE INDEX "ManagementCommand_workspaceId_taskId_createdAt_idx" ON "ManagementCommand"("workspaceId", "taskId", "createdAt");
-- Database-owned counters cover UI, management and calendar writers, including ABA.
CREATE TRIGGER "Task_config_revision" AFTER UPDATE OF "title", "description", "priority", "executionConfig", "aiClientId", "autoPlanGeneration", "autoExecute", "autoPlanGenerationTiming", "autoExecuteTiming", "recurrenceRule", "recurrenceAnchorStartAt", "recurrenceAnchorEndAt", "dueAt", "goalId", "parentTaskId", "definitionStatus" ON "Task"
WHEN OLD."title" IS NOT NEW."title" OR OLD."description" IS NOT NEW."description" OR OLD."priority" IS NOT NEW."priority" OR OLD."executionConfig" IS NOT NEW."executionConfig" OR OLD."aiClientId" IS NOT NEW."aiClientId" OR OLD."autoPlanGeneration" IS NOT NEW."autoPlanGeneration" OR OLD."autoExecute" IS NOT NEW."autoExecute" OR OLD."autoPlanGenerationTiming" IS NOT NEW."autoPlanGenerationTiming" OR OLD."autoExecuteTiming" IS NOT NEW."autoExecuteTiming" OR OLD."recurrenceRule" IS NOT NEW."recurrenceRule" OR OLD."recurrenceAnchorStartAt" IS NOT NEW."recurrenceAnchorStartAt" OR OLD."recurrenceAnchorEndAt" IS NOT NEW."recurrenceAnchorEndAt" OR OLD."dueAt" IS NOT NEW."dueAt" OR OLD."goalId" IS NOT NEW."goalId" OR OLD."parentTaskId" IS NOT NEW."parentTaskId" OR OLD."definitionStatus" IS NOT NEW."definitionStatus"
BEGIN UPDATE "Task" SET "configRevision" = "configRevision" + 1 WHERE "id" = NEW."id"; END;
CREATE TRIGGER "WorkBlock_config_insert" AFTER INSERT ON "WorkBlock"
BEGIN UPDATE "Task" SET "configRevision" = "configRevision" + 1 WHERE "id" = NEW."taskId"; END;
CREATE TRIGGER "WorkBlock_config_delete" AFTER DELETE ON "WorkBlock"
BEGIN UPDATE "Task" SET "configRevision" = "configRevision" + 1 WHERE "id" = OLD."taskId"; END;
CREATE TRIGGER "WorkBlock_config_update" AFTER UPDATE OF "scheduledStartAt", "scheduledEndAt", "taskId" ON "WorkBlock"
WHEN OLD."scheduledStartAt" IS NOT NEW."scheduledStartAt" OR OLD."scheduledEndAt" IS NOT NEW."scheduledEndAt" OR OLD."taskId" IS NOT NEW."taskId"
BEGIN UPDATE "Task" SET "configRevision" = "configRevision" + 1 WHERE "id" IN (NEW."taskId", OLD."taskId"); END;
ALTER TABLE "Task" ADD COLUMN "taskExecutionMode" TEXT NOT NULL DEFAULT 'ai';
