-- Mutable 0.3.0 release-line repair: consolidates every unreleased schema change after public v0.2.0.


-- Folded from prisma/migrations/20260719000000_add_long_horizon_goals/migration.sql
-- Phase 3 long-horizon Goal aggregate. Goal owns durable outcome state while
-- bounded Tasks continue to own all plans, runs, sessions, and artifacts.
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "successCriteria" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "nextReviewAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "achievedAt" DATETIME,
    "stoppedAt" DATETIME,
    CONSTRAINT "Goal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "Task" ADD COLUMN "goalId" TEXT REFERENCES "Goal" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "GoalAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "sourceArtifactId" TEXT NOT NULL,
    "currentArtifactId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoalAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAsset_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAsset_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "Artifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GoalAsset_currentArtifactId_fkey" FOREIGN KEY ("currentArtifactId") REFERENCES "Artifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Goal_workspaceId_status_idx" ON "Goal"("workspaceId", "status");
CREATE INDEX "Goal_workspaceId_updatedAt_idx" ON "Goal"("workspaceId", "updatedAt");
CREATE INDEX "Task_goalId_idx" ON "Task"("goalId");
CREATE UNIQUE INDEX "GoalAsset_goalId_sourceArtifactId_key" ON "GoalAsset"("goalId", "sourceArtifactId");
CREATE INDEX "GoalAsset_workspaceId_goalId_idx" ON "GoalAsset"("workspaceId", "goalId");
CREATE INDEX "GoalAsset_sourceArtifactId_idx" ON "GoalAsset"("sourceArtifactId");
CREATE INDEX "GoalAsset_currentArtifactId_idx" ON "GoalAsset"("currentArtifactId");


-- Folded from prisma/migrations/20260720000000_add_goal_achievement_confirmation/migration.sql
-- Retain evidence-backed, actor-confirmed Goal achievement details separately
-- from the lifecycle status and success-criterion snapshot.
ALTER TABLE "Goal" ADD COLUMN "achievementConfirmation" JSONB;


-- Folded from prisma/migrations/20260720010000_add_goal_workbench/migration.sql
-- Goal Workbench stores explicit, user-visible cross-Task context while all
-- provider execution remains owned by bounded Tasks.
ALTER TABLE "Goal" ADD COLUMN "operationalBrief" JSONB;
ALTER TABLE "Task" ADD COLUMN "goalContext" JSONB;
ALTER TABLE "Goal" ADD COLUMN "titleSource" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "Goal" ADD COLUMN "titleRenameNoticeSeenAt" DATETIME;

CREATE TABLE "GoalWorkingSetItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoalWorkingSetItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalWorkingSetItem_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "GoalBriefRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "brief" JSONB NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoalBriefRevision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalBriefRevision_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "GoalWorkingSetItem_goalId_subjectType_subjectId_key" ON "GoalWorkingSetItem"("goalId", "subjectType", "subjectId");
CREATE INDEX "GoalWorkingSetItem_workspaceId_goalId_rank_idx" ON "GoalWorkingSetItem"("workspaceId", "goalId", "rank");
CREATE INDEX "GoalBriefRevision_goalId_createdAt_idx" ON "GoalBriefRevision"("goalId", "createdAt");
CREATE INDEX "GoalBriefRevision_workspaceId_goalId_idx" ON "GoalBriefRevision"("workspaceId", "goalId");

-- CreateTable
CREATE TABLE "GoalAssetVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "artifactId" TEXT,
    "version" INTEGER NOT NULL,
    "parentVersionId" TEXT,
    "source" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "mimeType" TEXT,
    "originalFilename" TEXT,
    "changeSummary" TEXT,
    "sourceTaskId" TEXT,
    "sourceRunId" TEXT,
    "sourceResultId" TEXT,
    "selector" JSONB,
    "authorType" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoalAssetVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetVersion_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetVersion_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "GoalAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetVersion_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetVersion_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetVersion_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "GoalAssetVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoalAssetDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "baseVersionId" TEXT NOT NULL,
    "conflictVersionId" TEXT,
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "authorType" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoalAssetDraft_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetDraft_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetDraft_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "GoalAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetDraft_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "GoalAssetVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetDraft_conflictVersionId_fkey" FOREIGN KEY ("conflictVersionId") REFERENCES "GoalAssetVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoalInboxCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "sourceTaskId" TEXT NOT NULL,
    "sourceRunId" TEXT NOT NULL,
    "sourceArtifactId" TEXT,
    "groupKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "proposedAction" TEXT NOT NULL,
    "proposedTargetAssetId" TEXT,
    "reason" TEXT NOT NULL,
    "changeSummary" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "selector" JSONB,
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoalInboxCandidate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalInboxCandidate_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalInboxCandidate_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalInboxCandidate_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "Artifact" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GoalInboxCandidate_proposedTargetAssetId_fkey" FOREIGN KEY ("proposedTargetAssetId") REFERENCES "GoalAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoalFormSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "taskId" TEXT,
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoalFormSubmission_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalFormSubmission_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalFormSubmission_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "GoalAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalFormSubmission_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "GoalAssetVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GoalFormSubmission_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoalAssetJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "taskId" TEXT,
    "kind" TEXT NOT NULL,
    "format" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Queued',
    "outputUri" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoalAssetJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetJob_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetJob_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "GoalAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetJob_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "GoalAssetVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetJob_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskTrigger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'Enabled',
    "config" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskTrigger_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskTrigger_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TriggerDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "deliveryKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Received',
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    "payloadDigest" TEXT,
    "normalizedInput" JSONB,
    "ignoreReason" TEXT,
    "errorCode" TEXT,
    CONSTRAINT "TriggerDelivery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TriggerDelivery_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "TaskTrigger" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TriggerDelivery_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskOccurrence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "deliveryId" TEXT,
    "triggerId" TEXT,
    "workBlockId" TEXT,
    "occurrenceKey" TEXT NOT NULL,
    "triggerVersion" INTEGER,
    "source" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "eligibleAt" DATETIME NOT NULL,
    "materializedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "normalizedInput" JSONB,
    "executionEpoch" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "TaskOccurrence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskOccurrence_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskOccurrence_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "TaskTrigger" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TaskOccurrence_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "TriggerDelivery" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TaskOccurrence_workBlockId_fkey" FOREIGN KEY ("workBlockId") REFERENCES "WorkBlock" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Existing WorkBlocks become schedule-linked occurrences before execution authority paths are rebuilt.
INSERT INTO "TaskOccurrence" ("id", "workspaceId", "taskId", "workBlockId", "occurrenceKey", "source", "status", "eligibleAt", "materializedAt", "startedAt", "completedAt", "executionEpoch")
SELECT 'occ_' || "id", "workspaceId", "taskId", "id", COALESCE("recurrenceKey", 'work-block:' || "id"), json_object('kind', CASE WHEN "trigger" = 'scheduled' THEN 'trigger' ELSE 'manual' END),
  CASE "status" WHEN 'Scheduled' THEN 'Scheduled' WHEN 'Active' THEN 'Running' WHEN 'Completed' THEN 'Completed' WHEN 'Cancelled' THEN 'Cancelled' ELSE 'Ready' END,
  "scheduledStartAt", "createdAt", "startedAt", "completedAt", 1
