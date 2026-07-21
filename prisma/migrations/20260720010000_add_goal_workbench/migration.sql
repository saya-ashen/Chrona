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
