-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultRuntime" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "runtimeAdapterKey" TEXT,
    "runtimeInput" TEXT,
    "runtimeInputVersion" TEXT,
    "runtimeModel" TEXT,
    "prompt" TEXT,
    "runtimeConfig" TEXT,
    "status" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "assigneeAgentId" TEXT,
    "sourceSessionId" TEXT,
    "parentTaskId" TEXT,
    "dueAt" DATETIME,
    "scheduledStartAt" DATETIME,
    "scheduledEndAt" DATETIME,
    "scheduleStatus" TEXT NOT NULL DEFAULT 'Unscheduled',
    "scheduleSource" TEXT,
    "budgetLimit" INTEGER,
    "blockReason" TEXT,
    "defaultSessionId" TEXT,
    "latestRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "Task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Task_workspaceId_status_idx" ON "Task"("workspaceId", "status");
CREATE INDEX "Task_workspaceId_priority_idx" ON "Task"("workspaceId", "priority");
CREATE INDEX "Task_workspaceId_scheduleStatus_idx" ON "Task"("workspaceId", "scheduleStatus");
CREATE INDEX "Task_defaultSessionId_idx" ON "Task"("defaultSessionId");

-- CreateTable
CREATE TABLE "TaskSession" (
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

-- CreateIndex
CREATE UNIQUE INDEX "TaskSession_sessionKey_key" ON "TaskSession"("sessionKey");
CREATE INDEX "TaskSession_taskId_createdAt_idx" ON "TaskSession"("taskId", "createdAt");
CREATE INDEX "TaskSession_taskId_status_idx" ON "TaskSession"("taskId", "status");

-- CreateTable
CREATE TABLE "TaskDependency" (
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

-- CreateIndex
CREATE UNIQUE INDEX "TaskDependency_taskId_dependsOnTaskId_key" ON "TaskDependency"("taskId", "dependsOnTaskId");
CREATE INDEX "TaskDependency_workspaceId_taskId_idx" ON "TaskDependency"("workspaceId", "taskId");
CREATE INDEX "TaskDependency_workspaceId_dependsOnTaskId_idx" ON "TaskDependency"("workspaceId", "dependsOnTaskId");

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "taskSessionId" TEXT,
    "runtimeName" TEXT NOT NULL,
    "runtimeConfigSnapshot" TEXT,
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

-- CreateIndex
CREATE UNIQUE INDEX "Run_runtimeRunRef_key" ON "Run"("runtimeRunRef");
CREATE INDEX "Run_taskId_status_idx" ON "Run"("taskId", "status");
CREATE INDEX "Run_taskSessionId_status_idx" ON "Run"("taskSessionId", "status");
CREATE INDEX "Run_runtimeName_status_idx" ON "Run"("runtimeName", "status");

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "payload" TEXT,
    "status" TEXT NOT NULL,
    "requestedAt" DATETIME NOT NULL,
    "resolvedAt" DATETIME,
    "resolvedBy" TEXT,
    "resolutionNote" TEXT,
    CONSTRAINT "Approval_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Approval_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Approval_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Approval_workspaceId_status_idx" ON "Approval"("workspaceId", "status");
CREATE INDEX "Approval_taskId_status_idx" ON "Approval"("taskId", "status");
CREATE INDEX "Approval_runId_status_idx" ON "Approval"("runId", "status");

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "contentPreview" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Artifact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Artifact_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Artifact_workspaceId_type_idx" ON "Artifact"("workspaceId", "type");
CREATE INDEX "Artifact_taskId_createdAt_idx" ON "Artifact"("taskId", "createdAt");
CREATE INDEX "Artifact_runId_createdAt_idx" ON "Artifact"("runId", "createdAt");

-- CreateTable
CREATE TABLE "Memory" (
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

-- CreateIndex
CREATE INDEX "Memory_workspaceId_scope_status_idx" ON "Memory"("workspaceId", "scope", "status");
CREATE INDEX "Memory_taskId_idx" ON "Memory"("taskId");

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventType" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "runId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "runtimeTs" DATETIME,
    "ingestSequence" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Event_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Event_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Event_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Event_dedupeKey_key" ON "Event"("dedupeKey");
CREATE INDEX "Event_taskId_ingestSequence_idx" ON "Event"("taskId", "ingestSequence");
CREATE INDEX "Event_runId_ingestSequence_idx" ON "Event"("runId", "ingestSequence");
CREATE INDEX "Event_workspaceId_eventType_ingestSequence_idx" ON "Event"("workspaceId", "eventType", "ingestSequence");

-- CreateTable
CREATE TABLE "ConversationEntry" (
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

-- CreateIndex
CREATE UNIQUE INDEX "ConversationEntry_externalRef_key" ON "ConversationEntry"("externalRef");
CREATE INDEX "ConversationEntry_runId_sequence_idx" ON "ConversationEntry"("runId", "sequence");

-- CreateTable
CREATE TABLE "ToolCallDetail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "argumentsSummary" TEXT,
    "resultSummary" TEXT,
    "errorSummary" TEXT,
    "runtimeTs" DATETIME,
    "externalRef" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ToolCallDetail_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ToolCallDetail_externalRef_key" ON "ToolCallDetail"("externalRef");
CREATE INDEX "ToolCallDetail_runId_createdAt_idx" ON "ToolCallDetail"("runId", "createdAt");

-- CreateTable
CREATE TABLE "TaskProjection" (
    "taskId" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "persistedStatus" TEXT NOT NULL,
    "displayState" TEXT,
    "blockType" TEXT,
    "blockScope" TEXT,
    "blockSince" DATETIME,
    "actionRequired" TEXT,
    "latestRunStatus" TEXT,
    "approvalPendingCount" INTEGER NOT NULL DEFAULT 0,
    "dueAt" DATETIME,
    "scheduledStartAt" DATETIME,
    "scheduledEndAt" DATETIME,
    "scheduleStatus" TEXT,
    "scheduleSource" TEXT,
    "scheduleProposalCount" INTEGER NOT NULL DEFAULT 0,
    "latestArtifactTitle" TEXT,
    "lastActivityAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskProjection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskProjection_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TaskProjection_workspaceId_persistedStatus_idx" ON "TaskProjection"("workspaceId", "persistedStatus");
CREATE INDEX "TaskProjection_workspaceId_displayState_idx" ON "TaskProjection"("workspaceId", "displayState");

-- CreateTable
CREATE TABLE "ScheduleProposal" (
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
    "assigneeAgentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "resolutionNote" TEXT,
    CONSTRAINT "ScheduleProposal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScheduleProposal_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ScheduleProposal_workspaceId_status_idx" ON "ScheduleProposal"("workspaceId", "status");
CREATE INDEX "ScheduleProposal_taskId_status_idx" ON "ScheduleProposal"("taskId", "status");

-- CreateTable
CREATE TABLE "RuntimeCursor" (
    "runId" TEXT NOT NULL PRIMARY KEY,
    "runtimeName" TEXT NOT NULL,
    "nextCursor" TEXT,
    "lastEventRef" TEXT,
    "lastSyncedAt" DATETIME,
    "healthStatus" TEXT NOT NULL DEFAULT 'healthy',
    "lastError" TEXT,
    CONSTRAINT "RuntimeCursor_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiClient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" TEXT NOT NULL DEFAULT '{}',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AiFeatureBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feature" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiFeatureBinding_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "AiClient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AiFeatureBinding_feature_key" ON "AiFeatureBinding"("feature");

-- CreateTable
CREATE TABLE "TaskAssistantMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "proposal" TEXT,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "appliedAt" DATETIME,
    "sequence" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskAssistantMessage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TaskAssistantMessage_taskId_sequence_idx" ON "TaskAssistantMessage"("taskId", "sequence");
