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
-- Phase 2A: existing tasks retain the AI default when this known checksum upgrades.
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
