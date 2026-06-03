/*
  Warnings:

  - You are about to alter the column `config` on the `AiClient` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `payload` on the `Approval` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `metadata` on the `Artifact` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `payload` on the `Event` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `affectedNodeIds` on the `GraphMutationRecord` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `payload` on the `GraphMutationRecord` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `validationResult` on the `GraphMutationRecord` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `graph` on the `GraphVersion` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `metadata` on the `RawEventLog` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `rawPayload` on the `RawEventLog` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `redactionMetadata` on the `RawEventLog` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `issues` on the `ReconciliationEvent` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `repairActions` on the `ReconciliationEvent` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `runtimeConfigSnapshot` on the `Run` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `payload` on the `SchedulerEvent` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `metadata` on the `SchedulerLease` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `blockReason` on the `Task` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `executionConfig` on the `Task` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `proposal` on the `TaskAssistantMessage` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `compiledPlan` on the `TaskPlan` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `editablePlan` on the `TaskPlan` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `layer` on the `TaskPlanLayer` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `error` on the `TaskPlanNodeAttempt` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `runtimeSnapshot` on the `TaskPlanNodeAttempt` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `planRun` on the `TaskPlanRun` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `metadata` on the `TaskTimelineItem` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `errorPayload` on the `ToolInvocation` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `inputPayload` on the `ToolInvocation` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `outputPayload` on the `ToolInvocation` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AiClient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AiClient" ("config", "createdAt", "enabled", "id", "isDefault", "name", "type", "updatedAt") SELECT "config", "createdAt", "enabled", "id", "isDefault", "name", "type", "updatedAt" FROM "AiClient";
DROP TABLE "AiClient";
ALTER TABLE "new_AiClient" RENAME TO "AiClient";
CREATE TABLE "new_AiFeatureBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feature" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiFeatureBinding_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "AiClient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AiFeatureBinding" ("clientId", "createdAt", "feature", "id") SELECT "clientId", "createdAt", "feature", "id" FROM "AiFeatureBinding";
DROP TABLE "AiFeatureBinding";
ALTER TABLE "new_AiFeatureBinding" RENAME TO "AiFeatureBinding";
CREATE UNIQUE INDEX "AiFeatureBinding_feature_key" ON "AiFeatureBinding"("feature");
CREATE TABLE "new_Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL,
    "requestedAt" DATETIME NOT NULL,
    "resolvedAt" DATETIME,
    "resolvedBy" TEXT,
    "resolutionNote" TEXT,
    CONSTRAINT "Approval_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Approval_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Approval_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Approval" ("id", "payload", "requestedAt", "resolutionNote", "resolvedAt", "resolvedBy", "riskLevel", "runId", "status", "summary", "taskId", "title", "type", "workspaceId") SELECT "id", "payload", "requestedAt", "resolutionNote", "resolvedAt", "resolvedBy", "riskLevel", "runId", "status", "summary", "taskId", "title", "type", "workspaceId" FROM "Approval";
DROP TABLE "Approval";
ALTER TABLE "new_Approval" RENAME TO "Approval";
CREATE INDEX "Approval_workspaceId_status_idx" ON "Approval"("workspaceId", "status");
CREATE INDEX "Approval_taskId_status_idx" ON "Approval"("taskId", "status");
CREATE INDEX "Approval_runId_status_idx" ON "Approval"("runId", "status");
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Artifact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Artifact_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Artifact" ("contentPreview", "createdAt", "id", "metadata", "runId", "taskId", "title", "type", "uri", "workspaceId") SELECT "contentPreview", "createdAt", "id", "metadata", "runId", "taskId", "title", "type", "uri", "workspaceId" FROM "Artifact";
DROP TABLE "Artifact";
ALTER TABLE "new_Artifact" RENAME TO "Artifact";
CREATE INDEX "Artifact_workspaceId_type_idx" ON "Artifact"("workspaceId", "type");
CREATE INDEX "Artifact_taskId_createdAt_idx" ON "Artifact"("taskId", "createdAt");
CREATE INDEX "Artifact_runId_createdAt_idx" ON "Artifact"("runId", "createdAt");
CREATE TABLE "new_CalendarSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'subscription',
    "sourceUrl" TEXT NOT NULL,
    "redactedUrlLabel" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "lifecycleState" TEXT NOT NULL DEFAULT 'active',
    "syncPolicy" TEXT NOT NULL DEFAULT 'keep_active',
    "automationPolicy" TEXT NOT NULL DEFAULT 'auto_plan',
    "syncState" TEXT NOT NULL DEFAULT 'idle',
    "lastSuccessfulRefreshAt" DATETIME,
    "nextExpectedRefreshAt" DATETIME,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "blockedNetworkConfirmedAt" DATETIME,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CalendarSource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CalendarSource" ("automationPolicy", "blockedNetworkConfirmedAt", "color", "createdAt", "id", "importedCount", "lastErrorCode", "lastErrorMessage", "lastSuccessfulRefreshAt", "lifecycleState", "name", "nextExpectedRefreshAt", "redactedUrlLabel", "skippedCount", "sourceType", "sourceUrl", "syncPolicy", "syncState", "updatedAt", "workspaceId") SELECT "automationPolicy", "blockedNetworkConfirmedAt", "color", "createdAt", "id", "importedCount", "lastErrorCode", "lastErrorMessage", "lastSuccessfulRefreshAt", "lifecycleState", "name", "nextExpectedRefreshAt", "redactedUrlLabel", "skippedCount", "sourceType", "sourceUrl", "syncPolicy", "syncState", "updatedAt", "workspaceId" FROM "CalendarSource";
DROP TABLE "CalendarSource";
ALTER TABLE "new_CalendarSource" RENAME TO "CalendarSource";
CREATE INDEX "CalendarSource_workspaceId_lifecycleState_idx" ON "CalendarSource"("workspaceId", "lifecycleState");
CREATE UNIQUE INDEX "CalendarSource_workspaceId_sourceUrl_key" ON "CalendarSource"("workspaceId", "sourceUrl");
CREATE TABLE "new_ConversationEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "runtimeTs" DATETIME,
    "sequence" INTEGER NOT NULL,
    "externalRef" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationEntry_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ConversationEntry" ("content", "createdAt", "externalRef", "id", "role", "runId", "runtimeTs", "sequence") SELECT "content", "createdAt", "externalRef", "id", "role", "runId", "runtimeTs", "sequence" FROM "ConversationEntry";
DROP TABLE "ConversationEntry";
ALTER TABLE "new_ConversationEntry" RENAME TO "ConversationEntry";
CREATE UNIQUE INDEX "ConversationEntry_externalRef_key" ON "ConversationEntry"("externalRef");
CREATE INDEX "ConversationEntry_runId_sequence_idx" ON "ConversationEntry"("runId", "sequence");
CREATE TABLE "new_Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventType" TEXT NOT NULL,
    "eventVersion" INTEGER NOT NULL DEFAULT 1,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT,
    "workBlockId" TEXT,
    "runId" TEXT,
    "taskSessionId" TEXT,
    "executionSessionId" TEXT,
    "planId" TEXT,
    "planRunId" TEXT,
    "nodeAttemptId" TEXT,
    "providerRunId" TEXT,
    "nodeId" TEXT,
    "nodeTitle" TEXT,
    "rawEventId" TEXT,
    "parentEventId" TEXT,
    "causationEventId" TEXT,
    "correlationId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "source" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "summary" TEXT,
    "severity" TEXT,
    "dedupeKey" TEXT,
    "occurredAt" DATETIME,
    "ingestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ingestSequence" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Event_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Event_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_workBlockId_fkey" FOREIGN KEY ("workBlockId") REFERENCES "WorkBlock" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Event_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_rawEventId_fkey" FOREIGN KEY ("rawEventId") REFERENCES "RawEventLog" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Event" ("actorId", "actorType", "causationEventId", "correlationId", "createdAt", "dedupeKey", "eventType", "eventVersion", "executionSessionId", "id", "ingestSequence", "ingestedAt", "nodeAttemptId", "nodeId", "nodeTitle", "occurredAt", "parentEventId", "payload", "planId", "planRunId", "providerRunId", "rawEventId", "runId", "severity", "source", "summary", "taskId", "taskSessionId", "workspaceId") SELECT "actorId", "actorType", "causationEventId", "correlationId", "createdAt", "dedupeKey", "eventType", "eventVersion", "executionSessionId", "id", "ingestSequence", "ingestedAt", "nodeAttemptId", "nodeId", "nodeTitle", "occurredAt", "parentEventId", "payload", "planId", "planRunId", "providerRunId", "rawEventId", "runId", "severity", "source", "summary", "taskId", "taskSessionId", "workspaceId" FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
CREATE UNIQUE INDEX "Event_dedupeKey_key" ON "Event"("dedupeKey");
CREATE INDEX "Event_taskId_workBlockId_ingestSequence_idx" ON "Event"("taskId", "workBlockId", "ingestSequence");
CREATE INDEX "Event_taskId_nodeId_workBlockId_ingestSequence_idx" ON "Event"("taskId", "nodeId", "workBlockId", "ingestSequence");
CREATE INDEX "Event_runId_ingestSequence_idx" ON "Event"("runId", "ingestSequence");
CREATE INDEX "Event_nodeAttemptId_ingestSequence_idx" ON "Event"("nodeAttemptId", "ingestSequence");
CREATE INDEX "Event_correlationId_ingestSequence_idx" ON "Event"("correlationId", "ingestSequence");
CREATE INDEX "Event_workspaceId_eventType_ingestSequence_idx" ON "Event"("workspaceId", "eventType", "ingestSequence");
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
    CONSTRAINT "ExecutionSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExecutionSession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExecutionSession_workBlockId_fkey" FOREIGN KEY ("workBlockId") REFERENCES "WorkBlock" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ExecutionSession" ("completedAt", "completedNodeIds", "createdAt", "currentNodeAttemptId", "currentNodeId", "id", "latestEventId", "latestRawEventId", "pauseReason", "pausedAt", "pausedByEventId", "pausedByRawEventId", "planId", "startedAt", "status", "taskId", "updatedAt", "workBlockId", "workspaceId") SELECT "completedAt", "completedNodeIds", "createdAt", "currentNodeAttemptId", "currentNodeId", "id", "latestEventId", "latestRawEventId", "pauseReason", "pausedAt", "pausedByEventId", "pausedByRawEventId", "planId", "startedAt", "status", "taskId", "updatedAt", "workBlockId", "workspaceId" FROM "ExecutionSession";
DROP TABLE "ExecutionSession";
ALTER TABLE "new_ExecutionSession" RENAME TO "ExecutionSession";
CREATE INDEX "ExecutionSession_workspaceId_status_idx" ON "ExecutionSession"("workspaceId", "status");
CREATE INDEX "ExecutionSession_taskId_status_idx" ON "ExecutionSession"("taskId", "status");
CREATE INDEX "ExecutionSession_workBlockId_idx" ON "ExecutionSession"("workBlockId");
CREATE TABLE "new_GraphMutationRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "baseGraphVersion" INTEGER NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "payload" JSONB NOT NULL,
    "validationResult" JSONB,
    "affectedNodeIds" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" DATETIME,
    CONSTRAINT "GraphMutationRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GraphMutationRecord_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GraphMutationRecord" ("affectedNodeIds", "appliedAt", "baseGraphVersion", "createdAt", "createdBy", "id", "operation", "payload", "status", "taskId", "validationResult", "workspaceId") SELECT "affectedNodeIds", "appliedAt", "baseGraphVersion", "createdAt", "createdBy", "id", "operation", "payload", "status", "taskId", "validationResult", "workspaceId" FROM "GraphMutationRecord";
DROP TABLE "GraphMutationRecord";
ALTER TABLE "new_GraphMutationRecord" RENAME TO "GraphMutationRecord";
CREATE INDEX "GraphMutationRecord_workspaceId_status_createdAt_idx" ON "GraphMutationRecord"("workspaceId", "status", "createdAt");
CREATE INDEX "GraphMutationRecord_taskId_baseGraphVersion_status_idx" ON "GraphMutationRecord"("taskId", "baseGraphVersion", "status");
CREATE TABLE "new_GraphVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GraphVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GraphVersion_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GraphVersion" ("createdAt", "createdBy", "graph", "id", "taskId", "version", "workspaceId") SELECT "createdAt", "createdBy", "graph", "id", "taskId", "version", "workspaceId" FROM "GraphVersion";
DROP TABLE "GraphVersion";
ALTER TABLE "new_GraphVersion" RENAME TO "GraphVersion";
CREATE INDEX "GraphVersion_workspaceId_taskId_version_idx" ON "GraphVersion"("workspaceId", "taskId", "version");
CREATE UNIQUE INDEX "GraphVersion_taskId_version_key" ON "GraphVersion"("taskId", "version");
CREATE TABLE "new_ImportedCalendarEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "calendarSourceId" TEXT NOT NULL,
    "taskId" TEXT,
    "workBlockId" TEXT,
    "externalUid" TEXT NOT NULL,
    "recurrenceId" TEXT,
    "recurrenceRule" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportedCalendarEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportedCalendarEvent_calendarSourceId_fkey" FOREIGN KEY ("calendarSourceId") REFERENCES "CalendarSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportedCalendarEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ImportedCalendarEvent_workBlockId_fkey" FOREIGN KEY ("workBlockId") REFERENCES "WorkBlock" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ImportedCalendarEvent" ("calendarSourceId", "createdAt", "dedupeKey", "description", "endsAt", "externalUid", "id", "isAllDay", "recurrenceId", "recurrenceRule", "startsAt", "status", "taskId", "title", "updatedAt", "workBlockId", "workspaceId") SELECT "calendarSourceId", "createdAt", "dedupeKey", "description", "endsAt", "externalUid", "id", "isAllDay", "recurrenceId", "recurrenceRule", "startsAt", "status", "taskId", "title", "updatedAt", "workBlockId", "workspaceId" FROM "ImportedCalendarEvent";
DROP TABLE "ImportedCalendarEvent";
ALTER TABLE "new_ImportedCalendarEvent" RENAME TO "ImportedCalendarEvent";
CREATE UNIQUE INDEX "ImportedCalendarEvent_workBlockId_key" ON "ImportedCalendarEvent"("workBlockId");
CREATE INDEX "ImportedCalendarEvent_taskId_idx" ON "ImportedCalendarEvent"("taskId");
CREATE INDEX "ImportedCalendarEvent_workspaceId_startsAt_endsAt_idx" ON "ImportedCalendarEvent"("workspaceId", "startsAt", "endsAt");
CREATE INDEX "ImportedCalendarEvent_calendarSourceId_startsAt_idx" ON "ImportedCalendarEvent"("calendarSourceId", "startsAt");
CREATE UNIQUE INDEX "ImportedCalendarEvent_calendarSourceId_dedupeKey_key" ON "ImportedCalendarEvent"("calendarSourceId", "dedupeKey");
CREATE TABLE "new_Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT,
    "sourceRunId" TEXT,
    "content" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "confidence" REAL,
    "status" TEXT NOT NULL,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Memory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Memory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Memory" ("confidence", "content", "createdAt", "expiresAt", "id", "scope", "sourceRunId", "sourceType", "status", "taskId", "updatedAt", "workspaceId") SELECT "confidence", "content", "createdAt", "expiresAt", "id", "scope", "sourceRunId", "sourceType", "status", "taskId", "updatedAt", "workspaceId" FROM "Memory";
DROP TABLE "Memory";
ALTER TABLE "new_Memory" RENAME TO "Memory";
CREATE INDEX "Memory_workspaceId_scope_status_idx" ON "Memory"("workspaceId", "scope", "status");
CREATE INDEX "Memory_taskId_idx" ON "Memory"("taskId");
CREATE TABLE "new_RawEventLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT,
    "runId" TEXT,
    "taskSessionId" TEXT,
    "executionSessionId" TEXT,
    "planId" TEXT,
    "planRunId" TEXT,
    "nodeAttemptId" TEXT,
    "providerRunId" TEXT,
    "nodeId" TEXT,
    "nodeTitle" TEXT,
    "source" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "rawType" TEXT NOT NULL,
    "provider" TEXT,
    "runtimeName" TEXT,
    "rawPayload" JSONB,
    "rawText" TEXT,
    "metadata" JSONB,
    "nativeRunId" TEXT,
    "nativeEventId" TEXT,
    "nativeToolCallId" TEXT,
    "externalRef" TEXT,
    "sequence" INTEGER,
    "correlationId" TEXT,
    "parentRawEventId" TEXT,
    "causationRawEventId" TEXT,
    "payloadHash" TEXT NOT NULL,
    "redactionState" TEXT NOT NULL DEFAULT 'none',
    "redactionMetadata" JSONB,
    "occurredAt" DATETIME,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RawEventLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RawEventLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RawEventLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RawEventLog" ("causationRawEventId", "correlationId", "createdAt", "direction", "executionSessionId", "externalRef", "id", "metadata", "nativeEventId", "nativeRunId", "nativeToolCallId", "nodeAttemptId", "nodeId", "nodeTitle", "occurredAt", "parentRawEventId", "payloadHash", "planId", "planRunId", "provider", "providerRunId", "rawPayload", "rawText", "rawType", "receivedAt", "redactionMetadata", "redactionState", "runId", "runtimeName", "sequence", "source", "taskId", "taskSessionId", "workspaceId") SELECT "causationRawEventId", "correlationId", "createdAt", "direction", "executionSessionId", "externalRef", "id", "metadata", "nativeEventId", "nativeRunId", "nativeToolCallId", "nodeAttemptId", "nodeId", "nodeTitle", "occurredAt", "parentRawEventId", "payloadHash", "planId", "planRunId", "provider", "providerRunId", "rawPayload", "rawText", "rawType", "receivedAt", "redactionMetadata", "redactionState", "runId", "runtimeName", "sequence", "source", "taskId", "taskSessionId", "workspaceId" FROM "RawEventLog";
DROP TABLE "RawEventLog";
ALTER TABLE "new_RawEventLog" RENAME TO "RawEventLog";
CREATE INDEX "RawEventLog_taskId_receivedAt_idx" ON "RawEventLog"("taskId", "receivedAt");
CREATE INDEX "RawEventLog_runId_sequence_idx" ON "RawEventLog"("runId", "sequence");
CREATE INDEX "RawEventLog_nodeAttemptId_receivedAt_idx" ON "RawEventLog"("nodeAttemptId", "receivedAt");
CREATE INDEX "RawEventLog_correlationId_receivedAt_idx" ON "RawEventLog"("correlationId", "receivedAt");
CREATE INDEX "RawEventLog_nativeToolCallId_idx" ON "RawEventLog"("nativeToolCallId");
CREATE INDEX "RawEventLog_workspaceId_source_receivedAt_idx" ON "RawEventLog"("workspaceId", "source", "receivedAt");
CREATE UNIQUE INDEX "RawEventLog_source_externalRef_key" ON "RawEventLog"("source", "externalRef");
CREATE TABLE "new_ReconciliationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "graphVersion" INTEGER NOT NULL,
    "executionState" TEXT NOT NULL,
    "currentNodeId" TEXT,
    "issues" JSONB,
    "repairActions" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReconciliationEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReconciliationEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ReconciliationEvent" ("createdAt", "currentNodeId", "executionState", "graphVersion", "id", "issues", "repairActions", "taskId", "workspaceId") SELECT "createdAt", "currentNodeId", "executionState", "graphVersion", "id", "issues", "repairActions", "taskId", "workspaceId" FROM "ReconciliationEvent";
DROP TABLE "ReconciliationEvent";
ALTER TABLE "new_ReconciliationEvent" RENAME TO "ReconciliationEvent";
CREATE INDEX "ReconciliationEvent_workspaceId_createdAt_idx" ON "ReconciliationEvent"("workspaceId", "createdAt");
CREATE INDEX "ReconciliationEvent_taskId_graphVersion_createdAt_idx" ON "ReconciliationEvent"("taskId", "graphVersion", "createdAt");
CREATE TABLE "new_Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
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
    CONSTRAINT "Run_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Run_taskSessionId_fkey" FOREIGN KEY ("taskSessionId") REFERENCES "TaskSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Run" ("createdAt", "endedAt", "errorSummary", "id", "lastSyncedAt", "mappingPartial", "pendingInputPrompt", "pendingInputType", "resumeSupported", "resumeToken", "retryable", "runtimeConfigSnapshot", "runtimeConfigVersion", "runtimeName", "runtimeRunRef", "runtimeSessionRef", "startedAt", "status", "syncStatus", "taskId", "taskSessionId", "triggeredBy", "updatedAt") SELECT "createdAt", "endedAt", "errorSummary", "id", "lastSyncedAt", "mappingPartial", "pendingInputPrompt", "pendingInputType", "resumeSupported", "resumeToken", "retryable", "runtimeConfigSnapshot", "runtimeConfigVersion", "runtimeName", "runtimeRunRef", "runtimeSessionRef", "startedAt", "status", "syncStatus", "taskId", "taskSessionId", "triggeredBy", "updatedAt" FROM "Run";
DROP TABLE "Run";
ALTER TABLE "new_Run" RENAME TO "Run";
CREATE UNIQUE INDEX "Run_runtimeRunRef_key" ON "Run"("runtimeRunRef");
CREATE INDEX "Run_taskId_status_idx" ON "Run"("taskId", "status");
CREATE INDEX "Run_taskSessionId_status_idx" ON "Run"("taskSessionId", "status");
CREATE INDEX "Run_runtimeName_status_idx" ON "Run"("runtimeName", "status");
CREATE TABLE "new_ScheduleProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "proposedBy" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "dueAt" DATETIME,
    "scheduledStartAt" DATETIME,
    "scheduledEndAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "resolutionNote" TEXT,
    CONSTRAINT "ScheduleProposal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScheduleProposal_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ScheduleProposal" ("createdAt", "dueAt", "id", "proposedBy", "resolutionNote", "resolvedAt", "scheduledEndAt", "scheduledStartAt", "source", "status", "summary", "taskId", "workspaceId") SELECT "createdAt", "dueAt", "id", "proposedBy", "resolutionNote", "resolvedAt", "scheduledEndAt", "scheduledStartAt", "source", "status", "summary", "taskId", "workspaceId" FROM "ScheduleProposal";
DROP TABLE "ScheduleProposal";
ALTER TABLE "new_ScheduleProposal" RENAME TO "ScheduleProposal";
CREATE INDEX "ScheduleProposal_workspaceId_status_idx" ON "ScheduleProposal"("workspaceId", "status");
CREATE INDEX "ScheduleProposal_taskId_status_idx" ON "ScheduleProposal"("taskId", "status");
CREATE TABLE "new_SchedulerEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "graphVersion" INTEGER,
    "eventType" TEXT NOT NULL,
    "reason" TEXT,
    "payload" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SchedulerEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SchedulerEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SchedulerEvent" ("createdAt", "eventType", "graphVersion", "id", "payload", "reason", "taskId", "workspaceId") SELECT "createdAt", "eventType", "graphVersion", "id", "payload", "reason", "taskId", "workspaceId" FROM "SchedulerEvent";
DROP TABLE "SchedulerEvent";
ALTER TABLE "new_SchedulerEvent" RENAME TO "SchedulerEvent";
CREATE INDEX "SchedulerEvent_workspaceId_eventType_createdAt_idx" ON "SchedulerEvent"("workspaceId", "eventType", "createdAt");
CREATE INDEX "SchedulerEvent_taskId_createdAt_idx" ON "SchedulerEvent"("taskId", "createdAt");
CREATE TABLE "new_SchedulerLease" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "heartbeatAt" DATETIME NOT NULL,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SchedulerLease" ("createdAt", "expiresAt", "heartbeatAt", "metadata", "name", "ownerId", "updatedAt") SELECT "createdAt", "expiresAt", "heartbeatAt", "metadata", "name", "ownerId", "updatedAt" FROM "SchedulerLease";
DROP TABLE "SchedulerLease";
ALTER TABLE "new_SchedulerLease" RENAME TO "SchedulerLease";
CREATE INDEX "SchedulerLease_ownerId_idx" ON "SchedulerLease"("ownerId");
CREATE INDEX "SchedulerLease_expiresAt_idx" ON "SchedulerLease"("expiresAt");
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
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
    "defaultSessionId" TEXT,
    "latestRunId" TEXT,
    "latestEventId" TEXT,
    "latestRawEventId" TEXT,
    "blockedByEventId" TEXT,
    "blockedByRawEventId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "Task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("autoExecute", "autoExecuteTiming", "autoPlanGeneration", "autoPlanGenerationTiming", "blockReason", "blockedByEventId", "blockedByRawEventId", "completedAt", "createdAt", "defaultSessionId", "description", "dueAt", "executionConfig", "executionRuntime", "id", "kind", "latestEventId", "latestRawEventId", "latestRunId", "parentTaskId", "priority", "recurrenceAnchorEndAt", "recurrenceAnchorStartAt", "recurrenceRule", "recurrenceWindowUntil", "seriesExternalUid", "status", "title", "updatedAt", "workspaceId") SELECT "autoExecute", "autoExecuteTiming", "autoPlanGeneration", "autoPlanGenerationTiming", "blockReason", "blockedByEventId", "blockedByRawEventId", "completedAt", "createdAt", "defaultSessionId", "description", "dueAt", "executionConfig", "executionRuntime", "id", "kind", "latestEventId", "latestRawEventId", "latestRunId", "parentTaskId", "priority", "recurrenceAnchorEndAt", "recurrenceAnchorStartAt", "recurrenceRule", "recurrenceWindowUntil", "seriesExternalUid", "status", "title", "updatedAt", "workspaceId" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_workspaceId_status_idx" ON "Task"("workspaceId", "status");
CREATE INDEX "Task_workspaceId_priority_idx" ON "Task"("workspaceId", "priority");
CREATE INDEX "Task_workspaceId_seriesExternalUid_idx" ON "Task"("workspaceId", "seriesExternalUid");
CREATE INDEX "Task_defaultSessionId_idx" ON "Task"("defaultSessionId");
CREATE TABLE "new_TaskAssistantMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "proposal" JSONB,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "appliedAt" DATETIME,
    "sequence" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskAssistantMessage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TaskAssistantMessage" ("applied", "appliedAt", "content", "createdAt", "id", "proposal", "role", "sequence", "taskId") SELECT "applied", "appliedAt", "content", "createdAt", "id", "proposal", "role", "sequence", "taskId" FROM "TaskAssistantMessage";
DROP TABLE "TaskAssistantMessage";
ALTER TABLE "new_TaskAssistantMessage" RENAME TO "TaskAssistantMessage";
CREATE INDEX "TaskAssistantMessage_taskId_sequence_idx" ON "TaskAssistantMessage"("taskId", "sequence");
CREATE TABLE "new_TaskDependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,
    "dependencyType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskDependency_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskDependency_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TaskDependency" ("createdAt", "dependencyType", "dependsOnTaskId", "id", "taskId", "workspaceId") SELECT "createdAt", "dependencyType", "dependsOnTaskId", "id", "taskId", "workspaceId" FROM "TaskDependency";
DROP TABLE "TaskDependency";
ALTER TABLE "new_TaskDependency" RENAME TO "TaskDependency";
CREATE INDEX "TaskDependency_workspaceId_taskId_idx" ON "TaskDependency"("workspaceId", "taskId");
CREATE INDEX "TaskDependency_workspaceId_dependsOnTaskId_idx" ON "TaskDependency"("workspaceId", "dependsOnTaskId");
CREATE UNIQUE INDEX "TaskDependency_taskId_dependsOnTaskId_key" ON "TaskDependency"("taskId", "dependsOnTaskId");
CREATE TABLE "new_TaskPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workBlockId" TEXT,
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
    CONSTRAINT "TaskPlan_workBlockId_fkey" FOREIGN KEY ("workBlockId") REFERENCES "WorkBlock" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TaskPlan" ("compiledPlan", "createdAt", "editablePlan", "generatedBy", "id", "planId", "prompt", "revision", "status", "summary", "taskId", "updatedAt", "workBlockId", "workspaceId") SELECT "compiledPlan", "createdAt", "editablePlan", "generatedBy", "id", "planId", "prompt", "revision", "status", "summary", "taskId", "updatedAt", "workBlockId", "workspaceId" FROM "TaskPlan";
DROP TABLE "TaskPlan";
ALTER TABLE "new_TaskPlan" RENAME TO "TaskPlan";
CREATE UNIQUE INDEX "TaskPlan_planId_key" ON "TaskPlan"("planId");
CREATE INDEX "TaskPlan_workspaceId_taskId_updatedAt_idx" ON "TaskPlan"("workspaceId", "taskId", "updatedAt");
CREATE INDEX "TaskPlan_taskId_workBlockId_status_updatedAt_idx" ON "TaskPlan"("taskId", "workBlockId", "status", "updatedAt");
CREATE INDEX "TaskPlan_workBlockId_status_updatedAt_idx" ON "TaskPlan"("workBlockId", "status", "updatedAt");
CREATE TABLE "new_TaskPlanLayer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "layerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "layer" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskPlanLayer_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanLayer_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanLayer_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TaskPlan" ("planId") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TaskPlanLayer" ("createdAt", "id", "layer", "layerId", "planId", "taskId", "updatedAt", "version", "workspaceId") SELECT "createdAt", "id", "layer", "layerId", "planId", "taskId", "updatedAt", "version", "workspaceId" FROM "TaskPlanLayer";
DROP TABLE "TaskPlanLayer";
ALTER TABLE "new_TaskPlanLayer" RENAME TO "TaskPlanLayer";
CREATE UNIQUE INDEX "TaskPlanLayer_layerId_key" ON "TaskPlanLayer"("layerId");
CREATE INDEX "TaskPlanLayer_taskId_planId_version_idx" ON "TaskPlanLayer"("taskId", "planId", "version");
CREATE INDEX "TaskPlanLayer_workspaceId_taskId_createdAt_idx" ON "TaskPlanLayer"("workspaceId", "taskId", "createdAt");
CREATE TABLE "new_TaskPlanNodeAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planRunId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeLayerId" TEXT NOT NULL,
    "executionContextSnapshotId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "executionEpoch" INTEGER NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "error" JSONB,
    "runtimeSnapshot" JSONB,
    "startedByEventId" TEXT,
    "completedByEventId" TEXT,
    "failedByEventId" TEXT,
    "blockedByEventId" TEXT,
    "inputRawEventId" TEXT,
    "outputRawEventId" TEXT,
    "errorRawEventId" TEXT,
    "selectedBranchRef" TEXT,
    "selectedNextNodeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskPlanNodeAttempt_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanNodeAttempt_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanNodeAttempt_planRunId_fkey" FOREIGN KEY ("planRunId") REFERENCES "TaskPlanRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TaskPlanNodeAttempt" ("attemptNumber", "blockedByEventId", "completedByEventId", "createdAt", "error", "errorRawEventId", "executionContextSnapshotId", "executionEpoch", "failedByEventId", "finishedAt", "id", "idempotencyKey", "inputRawEventId", "nodeId", "nodeLayerId", "outputRawEventId", "planId", "planRunId", "runtimeSnapshot", "selectedBranchRef", "selectedNextNodeId", "startedAt", "startedByEventId", "status", "taskId", "updatedAt", "workspaceId") SELECT "attemptNumber", "blockedByEventId", "completedByEventId", "createdAt", "error", "errorRawEventId", "executionContextSnapshotId", "executionEpoch", "failedByEventId", "finishedAt", "id", "idempotencyKey", "inputRawEventId", "nodeId", "nodeLayerId", "outputRawEventId", "planId", "planRunId", "runtimeSnapshot", "selectedBranchRef", "selectedNextNodeId", "startedAt", "startedByEventId", "status", "taskId", "updatedAt", "workspaceId" FROM "TaskPlanNodeAttempt";
DROP TABLE "TaskPlanNodeAttempt";
ALTER TABLE "new_TaskPlanNodeAttempt" RENAME TO "TaskPlanNodeAttempt";
CREATE UNIQUE INDEX "TaskPlanNodeAttempt_idempotencyKey_key" ON "TaskPlanNodeAttempt"("idempotencyKey");
CREATE INDEX "TaskPlanNodeAttempt_taskId_planId_nodeId_status_idx" ON "TaskPlanNodeAttempt"("taskId", "planId", "nodeId", "status");
CREATE INDEX "TaskPlanNodeAttempt_planRunId_nodeId_attemptNumber_idx" ON "TaskPlanNodeAttempt"("planRunId", "nodeId", "attemptNumber");
CREATE TABLE "new_TaskPlanProviderRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planRunId" TEXT NOT NULL,
    "nodeAttemptId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerRunRef" TEXT,
    "runtimeName" TEXT,
    "nativeRunId" TEXT,
    "firstRawEventId" TEXT,
    "lastRawEventId" TEXT,
    "completedByEventId" TEXT,
    "failedByEventId" TEXT,
    "correlationId" TEXT,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskPlanProviderRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanProviderRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanProviderRun_planRunId_fkey" FOREIGN KEY ("planRunId") REFERENCES "TaskPlanRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanProviderRun_nodeAttemptId_fkey" FOREIGN KEY ("nodeAttemptId") REFERENCES "TaskPlanNodeAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TaskPlanProviderRun" ("completedByEventId", "correlationId", "createdAt", "failedByEventId", "finishedAt", "firstRawEventId", "id", "idempotencyKey", "lastRawEventId", "nativeRunId", "nodeAttemptId", "planId", "planRunId", "providerRunRef", "runtimeName", "startedAt", "status", "taskId", "updatedAt", "workspaceId") SELECT "completedByEventId", "correlationId", "createdAt", "failedByEventId", "finishedAt", "firstRawEventId", "id", "idempotencyKey", "lastRawEventId", "nativeRunId", "nodeAttemptId", "planId", "planRunId", "providerRunRef", "runtimeName", "startedAt", "status", "taskId", "updatedAt", "workspaceId" FROM "TaskPlanProviderRun";
DROP TABLE "TaskPlanProviderRun";
ALTER TABLE "new_TaskPlanProviderRun" RENAME TO "TaskPlanProviderRun";
CREATE UNIQUE INDEX "TaskPlanProviderRun_idempotencyKey_key" ON "TaskPlanProviderRun"("idempotencyKey");
CREATE INDEX "TaskPlanProviderRun_taskId_planId_status_idx" ON "TaskPlanProviderRun"("taskId", "planId", "status");
CREATE INDEX "TaskPlanProviderRun_nodeAttemptId_status_idx" ON "TaskPlanProviderRun"("nodeAttemptId", "status");
CREATE TABLE "new_TaskPlanRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workBlockId" TEXT,
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
    CONSTRAINT "TaskPlanRun_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TaskPlan" ("planId") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TaskPlanRun" ("createdAt", "executionEpoch", "executionLeaseUntil", "executionOwnerId", "executionOwnerScope", "id", "latestEventId", "latestRawEventId", "planId", "planRun", "taskId", "updatedAt", "workBlockId", "workspaceId") SELECT "createdAt", "executionEpoch", "executionLeaseUntil", "executionOwnerId", "executionOwnerScope", "id", "latestEventId", "latestRawEventId", "planId", "planRun", "taskId", "updatedAt", "workBlockId", "workspaceId" FROM "TaskPlanRun";
DROP TABLE "TaskPlanRun";
ALTER TABLE "new_TaskPlanRun" RENAME TO "TaskPlanRun";
CREATE INDEX "TaskPlanRun_taskId_planId_executionOwnerId_idx" ON "TaskPlanRun"("taskId", "planId", "executionOwnerId");
CREATE INDEX "TaskPlanRun_taskId_workBlockId_planId_idx" ON "TaskPlanRun"("taskId", "workBlockId", "planId");
CREATE INDEX "TaskPlanRun_executionLeaseUntil_idx" ON "TaskPlanRun"("executionLeaseUntil");
CREATE INDEX "TaskPlanRun_workspaceId_taskId_updatedAt_idx" ON "TaskPlanRun"("workspaceId", "taskId", "updatedAt");
CREATE UNIQUE INDEX "TaskPlanRun_taskId_planId_workBlockId_key" ON "TaskPlanRun"("taskId", "planId", "workBlockId");
CREATE TABLE "new_TaskSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "runtimeName" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "lastRunStatus" TEXT,
    "activeRunId" TEXT,
    "lastRunRef" TEXT,
    "createdByFramework" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskSession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TaskSession" ("activeRunId", "createdAt", "createdByFramework", "id", "label", "lastRunRef", "lastRunStatus", "runtimeName", "sessionKey", "status", "taskId", "updatedAt") SELECT "activeRunId", "createdAt", "createdByFramework", "id", "label", "lastRunRef", "lastRunStatus", "runtimeName", "sessionKey", "status", "taskId", "updatedAt" FROM "TaskSession";
DROP TABLE "TaskSession";
ALTER TABLE "new_TaskSession" RENAME TO "TaskSession";
CREATE UNIQUE INDEX "TaskSession_sessionKey_key" ON "TaskSession"("sessionKey");
CREATE INDEX "TaskSession_taskId_createdAt_idx" ON "TaskSession"("taskId", "createdAt");
CREATE INDEX "TaskSession_taskId_status_idx" ON "TaskSession"("taskId", "status");
CREATE TABLE "new_TaskTimelineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workBlockId" TEXT,
    "runId" TEXT,
    "executionSessionId" TEXT,
    "nodeId" TEXT,
    "nodeAttemptId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "severity" TEXT,
    "status" TEXT,
    "eventId" TEXT,
    "rawEventId" TEXT,
    "toolInvocationId" TEXT,
    "sortTime" DATETIME NOT NULL,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskTimelineItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskTimelineItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskTimelineItem_workBlockId_fkey" FOREIGN KEY ("workBlockId") REFERENCES "WorkBlock" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TaskTimelineItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskTimelineItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TaskTimelineItem_rawEventId_fkey" FOREIGN KEY ("rawEventId") REFERENCES "RawEventLog" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TaskTimelineItem" ("body", "createdAt", "eventId", "executionSessionId", "id", "kind", "metadata", "nodeAttemptId", "nodeId", "rawEventId", "runId", "severity", "sortTime", "status", "taskId", "title", "toolInvocationId", "workspaceId") SELECT "body", "createdAt", "eventId", "executionSessionId", "id", "kind", "metadata", "nodeAttemptId", "nodeId", "rawEventId", "runId", "severity", "sortTime", "status", "taskId", "title", "toolInvocationId", "workspaceId" FROM "TaskTimelineItem";
DROP TABLE "TaskTimelineItem";
ALTER TABLE "new_TaskTimelineItem" RENAME TO "TaskTimelineItem";
CREATE INDEX "TaskTimelineItem_taskId_workBlockId_sortTime_idx" ON "TaskTimelineItem"("taskId", "workBlockId", "sortTime");
CREATE INDEX "TaskTimelineItem_taskId_nodeId_workBlockId_sortTime_idx" ON "TaskTimelineItem"("taskId", "nodeId", "workBlockId", "sortTime");
CREATE INDEX "TaskTimelineItem_runId_sortTime_idx" ON "TaskTimelineItem"("runId", "sortTime");
CREATE INDEX "TaskTimelineItem_eventId_idx" ON "TaskTimelineItem"("eventId");
CREATE TABLE "new_ToolInvocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT,
    "runId" TEXT,
    "executionSessionId" TEXT,
    "planId" TEXT,
    "planRunId" TEXT,
    "nodeAttemptId" TEXT,
    "providerRunId" TEXT,
    "nodeId" TEXT,
    "toolName" TEXT NOT NULL,
    "toolKind" TEXT,
    "status" TEXT NOT NULL,
    "inputRawEventId" TEXT,
    "outputRawEventId" TEXT,
    "errorRawEventId" TEXT,
    "canonicalEventId" TEXT,
    "inputPayload" JSONB,
    "outputPayload" JSONB,
    "errorPayload" JSONB,
    "inputSummary" TEXT,
    "outputSummary" TEXT,
    "errorSummary" TEXT,
    "nativeToolCallId" TEXT,
    "externalRef" TEXT,
    "correlationId" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ToolInvocation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ToolInvocation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ToolInvocation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ToolInvocation" ("canonicalEventId", "completedAt", "correlationId", "createdAt", "errorPayload", "errorRawEventId", "errorSummary", "executionSessionId", "externalRef", "id", "inputPayload", "inputRawEventId", "inputSummary", "nativeToolCallId", "nodeAttemptId", "nodeId", "outputPayload", "outputRawEventId", "outputSummary", "planId", "planRunId", "providerRunId", "runId", "startedAt", "status", "taskId", "toolKind", "toolName", "updatedAt", "workspaceId") SELECT "canonicalEventId", "completedAt", "correlationId", "createdAt", "errorPayload", "errorRawEventId", "errorSummary", "executionSessionId", "externalRef", "id", "inputPayload", "inputRawEventId", "inputSummary", "nativeToolCallId", "nodeAttemptId", "nodeId", "outputPayload", "outputRawEventId", "outputSummary", "planId", "planRunId", "providerRunId", "runId", "startedAt", "status", "taskId", "toolKind", "toolName", "updatedAt", "workspaceId" FROM "ToolInvocation";
DROP TABLE "ToolInvocation";
ALTER TABLE "new_ToolInvocation" RENAME TO "ToolInvocation";
CREATE INDEX "ToolInvocation_taskId_createdAt_idx" ON "ToolInvocation"("taskId", "createdAt");
CREATE INDEX "ToolInvocation_runId_createdAt_idx" ON "ToolInvocation"("runId", "createdAt");
CREATE INDEX "ToolInvocation_nodeAttemptId_createdAt_idx" ON "ToolInvocation"("nodeAttemptId", "createdAt");
CREATE INDEX "ToolInvocation_toolName_status_idx" ON "ToolInvocation"("toolName", "status");
CREATE INDEX "ToolInvocation_correlationId_idx" ON "ToolInvocation"("correlationId");
CREATE UNIQUE INDEX "ToolInvocation_runId_nativeToolCallId_key" ON "ToolInvocation"("runId", "nativeToolCallId");
CREATE TABLE "new_WorkBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "planId" TEXT,
    "recurrenceKey" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Scheduled',
    "scheduledStartAt" DATETIME NOT NULL,
    "scheduledEndAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "trigger" TEXT NOT NULL DEFAULT 'scheduled',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkBlock_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkBlock_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WorkBlock" ("completedAt", "createdAt", "id", "planId", "recurrenceKey", "scheduledEndAt", "scheduledStartAt", "startedAt", "status", "taskId", "title", "trigger", "updatedAt", "workspaceId") SELECT "completedAt", "createdAt", "id", "planId", "recurrenceKey", "scheduledEndAt", "scheduledStartAt", "startedAt", "status", "taskId", "title", "trigger", "updatedAt", "workspaceId" FROM "WorkBlock";
DROP TABLE "WorkBlock";
ALTER TABLE "new_WorkBlock" RENAME TO "WorkBlock";
CREATE INDEX "WorkBlock_workspaceId_status_idx" ON "WorkBlock"("workspaceId", "status");
CREATE INDEX "WorkBlock_taskId_status_idx" ON "WorkBlock"("taskId", "status");
CREATE INDEX "WorkBlock_workspaceId_scheduledStartAt_idx" ON "WorkBlock"("workspaceId", "scheduledStartAt");
CREATE UNIQUE INDEX "WorkBlock_taskId_recurrenceKey_key" ON "WorkBlock"("taskId", "recurrenceKey");
CREATE TABLE "new_Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultRuntime" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Workspace" ("createdAt", "defaultRuntime", "description", "id", "name", "status", "updatedAt") SELECT "createdAt", "defaultRuntime", "description", "id", "name", "status", "updatedAt" FROM "Workspace";
DROP TABLE "Workspace";
ALTER TABLE "new_Workspace" RENAME TO "Workspace";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