FROM "WorkBlock";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Artifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "contentPreview" TEXT,
    "metadata" JSONB,
    "occurrenceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Artifact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Artifact_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Artifact_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "TaskOccurrence" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Artifact" ("contentPreview", "createdAt", "id", "metadata", "occurrenceId", "runId", "taskId", "title", "type", "uri", "workspaceId") SELECT a."contentPreview", a."createdAt", a."id", a."metadata", o."id", a."runId", a."taskId", a."title", a."type", a."uri", a."workspaceId" FROM "Artifact" a LEFT JOIN "Run" r ON r."id" = a."runId" LEFT JOIN "TaskOccurrence" o ON o."workBlockId" = r."workBlockId";
DROP TABLE "Artifact";
ALTER TABLE "new_Artifact" RENAME TO "Artifact";
CREATE INDEX "Artifact_workspaceId_type_idx" ON "Artifact"("workspaceId", "type");
CREATE INDEX "Artifact_taskId_createdAt_idx" ON "Artifact"("taskId", "createdAt");
CREATE INDEX "Artifact_occurrenceId_createdAt_idx" ON "Artifact"("occurrenceId", "createdAt");
CREATE INDEX "Artifact_runId_createdAt_idx" ON "Artifact"("runId", "createdAt");
CREATE TABLE "new_ExecutionSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workBlockId" TEXT,
    "planId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "currentNodeId" TEXT,
    "currentNodeAttemptId" TEXT,
    "pauseReason" TEXT,
    "completedNodeIds" TEXT NOT NULL DEFAULT '[]',
    "pausedByEventId" TEXT,
    "pausedByRawEventId" TEXT,
    "latestEventId" TEXT,
    "latestRawEventId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pausedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "occurrenceId" TEXT,
    CONSTRAINT "ExecutionSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExecutionSession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExecutionSession_workBlockId_fkey" FOREIGN KEY ("workBlockId") REFERENCES "WorkBlock" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ExecutionSession_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "TaskOccurrence" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ExecutionSession" ("completedAt", "completedNodeIds", "createdAt", "currentNodeAttemptId", "currentNodeId", "id", "latestEventId", "latestRawEventId", "occurrenceId", "pauseReason", "pausedAt", "pausedByEventId", "pausedByRawEventId", "planId", "startedAt", "status", "taskId", "updatedAt", "workBlockId", "workspaceId") SELECT e."completedAt", e."completedNodeIds", e."createdAt", e."currentNodeAttemptId", e."currentNodeId", e."id", e."latestEventId", e."latestRawEventId", o."id", e."pauseReason", e."pausedAt", e."pausedByEventId", e."pausedByRawEventId", e."planId", e."startedAt", e."status", e."taskId", e."updatedAt", e."workBlockId", e."workspaceId" FROM "ExecutionSession" e LEFT JOIN "TaskOccurrence" o ON o."workBlockId" = e."workBlockId";
DROP TABLE "ExecutionSession";
ALTER TABLE "new_ExecutionSession" RENAME TO "ExecutionSession";
CREATE INDEX "ExecutionSession_workspaceId_status_idx" ON "ExecutionSession"("workspaceId", "status");
CREATE INDEX "ExecutionSession_taskId_status_idx" ON "ExecutionSession"("taskId", "status");
CREATE INDEX "ExecutionSession_workBlockId_idx" ON "ExecutionSession"("workBlockId");
CREATE INDEX "ExecutionSession_occurrenceId_idx" ON "ExecutionSession"("occurrenceId");
CREATE TABLE "new_GoalAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "sourceArtifactId" TEXT NOT NULL,
    "currentArtifactId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'file',
    "archivedAt" DATETIME,
    "lastOpenedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoalAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAsset_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAsset_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "Artifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GoalAsset_currentArtifactId_fkey" FOREIGN KEY ("currentArtifactId") REFERENCES "Artifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_GoalAsset" ("createdAt", "currentArtifactId", "goalId", "id", "label", "role", "sourceArtifactId", "status", "updatedAt", "workspaceId") SELECT "createdAt", "currentArtifactId", "goalId", "id", "label", "role", "sourceArtifactId", "status", "updatedAt", "workspaceId" FROM "GoalAsset";
DROP TABLE "GoalAsset";
ALTER TABLE "new_GoalAsset" RENAME TO "GoalAsset";
CREATE INDEX "GoalAsset_workspaceId_goalId_idx" ON "GoalAsset"("workspaceId", "goalId");
CREATE INDEX "GoalAsset_sourceArtifactId_idx" ON "GoalAsset"("sourceArtifactId");
CREATE INDEX "GoalAsset_currentArtifactId_idx" ON "GoalAsset"("currentArtifactId");
CREATE INDEX "GoalAsset_goalId_archivedAt_updatedAt_idx" ON "GoalAsset"("goalId", "archivedAt", "updatedAt");
CREATE UNIQUE INDEX "GoalAsset_goalId_sourceArtifactId_key" ON "GoalAsset"("goalId", "sourceArtifactId");
CREATE TABLE "new_Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "workBlockId" TEXT,
    "occurrenceId" TEXT,
    "taskSessionId" TEXT,
    "runtimeName" TEXT NOT NULL,
    "runtimeConfigSnapshot" JSONB,
    "runtimeConfigVersion" TEXT,
    "runtimeRunRef" TEXT,
    "runtimeSessionRef" TEXT,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "errorSummary" TEXT,
    "resumeToken" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "resumeSupported" BOOLEAN NOT NULL DEFAULT false,
    "pendingInputPrompt" TEXT,
    "pendingInputType" TEXT,
    "lastSyncedAt" DATETIME,
    "syncStatus" TEXT NOT NULL DEFAULT 'healthy',
    "mappingPartial" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Run_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "TaskOccurrence" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Run_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Run_workBlockId_fkey" FOREIGN KEY ("workBlockId") REFERENCES "WorkBlock" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Run_taskSessionId_fkey" FOREIGN KEY ("taskSessionId") REFERENCES "TaskSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Run" ("createdAt", "endedAt", "errorSummary", "id", "lastSyncedAt", "mappingPartial", "occurrenceId", "pendingInputPrompt", "pendingInputType", "resumeSupported", "resumeToken", "retryable", "runtimeConfigSnapshot", "runtimeConfigVersion", "runtimeName", "runtimeRunRef", "runtimeSessionRef", "startedAt", "status", "syncStatus", "taskId", "taskSessionId", "triggeredBy", "updatedAt", "workBlockId") SELECT r."createdAt", r."endedAt", r."errorSummary", r."id", r."lastSyncedAt", r."mappingPartial", o."id", r."pendingInputPrompt", r."pendingInputType", r."resumeSupported", r."resumeToken", r."retryable", r."runtimeConfigSnapshot", r."runtimeConfigVersion", r."runtimeName", r."runtimeRunRef", r."runtimeSessionRef", r."startedAt", r."status", r."syncStatus", r."taskId", r."taskSessionId", r."triggeredBy", r."updatedAt", r."workBlockId" FROM "Run" r LEFT JOIN "TaskOccurrence" o ON o."workBlockId" = r."workBlockId";
