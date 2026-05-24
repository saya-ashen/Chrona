-- Clean baseline generated from prisma/schema.prisma.

CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultRuntime" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "executionRuntime" TEXT NOT NULL,
    "executionConfig" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "autoExecute" BOOLEAN NOT NULL DEFAULT false,
    "parentTaskId" TEXT,
    "dueAt" DATETIME,
    "blockReason" TEXT,
    "defaultSessionId" TEXT,
    "latestRunId" TEXT,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "Task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SchedulerLease" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "heartbeatAt" DATETIME NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "GraphVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "graph" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "GraphVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GraphVersion_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "GraphMutationRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "baseGraphVersion" INTEGER NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "validationResult" TEXT,
    "affectedNodeIds" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "appliedAt" DATETIME,
    CONSTRAINT "GraphMutationRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GraphMutationRecord_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ReconciliationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "graphVersion" INTEGER NOT NULL,
    "executionState" TEXT NOT NULL,
    "currentNodeId" TEXT,
    "issues" TEXT,
    "repairActions" TEXT,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "ReconciliationEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReconciliationEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SchedulerEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "graphVersion" INTEGER,
    "eventType" TEXT NOT NULL,
    "reason" TEXT,
    "payload" TEXT,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "SchedulerEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SchedulerEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,
    "dependencyType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "TaskDependency_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "TaskPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "prompt" TEXT,
    "summary" TEXT,
    "generatedBy" TEXT,
    "compiledPlan" TEXT NOT NULL,
    "editablePlan" TEXT,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskPlan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskPlan_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TaskPlanRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planRun" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskPlanRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanRun_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TaskPlan" ("planId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TaskPlanLayer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "layerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "layer" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskPlanLayer_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanLayer_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanLayer_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TaskPlan" ("planId") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Run_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Run_taskSessionId_fkey" FOREIGN KEY ("taskSessionId") REFERENCES "TaskSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

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
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "Artifact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Artifact_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Memory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Memory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventType" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "runId" TEXT,
    "nodeId" TEXT,
    "nodeTitle" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "runtimeTs" DATETIME,
    "ingestSequence" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "Event_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Event_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Event_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ConversationEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "runtimeTs" DATETIME,
    "sequence" INTEGER NOT NULL,
    "externalRef" TEXT,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "ConversationEntry_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "ToolCallDetail_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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

CREATE TABLE "ScheduleProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "proposedBy" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "dueAt" DATETIME,
    "scheduledStartAt" DATETIME,
    "scheduledEndAt" DATETIME,
    "createdAt" DATETIME NOT NULL,
    "resolvedAt" DATETIME,
    "resolutionNote" TEXT,
    CONSTRAINT "ScheduleProposal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScheduleProposal_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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

CREATE TABLE "AiClient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "AiFeatureBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feature" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "AiFeatureBinding_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "AiClient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TaskAssistantMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "proposal" TEXT,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "appliedAt" DATETIME,
    "sequence" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "TaskAssistantMessage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "WorkBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "planId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scheduledStartAt" DATETIME NOT NULL,
    "scheduledEndAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "trigger" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkBlock_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkBlock_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ExecutionSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workBlockId" TEXT,
    "planId" TEXT,
    "status" TEXT NOT NULL,
    "currentNodeId" TEXT,
    "pauseReason" TEXT,
    "completedNodeIds" TEXT NOT NULL DEFAULT '[]',
    "startedAt" DATETIME NOT NULL,
    "pausedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExecutionSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExecutionSession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExecutionSession_workBlockId_fkey" FOREIGN KEY ("workBlockId") REFERENCES "WorkBlock" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Task_workspaceId_status_idx" ON "Task"("workspaceId", "status");
CREATE INDEX "Task_workspaceId_priority_idx" ON "Task"("workspaceId", "priority");
CREATE INDEX "Task_defaultSessionId_idx" ON "Task"("defaultSessionId");
CREATE INDEX "SchedulerLease_ownerId_idx" ON "SchedulerLease"("ownerId");
CREATE INDEX "SchedulerLease_expiresAt_idx" ON "SchedulerLease"("expiresAt");
CREATE UNIQUE INDEX "GraphVersion_taskId_version_key" ON "GraphVersion"("taskId", "version");
CREATE INDEX "GraphVersion_workspaceId_taskId_version_idx" ON "GraphVersion"("workspaceId", "taskId", "version");
CREATE INDEX "GraphMutationRecord_workspaceId_status_createdAt_idx" ON "GraphMutationRecord"("workspaceId", "status", "createdAt");
CREATE INDEX "GraphMutationRecord_taskId_baseGraphVersion_status_idx" ON "GraphMutationRecord"("taskId", "baseGraphVersion", "status");
CREATE INDEX "ReconciliationEvent_workspaceId_createdAt_idx" ON "ReconciliationEvent"("workspaceId", "createdAt");
CREATE INDEX "ReconciliationEvent_taskId_graphVersion_createdAt_idx" ON "ReconciliationEvent"("taskId", "graphVersion", "createdAt");
CREATE INDEX "SchedulerEvent_workspaceId_eventType_createdAt_idx" ON "SchedulerEvent"("workspaceId", "eventType", "createdAt");
CREATE INDEX "SchedulerEvent_taskId_createdAt_idx" ON "SchedulerEvent"("taskId", "createdAt");
CREATE UNIQUE INDEX "TaskSession_sessionKey_key" ON "TaskSession"("sessionKey");
CREATE INDEX "TaskSession_taskId_createdAt_idx" ON "TaskSession"("taskId", "createdAt");
CREATE INDEX "TaskSession_taskId_status_idx" ON "TaskSession"("taskId", "status");
CREATE UNIQUE INDEX "TaskDependency_taskId_dependsOnTaskId_key" ON "TaskDependency"("taskId", "dependsOnTaskId");
CREATE INDEX "TaskDependency_workspaceId_taskId_idx" ON "TaskDependency"("workspaceId", "taskId");
CREATE INDEX "TaskDependency_workspaceId_dependsOnTaskId_idx" ON "TaskDependency"("workspaceId", "dependsOnTaskId");
CREATE UNIQUE INDEX "TaskPlan_planId_key" ON "TaskPlan"("planId");
CREATE INDEX "TaskPlan_workspaceId_taskId_updatedAt_idx" ON "TaskPlan"("workspaceId", "taskId", "updatedAt");
CREATE INDEX "TaskPlan_taskId_status_updatedAt_idx" ON "TaskPlan"("taskId", "status", "updatedAt");
CREATE UNIQUE INDEX "TaskPlanRun_taskId_planId_key" ON "TaskPlanRun"("taskId", "planId");
CREATE INDEX "TaskPlanRun_workspaceId_taskId_updatedAt_idx" ON "TaskPlanRun"("workspaceId", "taskId", "updatedAt");
CREATE UNIQUE INDEX "TaskPlanLayer_layerId_key" ON "TaskPlanLayer"("layerId");
CREATE INDEX "TaskPlanLayer_taskId_planId_version_idx" ON "TaskPlanLayer"("taskId", "planId", "version");
CREATE INDEX "TaskPlanLayer_workspaceId_taskId_createdAt_idx" ON "TaskPlanLayer"("workspaceId", "taskId", "createdAt");
CREATE UNIQUE INDEX "Run_runtimeRunRef_key" ON "Run"("runtimeRunRef");
CREATE INDEX "Run_taskId_status_idx" ON "Run"("taskId", "status");
CREATE INDEX "Run_taskSessionId_status_idx" ON "Run"("taskSessionId", "status");
CREATE INDEX "Run_runtimeName_status_idx" ON "Run"("runtimeName", "status");
CREATE INDEX "Approval_workspaceId_status_idx" ON "Approval"("workspaceId", "status");
CREATE INDEX "Approval_taskId_status_idx" ON "Approval"("taskId", "status");
CREATE INDEX "Approval_runId_status_idx" ON "Approval"("runId", "status");
CREATE INDEX "Artifact_workspaceId_type_idx" ON "Artifact"("workspaceId", "type");
CREATE INDEX "Artifact_taskId_createdAt_idx" ON "Artifact"("taskId", "createdAt");
CREATE INDEX "Artifact_runId_createdAt_idx" ON "Artifact"("runId", "createdAt");
CREATE INDEX "Memory_workspaceId_scope_status_idx" ON "Memory"("workspaceId", "scope", "status");
CREATE INDEX "Memory_taskId_idx" ON "Memory"("taskId");
CREATE UNIQUE INDEX "Event_dedupeKey_key" ON "Event"("dedupeKey");
CREATE INDEX "Event_taskId_ingestSequence_idx" ON "Event"("taskId", "ingestSequence");
CREATE INDEX "Event_taskId_nodeId_ingestSequence_idx" ON "Event"("taskId", "nodeId", "ingestSequence");
CREATE INDEX "Event_runId_ingestSequence_idx" ON "Event"("runId", "ingestSequence");
CREATE INDEX "Event_workspaceId_eventType_ingestSequence_idx" ON "Event"("workspaceId", "eventType", "ingestSequence");
CREATE UNIQUE INDEX "ConversationEntry_externalRef_key" ON "ConversationEntry"("externalRef");
CREATE INDEX "ConversationEntry_runId_sequence_idx" ON "ConversationEntry"("runId", "sequence");
CREATE UNIQUE INDEX "ToolCallDetail_externalRef_key" ON "ToolCallDetail"("externalRef");
CREATE INDEX "ToolCallDetail_runId_createdAt_idx" ON "ToolCallDetail"("runId", "createdAt");
CREATE INDEX "TaskProjection_workspaceId_persistedStatus_idx" ON "TaskProjection"("workspaceId", "persistedStatus");
CREATE INDEX "TaskProjection_workspaceId_displayState_idx" ON "TaskProjection"("workspaceId", "displayState");
CREATE INDEX "ScheduleProposal_workspaceId_status_idx" ON "ScheduleProposal"("workspaceId", "status");
CREATE INDEX "ScheduleProposal_taskId_status_idx" ON "ScheduleProposal"("taskId", "status");
CREATE UNIQUE INDEX "AiFeatureBinding_feature_key" ON "AiFeatureBinding"("feature");
CREATE INDEX "TaskAssistantMessage_taskId_sequence_idx" ON "TaskAssistantMessage"("taskId", "sequence");
CREATE INDEX "WorkBlock_workspaceId_status_idx" ON "WorkBlock"("workspaceId", "status");
CREATE INDEX "WorkBlock_taskId_status_idx" ON "WorkBlock"("taskId", "status");
CREATE INDEX "WorkBlock_workspaceId_scheduledStartAt_idx" ON "WorkBlock"("workspaceId", "scheduledStartAt");
CREATE INDEX "ExecutionSession_workspaceId_status_idx" ON "ExecutionSession"("workspaceId", "status");
CREATE INDEX "ExecutionSession_taskId_status_idx" ON "ExecutionSession"("taskId", "status");
CREATE INDEX "ExecutionSession_workBlockId_idx" ON "ExecutionSession"("workBlockId");
