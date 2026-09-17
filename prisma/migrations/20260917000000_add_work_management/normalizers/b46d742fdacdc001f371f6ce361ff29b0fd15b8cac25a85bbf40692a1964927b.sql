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

-- Goal editing: persistent CAS across MCP, UI and all canonical writers.
ALTER TABLE "Goal" ADD COLUMN "configRevision" INTEGER NOT NULL DEFAULT 1;
CREATE TRIGGER "Goal_config_update" AFTER UPDATE OF
  "title", "description", "operationalBrief", "successCriteria", "status",
  "nextReviewAt", "achievementConfirmation", "workspaceId" ON "Goal"
WHEN OLD."title" IS NOT NEW."title" OR OLD."description" IS NOT NEW."description"
  OR OLD."operationalBrief" IS NOT NEW."operationalBrief" OR OLD."successCriteria" IS NOT NEW."successCriteria"
  OR OLD."status" IS NOT NEW."status" OR OLD."nextReviewAt" IS NOT NEW."nextReviewAt"
  OR OLD."achievementConfirmation" IS NOT NEW."achievementConfirmation" OR OLD."workspaceId" IS NOT NEW."workspaceId"
BEGIN UPDATE "Goal" SET "configRevision" = OLD."configRevision" + 1 WHERE "id" = NEW."id"; END;

-- Work-owned result foundation (B1).
-- CreateTable
CREATE TABLE "TaskResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "occurrenceId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "headVersionId" TEXT,
    "acceptedVersionId" TEXT,
    "editRevision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskResult_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskResult_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskResult_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "TaskOccurrence" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "TaskResult_headVersionId_id_fkey" FOREIGN KEY ("headVersionId", "id") REFERENCES "TaskResultVersion" ("id", "resultId") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "TaskResult_acceptedVersionId_id_fkey" FOREIGN KEY ("acceptedVersionId", "id") REFERENCES "TaskResultVersion" ("id", "resultId") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "TaskResultVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resultId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "parentVersionId" TEXT,
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "actorKey" TEXT NOT NULL,
    "sourceLabel" TEXT,
    "sourceWorkId" TEXT,
    "sourceReportedAt" DATETIME,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskResultVersion_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "TaskResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskResultVersion_parentVersionId_resultId_fkey" FOREIGN KEY ("parentVersionId", "resultId") REFERENCES "TaskResultVersion" ("id", "resultId") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "ResultCommand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "actorKey" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "receipt" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResultCommand_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "TaskResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResultCommand_versionId_resultId_fkey" FOREIGN KEY ("versionId", "resultId") REFERENCES "TaskResultVersion" ("id", "resultId") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "TaskResultReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resultId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "feedback" TEXT,
    "actorKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskResultReview_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "TaskResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskResultReview_versionId_resultId_fkey" FOREIGN KEY ("versionId", "resultId") REFERENCES "TaskResultVersion" ("id", "resultId") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "TaskResultReview_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "ResultCommand" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResultVersionArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "artifactRef" TEXT NOT NULL,
    "artifactFingerprint" TEXT NOT NULL,
    CONSTRAINT "ResultVersionArtifact_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "TaskResultVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResultVersionArtifact_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TaskResult_workspaceId_updatedAt_idx" ON "TaskResult"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "TaskResult_occurrenceId_idx" ON "TaskResult"("occurrenceId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskResult_taskId_scopeKey_key" ON "TaskResult"("taskId", "scopeKey");