DROP TABLE "Run";
ALTER TABLE "new_Run" RENAME TO "Run";
CREATE UNIQUE INDEX "Run_runtimeRunRef_key" ON "Run"("runtimeRunRef");
CREATE INDEX "Run_taskId_status_idx" ON "Run"("taskId", "status");
CREATE INDEX "Run_taskId_workBlockId_status_idx" ON "Run"("taskId", "workBlockId", "status");
CREATE INDEX "Run_taskSessionId_status_idx" ON "Run"("taskSessionId", "status");
CREATE INDEX "Run_runtimeName_status_idx" ON "Run"("runtimeName", "status");
CREATE INDEX "Run_occurrenceId_createdAt_idx" ON "Run"("occurrenceId", "createdAt");
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'single',
    "recurrenceRule" TEXT,
    "seriesExternalUid" TEXT,
    "recurrenceAnchorStartAt" DATETIME,
    "recurrenceAnchorEndAt" DATETIME,
    "recurrenceWindowUntil" DATETIME,
    "executionRuntime" TEXT NOT NULL,
    "executionConfig" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "autoPlanGeneration" BOOLEAN NOT NULL DEFAULT false,
    "autoExecute" BOOLEAN NOT NULL DEFAULT false,
    "autoPlanGenerationTiming" TEXT NOT NULL DEFAULT 'at_start',
    "autoExecuteTiming" TEXT NOT NULL DEFAULT 'at_start',
    "parentTaskId" TEXT,
    "dueAt" DATETIME,
    "blockReason" JSONB,
    "goalContext" JSONB,
    "definitionStatus" TEXT NOT NULL DEFAULT 'Active',
    "defaultSessionId" TEXT,
    "aiClientId" TEXT,
    "latestRunId" TEXT,
    "latestEventId" TEXT,
    "latestRawEventId" TEXT,
    "blockedByEventId" TEXT,
    "blockedByRawEventId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "Task_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_aiClientId_fkey" FOREIGN KEY ("aiClientId") REFERENCES "AiClient" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("aiClientId", "autoExecute", "autoExecuteTiming", "autoPlanGeneration", "autoPlanGenerationTiming", "blockReason", "blockedByEventId", "blockedByRawEventId", "completedAt", "createdAt", "defaultSessionId", "description", "dueAt", "executionConfig", "executionRuntime", "goalContext", "goalId", "id", "kind", "latestEventId", "latestRawEventId", "latestRunId", "parentTaskId", "priority", "recurrenceAnchorEndAt", "recurrenceAnchorStartAt", "recurrenceRule", "recurrenceWindowUntil", "seriesExternalUid", "status", "title", "updatedAt", "workspaceId") SELECT "aiClientId", "autoExecute", "autoExecuteTiming", "autoPlanGeneration", "autoPlanGenerationTiming", "blockReason", "blockedByEventId", "blockedByRawEventId", "completedAt", "createdAt", "defaultSessionId", "description", "dueAt", "executionConfig", "executionRuntime", "goalContext", "goalId", "id", "kind", "latestEventId", "latestRawEventId", "latestRunId", "parentTaskId", "priority", "recurrenceAnchorEndAt", "recurrenceAnchorStartAt", "recurrenceRule", "recurrenceWindowUntil", "seriesExternalUid", "status", "title", "updatedAt", "workspaceId" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_workspaceId_status_idx" ON "Task"("workspaceId", "status");
CREATE INDEX "Task_workspaceId_priority_idx" ON "Task"("workspaceId", "priority");
CREATE INDEX "Task_workspaceId_seriesExternalUid_idx" ON "Task"("workspaceId", "seriesExternalUid");
CREATE INDEX "Task_defaultSessionId_idx" ON "Task"("defaultSessionId");
CREATE INDEX "Task_goalId_idx" ON "Task"("goalId");
CREATE INDEX "Task_workspaceId_definitionStatus_idx" ON "Task"("workspaceId", "definitionStatus");
CREATE INDEX "Task_aiClientId_idx" ON "Task"("aiClientId");
CREATE TABLE "new_TaskPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workBlockId" TEXT,
    "occurrenceId" TEXT,
    "planId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "prompt" TEXT,
    "summary" TEXT,
    "generatedBy" TEXT,
    "compiledPlan" JSONB NOT NULL,
    "editablePlan" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskPlan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskPlan_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskPlan_workBlockId_fkey" FOREIGN KEY ("workBlockId") REFERENCES "WorkBlock" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TaskPlan_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "TaskOccurrence" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TaskPlan" ("compiledPlan", "createdAt", "editablePlan", "generatedBy", "id", "occurrenceId", "planId", "prompt", "revision", "status", "summary", "taskId", "updatedAt", "workBlockId", "workspaceId") SELECT p."compiledPlan", p."createdAt", p."editablePlan", p."generatedBy", p."id", o."id", p."planId", p."prompt", p."revision", p."status", p."summary", p."taskId", p."updatedAt", p."workBlockId", p."workspaceId" FROM "TaskPlan" p LEFT JOIN "TaskOccurrence" o ON o."workBlockId" = p."workBlockId";
DROP TABLE "TaskPlan";
ALTER TABLE "new_TaskPlan" RENAME TO "TaskPlan";
CREATE UNIQUE INDEX "TaskPlan_planId_key" ON "TaskPlan"("planId");
CREATE INDEX "TaskPlan_workspaceId_taskId_updatedAt_idx" ON "TaskPlan"("workspaceId", "taskId", "updatedAt");
CREATE INDEX "TaskPlan_taskId_workBlockId_status_updatedAt_idx" ON "TaskPlan"("taskId", "workBlockId", "status", "updatedAt");
CREATE INDEX "TaskPlan_occurrenceId_status_updatedAt_idx" ON "TaskPlan"("occurrenceId", "status", "updatedAt");
CREATE INDEX "TaskPlan_workBlockId_status_updatedAt_idx" ON "TaskPlan"("workBlockId", "status", "updatedAt");
CREATE TABLE "new_TaskPlanRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workBlockId" TEXT,
    "occurrenceId" TEXT,
    "planId" TEXT NOT NULL,
    "planRun" JSONB NOT NULL,
    "executionOwnerId" TEXT,
    "executionOwnerScope" TEXT,
    "executionLeaseUntil" DATETIME,
    "executionEpoch" INTEGER NOT NULL DEFAULT 0,
    "latestEventId" TEXT,
    "latestRawEventId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskPlanRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanRun_workBlockId_fkey" FOREIGN KEY ("workBlockId") REFERENCES "WorkBlock" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanRun_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TaskPlan" ("planId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanRun_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "TaskOccurrence" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TaskPlanRun" ("createdAt", "executionEpoch", "executionLeaseUntil", "executionOwnerId", "executionOwnerScope", "id", "latestEventId", "latestRawEventId", "occurrenceId", "planId", "planRun", "taskId", "updatedAt", "workBlockId", "workspaceId") SELECT p."createdAt", p."executionEpoch", p."executionLeaseUntil", p."executionOwnerId", p."executionOwnerScope", p."id", p."latestEventId", p."latestRawEventId", o."id", p."planId", p."planRun", p."taskId", p."updatedAt", p."workBlockId", p."workspaceId" FROM "TaskPlanRun" p LEFT JOIN "TaskOccurrence" o ON o."workBlockId" = p."workBlockId";
