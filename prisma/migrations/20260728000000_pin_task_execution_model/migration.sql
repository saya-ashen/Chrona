-- Add stable logical descriptions for Goal assets and backfill from current Artifact metadata.
ALTER TABLE "GoalAsset" ADD COLUMN "description" TEXT;
UPDATE "GoalAsset"
SET "description" = COALESCE(
  json_extract((SELECT "metadata" FROM "Artifact" WHERE "Artifact"."id" = "GoalAsset"."currentArtifactId"), '$.description'),
  json_extract((SELECT "metadata" FROM "Artifact" WHERE "Artifact"."id" = "GoalAsset"."currentArtifactId"), '$.summary')
)
WHERE "description" IS NULL;

-- Normalize nullable work-block scope and prevent duplicate plan runs.
ALTER TABLE "TaskPlanRun" ADD COLUMN "workBlockScopeKey" TEXT NOT NULL DEFAULT '';
UPDATE "TaskPlanRun" SET "workBlockScopeKey" = COALESCE("workBlockId", '');
ALTER TABLE "TaskPlanRun" ADD COLUMN "executionCommandKey" TEXT;
DROP INDEX IF EXISTS "TaskPlanRun_taskId_planId_workBlockId_key";
CREATE UNIQUE INDEX "TaskPlanRun_taskId_planId_workBlockScopeKey_key" ON "TaskPlanRun"("taskId", "planId", "workBlockScopeKey");

-- Collapse legacy duplicate live sessions before enforcing one live owner per Task.
ALTER TABLE "ExecutionSession" ADD COLUMN "activeScopeKey" TEXT;
UPDATE "ExecutionSession" SET "activeScopeKey" = 'active' WHERE "status" IN ('Active', 'Paused');
UPDATE "ExecutionSession"
SET "status" = 'Abandoned',
    "activeScopeKey" = NULL,
    "completedAt" = COALESCE("completedAt", CURRENT_TIMESTAMP)
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (
      PARTITION BY "taskId", "activeScopeKey"
      ORDER BY "updatedAt" DESC, "id" DESC
    ) AS "rowNumber"
    FROM "ExecutionSession"
    WHERE "activeScopeKey" = 'active'
  ) WHERE "rowNumber" > 1
);
CREATE UNIQUE INDEX "ExecutionSession_taskId_activeScopeKey_key" ON "ExecutionSession"("taskId", "activeScopeKey");

-- Scope persisted Task sessions for safe tool-mutation authorization.
ALTER TABLE "TaskSession" ADD COLUMN "capabilityScope" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "TaskSession" ADD COLUMN "allowedToolNames" TEXT NOT NULL DEFAULT '[]';

-- Persist scoped MCP tool-mutation idempotency across process restarts.
CREATE TABLE "AgentToolMutation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "taskId" TEXT,
  "taskSessionId" TEXT,
  "runId" TEXT,
  "taskScopeKey" TEXT NOT NULL DEFAULT '',
  "taskSessionScopeKey" TEXT NOT NULL DEFAULT '',
  "runScopeKey" TEXT NOT NULL DEFAULT '',
  "nodeScopeKey" TEXT NOT NULL DEFAULT '',
  "toolName" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'claimed',
  "result" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AgentToolMutation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AgentToolMutation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AgentToolMutation_taskSessionId_fkey" FOREIGN KEY ("taskSessionId") REFERENCES "TaskSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AgentToolMutation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentToolMutation_workspaceId_taskScopeKey_taskSessionScopeKey_runScopeKey_nodeScopeKey_toolName_idempotencyKey_key"
  ON "AgentToolMutation"("workspaceId", "taskScopeKey", "taskSessionScopeKey", "runScopeKey", "nodeScopeKey", "toolName", "idempotencyKey");
CREATE INDEX "AgentToolMutation_taskId_createdAt_idx" ON "AgentToolMutation"("taskId", "createdAt");
CREATE INDEX "AgentToolMutation_taskSessionId_createdAt_idx" ON "AgentToolMutation"("taskSessionId", "createdAt");
CREATE INDEX "AgentToolMutation_runId_createdAt_idx" ON "AgentToolMutation"("runId", "createdAt");

-- Preserve an auditable digest when raw event records are retained externally.
CREATE TABLE "EventRetentionArchive" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "source" TEXT NOT NULL,
  "cutoffAt" DATETIME NOT NULL,
  "recordCount" INTEGER NOT NULL,
  "firstRecordId" TEXT NOT NULL,
  "lastRecordId" TEXT NOT NULL,
  "firstRecordedAt" DATETIME NOT NULL,
  "lastRecordedAt" DATETIME NOT NULL,
  "checksum" TEXT NOT NULL,
  "checksumAlgorithm" TEXT NOT NULL DEFAULT 'sha256',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "EventRetentionArchive_source_cutoffAt_idx" ON "EventRetentionArchive"("source", "cutoffAt");
CREATE INDEX "EventRetentionArchive_source_createdAt_idx" ON "EventRetentionArchive"("source", "createdAt");

-- Track explicit content verification independently from metadata edits.
CREATE TABLE "GoalAssetReview" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "goalId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "verifiedAt" DATETIME NOT NULL,
  "nextReviewAt" DATETIME,
  "summary" TEXT,
  "authorType" TEXT NOT NULL,
  "sourceTaskId" TEXT,
  "sourceRunId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoalAssetReview_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GoalAssetReview_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GoalAssetReview_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "GoalAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GoalAssetReview_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "GoalAssetVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GoalAssetReview_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "GoalAssetReview_assetId_verifiedAt_idx" ON "GoalAssetReview"("assetId", "verifiedAt");
CREATE INDEX "GoalAssetReview_versionId_verifiedAt_idx" ON "GoalAssetReview"("versionId", "verifiedAt");
CREATE INDEX "GoalAssetReview_goalId_nextReviewAt_idx" ON "GoalAssetReview"("goalId", "nextReviewAt");