-- CreateIndex
CREATE UNIQUE INDEX "TaskResultVersion_resultId_version_key" ON "TaskResultVersion"("resultId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TaskResultVersion_id_resultId_key" ON "TaskResultVersion"("id", "resultId");

-- CreateIndex
CREATE INDEX "ResultCommand_resultId_createdAt_idx" ON "ResultCommand"("resultId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResultCommand_workspaceId_actorKey_operation_requestId_key" ON "ResultCommand"("workspaceId", "actorKey", "operation", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskResultReview_commandId_key" ON "TaskResultReview"("commandId");

-- CreateIndex
CREATE INDEX "TaskResultReview_versionId_revision_idx" ON "TaskResultReview"("versionId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "TaskResultReview_resultId_revision_key" ON "TaskResultReview"("resultId", "revision");

-- CreateIndex
CREATE INDEX "ResultVersionArtifact_artifactId_idx" ON "ResultVersionArtifact"("artifactId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultVersionArtifact_versionId_role_key_key" ON "ResultVersionArtifact"("versionId", "role", "key");


-- B1: database-enforced result identity, append-only versions and receipt history.
CREATE TRIGGER "TaskResult_scope_insert" BEFORE INSERT ON "TaskResult"
WHEN NEW."scopeKey" != CASE WHEN NEW."occurrenceId" IS NULL THEN 'task' ELSE 'occurrence:' || NEW."occurrenceId" END
 OR NEW."editRevision" != 0 OR NEW."headVersionId" IS NOT NULL OR NEW."acceptedVersionId" IS NOT NULL
 OR NOT EXISTS (SELECT 1 FROM "Task" WHERE "id" = NEW."taskId" AND "workspaceId" = NEW."workspaceId")
 OR (NEW."occurrenceId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "TaskOccurrence" WHERE "id" = NEW."occurrenceId" AND "taskId" = NEW."taskId" AND "workspaceId" = NEW."workspaceId"))
BEGIN SELECT RAISE(ABORT, 'Invalid result scope'); END;

CREATE TRIGGER "TaskResult_scope_update" BEFORE UPDATE ON "TaskResult"
WHEN NEW."id" IS NOT OLD."id" OR NEW."workspaceId" IS NOT OLD."workspaceId" OR NEW."taskId" IS NOT OLD."taskId"
 OR NEW."occurrenceId" IS NOT OLD."occurrenceId" OR NEW."scopeKey" IS NOT OLD."scopeKey" OR NEW."createdAt" IS NOT OLD."createdAt"
 OR NEW."editRevision" != OLD."editRevision" + 1
BEGIN SELECT RAISE(ABORT, 'Result identity is immutable and revision must advance'); END;

CREATE TRIGGER "TaskResult_head_update" BEFORE UPDATE OF "headVersionId" ON "TaskResult"
WHEN NEW."headVersionId" IS NOT OLD."headVersionId" AND NOT EXISTS (
 SELECT 1 FROM "TaskResultVersion" v WHERE v."id" = NEW."headVersionId" AND v."resultId" = OLD."id"
 AND v."parentVersionId" IS OLD."headVersionId"
 AND v."version" = COALESCE((SELECT "version" FROM "TaskResultVersion" WHERE "id" = OLD."headVersionId"), 0) + 1)
BEGIN SELECT RAISE(ABORT, 'Result head must advance one version'); END;

CREATE TRIGGER "TaskResult_accept_update" BEFORE UPDATE OF "acceptedVersionId" ON "TaskResult"
WHEN NEW."acceptedVersionId" IS NOT OLD."acceptedVersionId" AND
 (NEW."acceptedVersionId" IS NULL OR NEW."acceptedVersionId" IS NOT NEW."headVersionId" OR NOT EXISTS (
 SELECT 1 FROM "TaskResultReview" WHERE "resultId" = OLD."id" AND "versionId" = NEW."acceptedVersionId" AND "decision" = 'accept'))
BEGIN SELECT RAISE(ABORT, 'Acceptance requires a review of the head version'); END;

CREATE TRIGGER "TaskResultVersion_insert" BEFORE INSERT ON "TaskResultVersion"
WHEN NEW."sourceKind" NOT IN ('human', 'external', 'managed') OR NEW."version" < 1 OR length(NEW."actorKey") NOT BETWEEN 1 AND 200
 OR length(NEW."contentHash") != 64 OR NOT json_valid(NEW."content") OR length(CAST(NEW."content" AS BLOB)) > 98304
 OR NOT EXISTS (SELECT 1 FROM "TaskResult" r WHERE r."id" = NEW."resultId" AND NEW."parentVersionId" IS r."headVersionId"
 AND NEW."version" = COALESCE((SELECT "version" FROM "TaskResultVersion" WHERE "id" = r."headVersionId"), 0) + 1)
BEGIN SELECT RAISE(ABORT, 'Invalid result version'); END;
CREATE TRIGGER "TaskResultVersion_immutable" BEFORE UPDATE ON "TaskResultVersion"
BEGIN SELECT RAISE(ABORT, 'Published result versions are immutable'); END;
CREATE TRIGGER "TaskResultVersion_delete" BEFORE DELETE ON "TaskResultVersion"
WHEN EXISTS (SELECT 1 FROM "TaskResult" WHERE "id" = OLD."resultId")
BEGIN SELECT RAISE(ABORT, 'Delete the owning result, not a published version'); END;

CREATE TRIGGER "ResultCommand_insert" BEFORE INSERT ON "ResultCommand"
WHEN NEW."operation" NOT IN ('publish', 'review') OR NOT json_valid(NEW."receipt") OR length(CAST(NEW."receipt" AS BLOB)) > 4096
 OR NOT EXISTS (SELECT 1 FROM "TaskResult" WHERE "id" = NEW."resultId" AND "workspaceId" = NEW."workspaceId")
BEGIN SELECT RAISE(ABORT, 'Invalid result command'); END;
CREATE TRIGGER "ResultCommand_immutable" BEFORE UPDATE ON "ResultCommand"
BEGIN SELECT RAISE(ABORT, 'Result receipts are immutable'); END;
CREATE TRIGGER "ResultCommand_delete" BEFORE DELETE ON "ResultCommand"
WHEN EXISTS (SELECT 1 FROM "TaskResult" WHERE "id" = OLD."resultId")
BEGIN SELECT RAISE(ABORT, 'Delete the owning result, not its command receipt'); END;

CREATE TRIGGER "TaskResultReview_insert" BEFORE INSERT ON "TaskResultReview"
WHEN NEW."decision" NOT IN ('accept', 'request_changes', 'reject') OR length(NEW."feedback") > 8000
 OR NOT EXISTS (SELECT 1 FROM "TaskResult" WHERE "id" = NEW."resultId" AND "headVersionId" = NEW."versionId" AND NEW."revision" = "editRevision" + 1)
 OR NOT EXISTS (SELECT 1 FROM "ResultCommand" WHERE "id" = NEW."commandId" AND "resultId" = NEW."resultId"
 AND "versionId" = NEW."versionId" AND "actorKey" = NEW."actorKey" AND "operation" = 'review')
BEGIN SELECT RAISE(ABORT, 'Invalid version review'); END;
CREATE TRIGGER "TaskResultReview_immutable" BEFORE UPDATE ON "TaskResultReview"
BEGIN SELECT RAISE(ABORT, 'Result reviews are immutable'); END;
CREATE TRIGGER "TaskResultReview_delete" BEFORE DELETE ON "TaskResultReview"
WHEN EXISTS (SELECT 1 FROM "TaskResult" WHERE "id" = OLD."resultId")
BEGIN SELECT RAISE(ABORT, 'Delete the owning result, not its review history'); END;

-- A version's links can be inserted only before that version becomes the head.
CREATE TRIGGER "ResultVersionArtifact_insert" BEFORE INSERT ON "ResultVersionArtifact"
WHEN NEW."role" NOT IN ('deliverable', 'evidence') OR length(NEW."artifactFingerprint") != 64 OR NOT EXISTS (
 SELECT 1 FROM "TaskResultVersion" v JOIN "TaskResult" r ON r."id" = v."resultId"
 JOIN "Artifact" a ON a."id" = NEW."artifactId" JOIN "Run" run ON run."id" = a."runId"
 WHERE v."id" = NEW."versionId" AND v."parentVersionId" IS r."headVersionId" AND v."id" IS NOT r."headVersionId"
 AND a."workspaceId" = r."workspaceId" AND a."taskId" = r."taskId" AND a."occurrenceId" IS r."occurrenceId"
 AND run."taskId" = r."taskId" AND run."occurrenceId" IS r."occurrenceId"
 AND (r."occurrenceId" IS NOT NULL OR run."workBlockId" IS NULL))
BEGIN SELECT RAISE(ABORT, 'Invalid or sealed result artifact binding'); END;
CREATE TRIGGER "ResultVersionArtifact_immutable" BEFORE UPDATE ON "ResultVersionArtifact"
BEGIN SELECT RAISE(ABORT, 'Result artifact bindings are immutable'); END;
CREATE TRIGGER "ResultVersionArtifact_delete" BEFORE DELETE ON "ResultVersionArtifact"
WHEN EXISTS (SELECT 1 FROM "TaskResultVersion" v JOIN "TaskResult" r ON r."id" = v."resultId" WHERE v."id" = OLD."versionId")
BEGIN SELECT RAISE(ABORT, 'Delete the owning result, not a version artifact binding'); END;

CREATE TRIGGER "Task_result_scope_guard" BEFORE UPDATE OF "workspaceId" ON "Task"
WHEN NEW."workspaceId" IS NOT OLD."workspaceId" AND EXISTS (SELECT 1 FROM "TaskResult" WHERE "taskId" = OLD."id")
BEGIN SELECT RAISE(ABORT, 'Cannot move a task with scoped results'); END;
CREATE TRIGGER "TaskOccurrence_result_scope_guard" BEFORE UPDATE OF "workspaceId", "taskId" ON "TaskOccurrence"
WHEN (NEW."workspaceId" IS NOT OLD."workspaceId" OR NEW."taskId" IS NOT OLD."taskId") AND EXISTS (SELECT 1 FROM "TaskResult" WHERE "occurrenceId" = OLD."id")
BEGIN SELECT RAISE(ABORT, 'Cannot move an occurrence with scoped results'); END;