DROP TABLE "TaskPlanRun";
ALTER TABLE "new_TaskPlanRun" RENAME TO "TaskPlanRun";
CREATE INDEX "TaskPlanRun_taskId_planId_executionOwnerId_idx" ON "TaskPlanRun"("taskId", "planId", "executionOwnerId");
CREATE INDEX "TaskPlanRun_taskId_workBlockId_planId_idx" ON "TaskPlanRun"("taskId", "workBlockId", "planId");
CREATE INDEX "TaskPlanRun_executionLeaseUntil_idx" ON "TaskPlanRun"("executionLeaseUntil");
CREATE INDEX "TaskPlanRun_workspaceId_taskId_updatedAt_idx" ON "TaskPlanRun"("workspaceId", "taskId", "updatedAt");
CREATE INDEX "TaskPlanRun_occurrenceId_updatedAt_idx" ON "TaskPlanRun"("occurrenceId", "updatedAt");
CREATE UNIQUE INDEX "TaskPlanRun_taskId_planId_workBlockId_key" ON "TaskPlanRun"("taskId", "planId", "workBlockId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "GoalAssetVersion_goalId_createdAt_idx" ON "GoalAssetVersion"("goalId", "createdAt");

-- CreateIndex
CREATE INDEX "GoalAssetVersion_artifactId_idx" ON "GoalAssetVersion"("artifactId");

-- CreateIndex
CREATE UNIQUE INDEX "GoalAssetVersion_assetId_version_key" ON "GoalAssetVersion"("assetId", "version");

-- CreateIndex
CREATE INDEX "GoalAssetDraft_assetId_status_idx" ON "GoalAssetDraft"("assetId", "status");

-- CreateIndex
CREATE INDEX "GoalAssetDraft_goalId_updatedAt_idx" ON "GoalAssetDraft"("goalId", "updatedAt");

-- CreateIndex
CREATE INDEX "GoalInboxCandidate_goalId_status_createdAt_idx" ON "GoalInboxCandidate"("goalId", "status", "createdAt");


CREATE UNIQUE INDEX "GoalInboxCandidate_goalId_sourceRunId_groupKey_key" ON "GoalInboxCandidate"("goalId", "sourceRunId", "groupKey");
CREATE INDEX "GoalFormSubmission_assetId_createdAt_idx" ON "GoalFormSubmission"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "GoalFormSubmission_goalId_createdAt_idx" ON "GoalFormSubmission"("goalId", "createdAt");

-- CreateIndex
CREATE INDEX "GoalAssetJob_assetId_kind_createdAt_idx" ON "GoalAssetJob"("assetId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "GoalAssetJob_goalId_status_idx" ON "GoalAssetJob"("goalId", "status");

-- CreateIndex
CREATE INDEX "TaskTrigger_workspaceId_state_idx" ON "TaskTrigger"("workspaceId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "TaskTrigger_taskId_kind_key" ON "TaskTrigger"("taskId", "kind");

-- CreateIndex
CREATE INDEX "TriggerDelivery_workspaceId_status_receivedAt_idx" ON "TriggerDelivery"("workspaceId", "status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TriggerDelivery_triggerId_deliveryKey_key" ON "TriggerDelivery"("triggerId", "deliveryKey");

-- CreateIndex
CREATE UNIQUE INDEX "TaskOccurrence_deliveryId_key" ON "TaskOccurrence"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskOccurrence_workBlockId_key" ON "TaskOccurrence"("workBlockId");

-- CreateIndex
CREATE INDEX "TaskOccurrence_workspaceId_status_eligibleAt_idx" ON "TaskOccurrence"("workspaceId", "status", "eligibleAt");

-- CreateIndex
CREATE INDEX "TaskOccurrence_taskId_status_eligibleAt_idx" ON "TaskOccurrence"("taskId", "status", "eligibleAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskOccurrence_taskId_occurrenceKey_key" ON "TaskOccurrence"("taskId", "occurrenceKey");


-- Folded from prisma/migrations/20260722000000_add_goal_review_proposals/migration.sql
-- CreateTable
CREATE TABLE "GoalReviewProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "sourceTaskId" TEXT NOT NULL,
    "sourceRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Generating',
    "inputSnapshot" JSONB NOT NULL,
    "inputSnapshotHash" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "providerName" TEXT,
    "modelName" TEXT,
    "summary" TEXT,
    "rawResult" JSONB,
    "generationError" TEXT,
    "requestIdempotencyKey" TEXT NOT NULL,
    "applicationIdempotencyKey" TEXT,
    "appliedAt" DATETIME,
    "rejectedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoalReviewProposal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalReviewProposal_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalReviewProposal_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GoalReviewProposal_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoalReviewProposalItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidenceRefs" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "dependencySnapshot" JSONB NOT NULL,
    "dependencyHash" TEXT NOT NULL,
    "decision" TEXT NOT NULL DEFAULT 'Pending',
    "decisionReason" TEXT,
    "appliedObjectType" TEXT,
    "appliedObjectId" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoalReviewProposalItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalReviewProposalItem_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalReviewProposalItem_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "GoalReviewProposal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GoalReviewProposal_sourceTaskId_key" ON "GoalReviewProposal"("sourceTaskId");
CREATE UNIQUE INDEX "GoalReviewProposal_sourceRunId_key" ON "GoalReviewProposal"("sourceRunId");
CREATE UNIQUE INDEX "GoalReviewProposal_goalId_requestIdempotencyKey_key" ON "GoalReviewProposal"("goalId", "requestIdempotencyKey");
CREATE INDEX "GoalReviewProposal_workspaceId_goalId_status_idx" ON "GoalReviewProposal"("workspaceId", "goalId", "status");
CREATE INDEX "GoalReviewProposal_goalId_createdAt_idx" ON "GoalReviewProposal"("goalId", "createdAt");
CREATE UNIQUE INDEX "GoalReviewProposalItem_proposalId_itemId_key" ON "GoalReviewProposalItem"("proposalId", "itemId");
CREATE INDEX "GoalReviewProposalItem_workspaceId_goalId_decision_idx" ON "GoalReviewProposalItem"("workspaceId", "goalId", "decision");
CREATE INDEX "GoalReviewProposalItem_proposalId_kind_idx" ON "GoalReviewProposalItem"("proposalId", "kind");

-- CreateTable
CREATE TABLE "GoalAssetOwnershipProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "inboxCandidateId" TEXT NOT NULL,
    "sourceTaskId" TEXT NOT NULL,
    "sourceRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Generating',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "requestIdempotencyKey" TEXT NOT NULL,
    "applicationKey" TEXT,
    "inputSnapshot" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "result" JSONB,
    "decision" TEXT,
    "targetAssetId" TEXT,
    "providerType" TEXT,
    "model" TEXT,
    "generationError" TEXT,
    "finalAction" TEXT,
    "finalAssetId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "readyAt" DATETIME,
    "appliedAt" DATETIME,
    "rejectedAt" DATETIME,
    CONSTRAINT "GoalAssetOwnershipProposal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetOwnershipProposal_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetOwnershipProposal_inboxCandidateId_fkey" FOREIGN KEY ("inboxCandidateId") REFERENCES "GoalInboxCandidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetOwnershipProposal_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetOwnershipProposal_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetOwnershipProposal_targetAssetId_fkey" FOREIGN KEY ("targetAssetId") REFERENCES "GoalAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetOwnershipProposal_finalAssetId_fkey" FOREIGN KEY ("finalAssetId") REFERENCES "GoalAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GoalAssetOwnershipProposal_sourceRunId_key" ON "GoalAssetOwnershipProposal"("sourceRunId");
CREATE UNIQUE INDEX "GoalAssetOwnershipProposal_inboxCandidateId_requestIdempotencyKey_key" ON "GoalAssetOwnershipProposal"("inboxCandidateId", "requestIdempotencyKey");
CREATE INDEX "GoalAssetOwnershipProposal_workspaceId_status_updatedAt_idx" ON "GoalAssetOwnershipProposal"("workspaceId", "status", "updatedAt");
CREATE INDEX "GoalAssetOwnershipProposal_goalId_updatedAt_idx" ON "GoalAssetOwnershipProposal"("goalId", "updatedAt");
CREATE INDEX "GoalAssetOwnershipProposal_inboxCandidateId_createdAt_idx" ON "GoalAssetOwnershipProposal"("inboxCandidateId", "createdAt");


-- Folded from prisma/migrations/20260723000000_automatic_goal_context/migration.sql
-- Manual Goal Working Set persistence is replaced by automatic accepted-result context snapshots and MCP retrieval.
DROP TABLE IF EXISTS "GoalWorkingSetItem";

-- Lock each Task to its first resolved execution model until the user changes model routing.
ALTER TABLE "Task" ADD COLUMN "pinnedModel" TEXT;
ALTER TABLE "Task" ADD COLUMN "pinnedModelSource" TEXT;


-- Folded from prisma/migrations/20260728000000_pin_task_execution_model/migration.sql
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
UPDATE "TaskPlanRun"
SET "workBlockScopeKey" = COALESCE("workBlockId", '')
WHERE "workBlockScopeKey" IS NOT NULL;
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

-- Internal Goal AI proposals run as feature invocations, not user Tasks.
-- Rebuild the two proposal tables so new rows no longer require Task or Run ownership.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_GoalReviewProposal" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "goalId" TEXT NOT NULL,
  "sourceTaskId" TEXT,
  "sourceRunId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'Generating',
  "inputSnapshot" JSONB NOT NULL,
  "inputSnapshotHash" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "providerName" TEXT,
  "modelName" TEXT,
  "summary" TEXT,
  "rawResult" JSONB,
  "generationError" TEXT,
  "requestIdempotencyKey" TEXT NOT NULL,
  "applicationIdempotencyKey" TEXT,
  "appliedAt" DATETIME,
  "rejectedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "GoalReviewProposal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GoalReviewProposal_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GoalReviewProposal_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "GoalReviewProposal_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_GoalReviewProposal" SELECT * FROM "GoalReviewProposal";
DROP TABLE "GoalReviewProposal";
ALTER TABLE "new_GoalReviewProposal" RENAME TO "GoalReviewProposal";
CREATE UNIQUE INDEX "GoalReviewProposal_sourceTaskId_key" ON "GoalReviewProposal"("sourceTaskId");
CREATE UNIQUE INDEX "GoalReviewProposal_sourceRunId_key" ON "GoalReviewProposal"("sourceRunId");
CREATE UNIQUE INDEX "GoalReviewProposal_goalId_requestIdempotencyKey_key" ON "GoalReviewProposal"("goalId", "requestIdempotencyKey");
CREATE INDEX "GoalReviewProposal_workspaceId_goalId_status_idx" ON "GoalReviewProposal"("workspaceId", "goalId", "status");
CREATE INDEX "GoalReviewProposal_goalId_createdAt_idx" ON "GoalReviewProposal"("goalId", "createdAt");

CREATE TABLE "new_GoalAssetOwnershipProposal" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "goalId" TEXT NOT NULL,
  "inboxCandidateId" TEXT NOT NULL,
  "sourceTaskId" TEXT,
  "sourceRunId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'Generating',
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "requestIdempotencyKey" TEXT NOT NULL,
  "applicationKey" TEXT,
  "inputSnapshot" JSONB NOT NULL,
  "inputHash" TEXT NOT NULL,
  "result" JSONB,
  "decision" TEXT,
  "targetAssetId" TEXT,
  "providerType" TEXT,
  "model" TEXT,
  "generationError" TEXT,
  "finalAction" TEXT,
  "finalAssetId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "readyAt" DATETIME,
  "appliedAt" DATETIME,
  "rejectedAt" DATETIME,
  CONSTRAINT "GoalAssetOwnershipProposal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GoalAssetOwnershipProposal_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GoalAssetOwnershipProposal_inboxCandidateId_fkey" FOREIGN KEY ("inboxCandidateId") REFERENCES "GoalInboxCandidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GoalAssetOwnershipProposal_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "GoalAssetOwnershipProposal_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "GoalAssetOwnershipProposal_targetAssetId_fkey" FOREIGN KEY ("targetAssetId") REFERENCES "GoalAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "GoalAssetOwnershipProposal_finalAssetId_fkey" FOREIGN KEY ("finalAssetId") REFERENCES "GoalAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_GoalAssetOwnershipProposal" SELECT * FROM "GoalAssetOwnershipProposal";
DROP TABLE "GoalAssetOwnershipProposal";
ALTER TABLE "new_GoalAssetOwnershipProposal" RENAME TO "GoalAssetOwnershipProposal";
CREATE UNIQUE INDEX "GoalAssetOwnershipProposal_sourceRunId_key" ON "GoalAssetOwnershipProposal"("sourceRunId");
CREATE UNIQUE INDEX "GoalAssetOwnershipProposal_inboxCandidateId_requestIdempotencyKey_key" ON "GoalAssetOwnershipProposal"("inboxCandidateId", "requestIdempotencyKey");
CREATE INDEX "GoalAssetOwnershipProposal_workspaceId_status_updatedAt_idx" ON "GoalAssetOwnershipProposal"("workspaceId", "status", "updatedAt");
CREATE INDEX "GoalAssetOwnershipProposal_goalId_updatedAt_idx" ON "GoalAssetOwnershipProposal"("goalId", "updatedAt");
CREATE INDEX "GoalAssetOwnershipProposal_inboxCandidateId_createdAt_idx" ON "GoalAssetOwnershipProposal"("inboxCandidateId", "createdAt");

-- Index nullable RawEvent foreign keys so ON DELETE SET NULL does not rescan child tables per deleted row.
CREATE INDEX "Event_rawEventId_idx" ON "Event"("rawEventId");
CREATE INDEX "TaskTimelineItem_rawEventId_idx" ON "TaskTimelineItem"("rawEventId");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;


-- Folded from prisma/migrations/20260729000000_add_ai_feature_runtime_persistence/migration.sql
-- Runtime-owned AI feature invocations are intentionally distinct from Task execution Run.
CREATE TABLE "AiFeatureRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "featureId" TEXT NOT NULL,
  "featureVersion" INTEGER NOT NULL,
  "manifest" JSONB NOT NULL,
  "manifestHash" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "operationKind" TEXT NOT NULL,
  "retryOfRunId" TEXT,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "subjectRevision" TEXT,
  "status" TEXT NOT NULL,
  "stateVersion" INTEGER NOT NULL DEFAULT 0,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "leaseOwner" TEXT,
  "leaseExpiresAt" DATETIME,
  "heartbeatAt" DATETIME,
  "objective" JSONB NOT NULL,
  "input" JSONB NOT NULL,
  "inputHash" TEXT NOT NULL,
  "providerClientId" TEXT,
  "providerName" TEXT,
  "providerModelName" TEXT,
  "providerConfigFingerprint" TEXT,
  "providerRunRef" TEXT,
  "providerResumeRef" TEXT,
  "terminalCandidate" JSONB,
  "terminalResult" JSONB,
  "proposedActions" JSONB,
  "completionReport" JSONB,
  "commitStatus" TEXT,
  "commitReference" JSONB,
  "committedAt" DATETIME,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" DATETIME,
  "finishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AiFeatureRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AiFeatureRun_providerClientId_fkey" FOREIGN KEY ("providerClientId") REFERENCES "AiClient" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AiFeatureRun_retryOfRunId_fkey" FOREIGN KEY ("retryOfRunId") REFERENCES "AiFeatureRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AiFeatureRun_workspaceId_featureId_subjectType_subjectId_operationKind_operationId_key"
  ON "AiFeatureRun" ("workspaceId", "featureId", "subjectType", "subjectId", "operationKind", "operationId");
CREATE INDEX "AiFeatureRun_workspaceId_subjectType_subjectId_createdAt_idx"
  ON "AiFeatureRun" ("workspaceId", "subjectType", "subjectId", "createdAt");
CREATE INDEX "AiFeatureRun_featureId_status_createdAt_idx"
  ON "AiFeatureRun" ("featureId", "status", "createdAt");

CREATE TABLE "AiFeatureRunObservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "observationId" TEXT NOT NULL,
  "observationType" TEXT NOT NULL,
  "observationVersion" INTEGER NOT NULL,
  "observationKey" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "delivery" TEXT NOT NULL,
  "canonicalizerId" TEXT NOT NULL,
  "hashAlgorithm" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "observedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiFeatureRunObservation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiFeatureRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AiFeatureRunObservation_runId_sequence_key"
  ON "AiFeatureRunObservation" ("runId", "sequence");
CREATE UNIQUE INDEX "AiFeatureRunObservation_runId_observationId_key"
  ON "AiFeatureRunObservation" ("runId", "observationId");
CREATE UNIQUE INDEX "AiFeatureRunObservation_runId_observationType_observationVersion_observationKey_revision_key"
  ON "AiFeatureRunObservation" ("runId", "observationType", "observationVersion", "observationKey", "revision");
CREATE INDEX "AiFeatureRunObservation_runId_observationType_observationKey_idx"
  ON "AiFeatureRunObservation" ("runId", "observationType", "observationKey");

CREATE TABLE "AiFeatureRunAction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "callId" TEXT NOT NULL,
  "executionKey" TEXT NOT NULL,
  "actionId" TEXT NOT NULL,
  "actionVersion" INTEGER NOT NULL,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "leaseOwner" TEXT,
  "leaseExpiresAt" DATETIME,
  "input" JSONB NOT NULL,
  "inputHash" TEXT NOT NULL,
  "outputObservationId" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" DATETIME,
  CONSTRAINT "AiFeatureRunAction_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiFeatureRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AiFeatureRunAction_runId_outputObservationId_fkey" FOREIGN KEY ("runId", "outputObservationId") REFERENCES "AiFeatureRunObservation" ("runId", "observationId") ON UPDATE CASCADE

);
CREATE UNIQUE INDEX "AiFeatureRunAction_executionKey_key" ON "AiFeatureRunAction" ("executionKey");
CREATE UNIQUE INDEX "AiFeatureRunAction_runId_mode_callId_key" ON "AiFeatureRunAction" ("runId", "mode", "callId");
CREATE INDEX "AiFeatureRunAction_runId_actionId_status_idx" ON "AiFeatureRunAction" ("runId", "actionId", "status");

-- Nullable additions retain every legacy plan/proposal without fabricating runtime provenance.
ALTER TABLE "TaskPlan" ADD COLUMN "aiFeatureRunId" TEXT REFERENCES "AiFeatureRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "TaskPlan_aiFeatureRunId_key" ON "TaskPlan" ("aiFeatureRunId");

ALTER TABLE "GoalReviewProposal" ADD COLUMN "aiFeatureRunId" TEXT REFERENCES "AiFeatureRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GoalReviewProposal" ADD COLUMN "stateVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GoalReviewProposal" ADD COLUMN "questions" JSONB;
ALTER TABLE "GoalReviewProposal" ADD COLUMN "partialOutput" JSONB;
ALTER TABLE "GoalReviewProposal" ADD COLUMN "cannotCompleteReason" TEXT;
ALTER TABLE "GoalReviewProposal" ADD COLUMN "missingObservations" JSONB;
CREATE UNIQUE INDEX "GoalReviewProposal_aiFeatureRunId_key" ON "GoalReviewProposal" ("aiFeatureRunId");

CREATE TABLE "TaskPlanGenerationHead" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "workBlockScopeKey" TEXT NOT NULL,
  "baselinePlanId" TEXT,
  "baselinePlanRevision" INTEGER,
  "baselinePlanStatus" TEXT,

  "baselinePlanContentHash" TEXT,
  "baselineHash" TEXT,

  "currentPlanId" TEXT,
  "currentPlanRevision" INTEGER,
  "currentPlanContentHash" TEXT,
  "currentPlanStatus" TEXT,
  "generationVersion" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'Idle',
  "currentAiFeatureRunId" TEXT,

  "stateVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TaskPlanGenerationHead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskPlanGenerationHead_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskPlanGenerationHead_baselinePlanId_fkey" FOREIGN KEY ("baselinePlanId") REFERENCES "TaskPlan" ("planId") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TaskPlanGenerationHead_currentPlanId_fkey" FOREIGN KEY ("currentPlanId") REFERENCES "TaskPlan" ("planId") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TaskPlanGenerationHead_currentAiFeatureRunId_fkey" FOREIGN KEY ("currentAiFeatureRunId") REFERENCES "AiFeatureRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TaskPlanGenerationHead_taskId_workBlockScopeKey_key"
  ON "TaskPlanGenerationHead" ("taskId", "workBlockScopeKey");
CREATE INDEX "TaskPlanGenerationHead_workspaceId_taskId_idx"
  ON "TaskPlanGenerationHead" ("workspaceId", "taskId");
CREATE INDEX "TaskPlanGenerationHead_baselinePlanId_idx"
  ON "TaskPlanGenerationHead" ("baselinePlanId");
CREATE INDEX "TaskPlanGenerationHead_currentPlanId_idx"
  ON "TaskPlanGenerationHead" ("currentPlanId");
CREATE UNIQUE INDEX "TaskPlanGenerationHead_currentAiFeatureRunId_key"
  ON "TaskPlanGenerationHead" ("currentAiFeatureRunId");


-- Existing plans have no canonical content hash. Preserve a NULL snapshot rather
-- than fabricate one; the next CAS writer records a canonical hash. Scope derives
-- from a real workBlockId, with the explicit empty key for the unscoped case.
INSERT INTO "TaskPlanGenerationHead" (
  "id", "workspaceId", "taskId", "workBlockScopeKey",
  "baselinePlanId", "baselinePlanRevision", "baselinePlanStatus", "baselineHash", "currentPlanId", "currentPlanRevision", "currentPlanStatus",
  "generationVersion", "status", "stateVersion", "createdAt", "updatedAt"
)
SELECT
  'task-plan-generation-head:' || "planId",
  "workspaceId",
  "taskId",
  COALESCE("workBlockId", ''),
  "planId",
  "revision",
  "status",
  NULL,
  "planId",
  "revision",
  "status",
  0,
  'Current',
  0,
  "createdAt",
  "updatedAt"
FROM (
  SELECT
    "planId", "workspaceId", "taskId", "workBlockId", "revision", "status", "createdAt", "updatedAt",
    ROW_NUMBER() OVER (
      PARTITION BY "taskId", COALESCE("workBlockId", '')
      ORDER BY "updatedAt" DESC, "createdAt" DESC
    ) AS "rowNumber"
  FROM "TaskPlan"
)
WHERE "rowNumber" = 1;


-- Migrate recurrence ownership to durable schedule triggers and one versioned key format.
INSERT INTO "TaskTrigger" (
  "id", "workspaceId", "taskId", "kind", "state", "config", "version", "createdAt", "updatedAt"
)
SELECT
  lower(hex(randomblob(16))),
  t."workspaceId",
  t."id",
  'schedule',
  'Enabled',
  json_patch(
    json_object(
      'mode', 'recurring',
      'rrule', t."recurrenceRule",
      'anchorStartAt', CASE
        WHEN typeof(t."recurrenceAnchorStartAt") IN ('integer', 'real')
          THEN strftime('%Y-%m-%dT%H:%M:%fZ', t."recurrenceAnchorStartAt" / 1000.0, 'unixepoch')
        ELSE strftime('%Y-%m-%dT%H:%M:%fZ', t."recurrenceAnchorStartAt")
      END,
      'timezone', 'UTC',
      'durationMs', CASE
        WHEN typeof(t."recurrenceAnchorStartAt") IN ('integer', 'real')
          THEN CAST(t."recurrenceAnchorEndAt" - t."recurrenceAnchorStartAt" AS INTEGER)
        ELSE CAST((julianday(t."recurrenceAnchorEndAt") - julianday(t."recurrenceAnchorStartAt")) * 86400000 AS INTEGER)
      END
    ),
    CASE WHEN t."recurrenceWindowUntil" IS NULL THEN json_object() ELSE json_object(
      'windowUntil', CASE
        WHEN typeof(t."recurrenceWindowUntil") IN ('integer', 'real')
          THEN strftime('%Y-%m-%dT%H:%M:%fZ', t."recurrenceWindowUntil" / 1000.0, 'unixepoch')
        ELSE strftime('%Y-%m-%dT%H:%M:%fZ', t."recurrenceWindowUntil")
      END
    ) END
  ),
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Task" t
WHERE t."recurrenceRule" IS NOT NULL
  AND t."recurrenceAnchorStartAt" IS NOT NULL
  AND t."recurrenceAnchorEndAt" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "TaskTrigger" tt WHERE tt."taskId" = t."id" AND tt."kind" = 'schedule'
  );

-- Legacy updateTask materialized bare ISO recurrence keys without TaskOccurrence rows.
-- Bind those blocks to the exact schedule-trigger version before normalizing their keys.
WITH "legacyRecurrenceBlocks" AS (
  SELECT
    wb."id" AS "workBlockId",
    wb."workspaceId",
    wb."taskId",
    wb."recurrenceKey",
    wb."status" AS "workBlockStatus",
    wb."scheduledStartAt",
    wb."startedAt",
    wb."completedAt",
    tt."id" AS "triggerId",
    tt."version" AS "triggerVersion",
    CASE
      WHEN typeof(wb."scheduledStartAt") IN ('integer', 'real')
        THEN strftime('%Y-%m-%dT%H:%M:%fZ', wb."scheduledStartAt" / 1000.0, 'unixepoch')
      ELSE strftime('%Y-%m-%dT%H:%M:%fZ', wb."scheduledStartAt")
    END AS "normalizedStartAt"
  FROM "WorkBlock" wb
  JOIN "Task" t ON t."id" = wb."taskId"
  JOIN "TaskTrigger" tt ON tt."taskId" = wb."taskId" AND tt."kind" = 'schedule'
  WHERE t."recurrenceRule" IS NOT NULL
    AND wb."recurrenceKey" IS NOT NULL
    AND wb."recurrenceKey" NOT LIKE 'schedule:v%:%'
    AND NOT EXISTS (
      SELECT 1 FROM "TaskOccurrence" existing WHERE existing."workBlockId" = wb."id"
    )
)
INSERT INTO "TaskOccurrence" (
  "id", "workspaceId", "taskId", "triggerId", "workBlockId",
  "occurrenceKey", "triggerVersion", "source", "status", "eligibleAt",
  "startedAt", "completedAt", "executionEpoch"
)
SELECT
  'legacy-schedule-occurrence:' || legacy."workBlockId",
  legacy."workspaceId",
  legacy."taskId",
  legacy."triggerId",
  legacy."workBlockId",
  'schedule:v' || legacy."triggerVersion" || ':' || legacy."normalizedStartAt",
  legacy."triggerVersion",
  json_object('kind', 'trigger', 'triggerId', legacy."triggerId", 'migration', 'legacy_recurrence_block'),
  CASE legacy."workBlockStatus"
    WHEN 'Active' THEN 'Running'
    WHEN 'Completed' THEN 'Completed'
    WHEN 'Cancelled' THEN 'Cancelled'
    WHEN 'Blocked' THEN 'Blocked'
    WHEN 'Failed' THEN 'Failed'
    WHEN 'Ready' THEN 'Ready'
    ELSE CASE WHEN julianday(legacy."scheduledStartAt") > julianday(CURRENT_TIMESTAMP) THEN 'Scheduled' ELSE 'Ready' END
  END,
  legacy."scheduledStartAt",
  legacy."startedAt",
  legacy."completedAt",
  1
FROM "legacyRecurrenceBlocks" legacy
WHERE legacy."normalizedStartAt" IS NOT NULL
  AND legacy."recurrenceKey" = legacy."normalizedStartAt";

UPDATE "WorkBlock"
SET "recurrenceKey" = (
  SELECT o."occurrenceKey" FROM "TaskOccurrence" o WHERE o."workBlockId" = "WorkBlock"."id"
)
WHERE EXISTS (
  SELECT 1 FROM "TaskOccurrence" o
  WHERE o."workBlockId" = "WorkBlock"."id" AND o."occurrenceKey" <> "WorkBlock"."recurrenceKey"
);


-- Make provider-event scope durable and keep latest pointers monotonic.
ALTER TABLE "RawEventLog" ADD COLUMN "workBlockId" TEXT REFERENCES "WorkBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RawEventLog" ADD COLUMN "occurrenceId" TEXT REFERENCES "TaskOccurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Event" ADD COLUMN "occurrenceId" TEXT REFERENCES "TaskOccurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Event_occurrenceId_ingestSequence_idx" ON "Event"("occurrenceId", "ingestSequence");
ALTER TABLE "Task" ADD COLUMN "latestEventSequence" INTEGER;
ALTER TABLE "TaskPlanRun" ADD COLUMN "latestEventSequence" INTEGER;
ALTER TABLE "TaskPlanRun" ADD COLUMN "executionScopeId" TEXT;
UPDATE "TaskPlanRun" SET "executionScopeId" = 'ES' || lower(hex(randomblob(16))) WHERE "executionScopeId" IS NULL;
CREATE UNIQUE INDEX "TaskPlanRun_executionScopeId_key" ON "TaskPlanRun"("executionScopeId");
ALTER TABLE "WorkBlock" ADD COLUMN "latestEventId" TEXT;
ALTER TABLE "WorkBlock" ADD COLUMN "latestRawEventId" TEXT;
ALTER TABLE "WorkBlock" ADD COLUMN "latestEventSequence" INTEGER;

CREATE TABLE "EventIngestSequence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "value" INTEGER NOT NULL,
  "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "RawEventLog_workBlockId_receivedAt_idx" ON "RawEventLog"("workBlockId", "receivedAt");
CREATE INDEX "RawEventLog_occurrenceId_receivedAt_idx" ON "RawEventLog"("occurrenceId", "receivedAt");

-- Fence task-orchestrator ownership across lease takeovers.
ALTER TABLE "SchedulerLease" ADD COLUMN "epoch" INTEGER NOT NULL DEFAULT 1;


-- Preserve command replay identity beyond the most recently claimed command.
CREATE TABLE "TaskPlanCommandReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "planRunId" TEXT NOT NULL,
  "commandKey" TEXT NOT NULL,
  "commandDigest" TEXT NOT NULL,
  "canonicalizer" TEXT NOT NULL,
  "canonicalizerVersion" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'claimed',
  "result" JSONB,
  "executionEpoch" INTEGER NOT NULL,
  "leaseOwnerId" TEXT,
  "leaseExpiresAt" DATETIME,
  "claimVersion" INTEGER NOT NULL DEFAULT 1,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskPlanCommandReceipt_planRunId_fkey" FOREIGN KEY ("planRunId") REFERENCES "TaskPlanRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TaskPlanCommandReceipt_planRunId_commandKey_key" ON "TaskPlanCommandReceipt"("planRunId", "commandKey");
CREATE INDEX "TaskPlanCommandReceipt_planRunId_executionEpoch_idx" ON "TaskPlanCommandReceipt"("planRunId", "executionEpoch");
CREATE INDEX "TaskPlanCommandReceipt_planRunId_commandDigest_idx" ON "TaskPlanCommandReceipt"("planRunId", "commandDigest");
CREATE INDEX "TaskPlanCommandReceipt_planRunId_status_idx" ON "TaskPlanCommandReceipt"("planRunId", "status");
CREATE INDEX "TaskPlanCommandReceipt_planRunId_status_leaseExpiresAt_idx" ON "TaskPlanCommandReceipt"("planRunId", "status", "leaseExpiresAt");

-- Durable provider approval resolution claims keep human decisions replayable without exposing runtime refs publicly.
CREATE TABLE "TaskPlanProviderApprovalResolution" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "approvalId" TEXT NOT NULL,
  "activeClaimKey" TEXT,
  "providerRunId" TEXT NOT NULL,
  "nodeAttemptId" TEXT NOT NULL,
  "planRunId" TEXT NOT NULL,
  "resolutionKey" TEXT NOT NULL,
  "resolutionDigest" TEXT NOT NULL,
  "canonicalizer" TEXT NOT NULL,
  "canonicalizerVersion" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'claimed',
  "leaseOwner" TEXT,
  "leaseExpiresAt" DATETIME,
  "canonicalResult" JSONB,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TaskPlanProviderApprovalResolution_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskPlanProviderApprovalResolution_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskPlanProviderApprovalResolution_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "TaskPlanProviderApproval" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskPlanProviderApprovalResolution_providerRunId_fkey" FOREIGN KEY ("providerRunId") REFERENCES "TaskPlanProviderRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskPlanProviderApprovalResolution_nodeAttemptId_fkey" FOREIGN KEY ("nodeAttemptId") REFERENCES "TaskPlanNodeAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskPlanProviderApprovalResolution_planRunId_fkey" FOREIGN KEY ("planRunId") REFERENCES "TaskPlanRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TaskPlanProviderApprovalResolution_planRunId_approvalId_resolutionKey_key"
  ON "TaskPlanProviderApprovalResolution"("planRunId", "approvalId", "resolutionKey");
CREATE UNIQUE INDEX "TaskPlanProviderApprovalResolution_activeClaimKey_key"
  ON "TaskPlanProviderApprovalResolution"("activeClaimKey");
CREATE INDEX "TaskPlanProviderApprovalResolution_approvalId_status_idx"
  ON "TaskPlanProviderApprovalResolution"("approvalId", "status");
CREATE INDEX "TaskPlanProviderApprovalResolution_planRunId_resolutionDigest_idx"
  ON "TaskPlanProviderApprovalResolution"("planRunId", "resolutionDigest");
CREATE INDEX "TaskPlanProviderApprovalResolution_providerRunId_status_idx"
  ON "TaskPlanProviderApprovalResolution"("providerRunId", "status");

-- Bind provider audit state to the exact canonical runtime Run. Historical rows
-- are backfilled only when both sides are unambiguous; ambiguous legacy rows
-- remain unbound and recovery fails closed.
ALTER TABLE "TaskPlanProviderRun" ADD COLUMN "aiClientId" TEXT;
ALTER TABLE "TaskPlanProviderRun" ADD COLUMN "aiClientConfigDigest" TEXT;
CREATE INDEX "TaskPlanProviderRun_aiClientId_idx" ON "TaskPlanProviderRun"("aiClientId");

ALTER TABLE "TaskPlanProviderRun" ADD COLUMN "runId" TEXT REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
UPDATE "TaskPlanProviderRun" AS "providerRun"
SET "runId" = (
  SELECT "run"."id"
  FROM "Run" AS "run"
  WHERE "run"."taskId" = "providerRun"."taskId"
    AND "run"."runtimeRunRef" = "providerRun"."providerRunRef"
)
WHERE "providerRun"."providerRunRef" IS NOT NULL
  AND 1 = (
    SELECT COUNT(*) FROM "Run" AS "run"
    WHERE "run"."taskId" = "providerRun"."taskId"
      AND "run"."runtimeRunRef" = "providerRun"."providerRunRef"
  )
  AND 1 = (
    SELECT COUNT(*) FROM "TaskPlanProviderRun" AS "peer"
    WHERE "peer"."taskId" = "providerRun"."taskId"
      AND "peer"."providerRunRef" = "providerRun"."providerRunRef"
  );
CREATE INDEX "TaskPlanProviderRun_runId_idx" ON "TaskPlanProviderRun"("runId");

-- Bind every new canonical runtime Run directly to its immutable node attempt.
-- Historical rows are backfilled only through an already exact ProviderRun FK.
ALTER TABLE "Run" ADD COLUMN "nodeAttemptId" TEXT REFERENCES "TaskPlanNodeAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
UPDATE "Run" AS "run"
SET "nodeAttemptId" = (
  SELECT "providerRun"."nodeAttemptId"
  FROM "TaskPlanProviderRun" AS "providerRun"
  WHERE "providerRun"."runId" = "run"."id"
)
WHERE 1 = (
  SELECT COUNT(*) FROM "TaskPlanProviderRun" AS "providerRun"
  WHERE "providerRun"."runId" = "run"."id"
)
AND 1 = (
  SELECT COUNT(DISTINCT "peer"."runId")
  FROM "TaskPlanProviderRun" AS "peer"
  WHERE "peer"."nodeAttemptId" = (
    SELECT "providerRun"."nodeAttemptId"
    FROM "TaskPlanProviderRun" AS "providerRun"
    WHERE "providerRun"."runId" = "run"."id"
  )
    AND "peer"."runId" IS NOT NULL
);
CREATE UNIQUE INDEX "Run_nodeAttemptId_key" ON "Run"("nodeAttemptId");

-- Bind provider control callbacks to the exact durable provider run.
ALTER TABLE "RunToken" ADD COLUMN "providerRunId" TEXT;
CREATE INDEX "RunToken_providerRunId_idx" ON "RunToken"("providerRunId");

ALTER TABLE "TaskPlanRun" DROP COLUMN "executionCommandKey";

-- Task execution provider selection is owned exclusively by AiClient and the
-- task.execution feature binding. Remove the legacy task/workspace adapter
-- selectors and add immutable provider provenance for new runtime records.
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


-- Converge actual v0.2.0 databases with the development baseline that accidentally moved this DDL into released files.
CREATE TABLE "TaskResultContinuation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "acceptedRunId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "answer" TEXT,
    "answerSource" TEXT,
    "contextSource" TEXT,
    "sourceTaskSessionId" TEXT,
    "providerSessionRef" TEXT,
    "sessionStrategy" TEXT,
    "cacheReadInputTokens" INTEGER,
    "cacheCreationInputTokens" INTEGER,
    "createdTaskId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "TaskResultContinuation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TaskResultContinuation_taskId_requestId_key" ON "TaskResultContinuation"("taskId", "requestId");
CREATE INDEX "TaskResultContinuation_taskId_acceptedRunId_createdAt_idx" ON "TaskResultContinuation"("taskId", "acceptedRunId", "createdAt");
CREATE INDEX "TaskResultContinuation_createdTaskId_idx" ON "TaskResultContinuation"("createdTaskId");

-- A node attempt has exactly one terminal outcome. Existing conflicting records require operator cleanup; see migration preflight.
DROP INDEX "TaskPlanTerminalAction_nodeAttemptId_kind_key";
CREATE UNIQUE INDEX "TaskPlanTerminalAction_nodeAttemptId_key" ON "TaskPlanTerminalAction"("nodeAttemptId");

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

