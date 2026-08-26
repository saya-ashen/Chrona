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
CREATE TABLE "CalendarSource" (
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

-- CreateTable
CREATE TABLE "ImportedCalendarEvent" (
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

-- CreateTable
CREATE TABLE "Task" (
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
    "aiClientId" TEXT,
    "latestRunId" TEXT,
    "latestEventId" TEXT,
    "latestRawEventId" TEXT,
    "blockedByEventId" TEXT,
    "blockedByRawEventId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "Task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_aiClientId_fkey" FOREIGN KEY ("aiClientId") REFERENCES "AiClient" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SchedulerLease" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "heartbeatAt" DATETIME NOT NULL,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GraphVersion" (
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

-- CreateTable
CREATE TABLE "GraphMutationRecord" (
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

-- CreateTable
CREATE TABLE "ReconciliationEvent" (
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

-- CreateTable
CREATE TABLE "SchedulerEvent" (
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
    "providerSessionRef" TEXT,
    "createdByFramework" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskSession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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

-- CreateTable
CREATE TABLE "TaskPlan" (
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

-- CreateTable
CREATE TABLE "TaskPlanRun" (
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

-- CreateTable
CREATE TABLE "TaskPlanNodeAttempt" (
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

-- CreateTable
CREATE TABLE "TaskPlanProviderRun" (
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

-- CreateTable
CREATE TABLE "TaskPlanProviderApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workBlockId" TEXT,
    "planId" TEXT NOT NULL,
    "planRunId" TEXT NOT NULL,
    "nodeAttemptId" TEXT,
    "providerRunId" TEXT NOT NULL,
    "nodeId" TEXT,
    "nodeTitle" TEXT,
    "provider" TEXT NOT NULL,
    "runtimeName" TEXT,
    "nativeRunId" TEXT,
    "approvalRef" TEXT,
    "kind" TEXT NOT NULL,
    "providerKind" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT,
    "riskLevel" TEXT NOT NULL,
    "subject" JSONB,
    "choices" JSONB NOT NULL,
    "scopePolicy" JSONB,
    "rawPayload" JSONB,
    "status" TEXT NOT NULL,
    "requestedAt" DATETIME NOT NULL,
    "resolvedAt" DATETIME,
    "resolvedBy" TEXT,
    "choice" TEXT,
    "resolveAll" BOOLEAN NOT NULL DEFAULT false,
    "resolutionRaw" JSONB,
    "error" JSONB,
    "rawEventId" TEXT,
    "responseEventId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskPlanProviderApproval_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanProviderApproval_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanProviderApproval_planRunId_fkey" FOREIGN KEY ("planRunId") REFERENCES "TaskPlanRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanProviderApproval_nodeAttemptId_fkey" FOREIGN KEY ("nodeAttemptId") REFERENCES "TaskPlanNodeAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanProviderApproval_providerRunId_fkey" FOREIGN KEY ("providerRunId") REFERENCES "TaskPlanProviderRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskPlanLayer" (
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

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "workBlockId" TEXT,
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
    CONSTRAINT "Run_workBlockId_fkey" FOREIGN KEY ("workBlockId") REFERENCES "WorkBlock" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Run_taskSessionId_fkey" FOREIGN KEY ("taskSessionId") REFERENCES "TaskSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

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
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Artifact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Artifact_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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

-- CreateTable
CREATE TABLE "Event" (
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

-- CreateTable
CREATE TABLE "RawEventLog" (
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

-- CreateTable
CREATE TABLE "ToolInvocation" (
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

-- CreateTable
CREATE TABLE "TaskTimelineItem" (
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
    "blockDetail" TEXT,
    "blockNodeId" TEXT,
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
    "latestEventId" TEXT,
    "latestRawEventId" TEXT,
    "blockedByEventId" TEXT,
    "blockedByRawEventId" TEXT,
    "currentNodeId" TEXT,
    "currentNodeTitle" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskProjection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskProjection_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "resolutionNote" TEXT,
    CONSTRAINT "ScheduleProposal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScheduleProposal_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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
CREATE TABLE "WorkspaceUserPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'local',
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkspaceUserPreference_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkspaceAiSurface" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'dirty',
    "inputFingerprint" TEXT,
    "generatedSpec" JSONB,
    "summaryText" TEXT,
    "providerClientId" TEXT,
    "dirtyAt" DATETIME,
    "generatedAt" DATETIME,
    "lastAttemptAt" DATETIME,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkspaceAiSurface_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiClient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
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

-- CreateTable
CREATE TABLE "TaskAssistantMessage" (
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

-- CreateTable
CREATE TABLE "WorkBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "sessionId" TEXT,
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
    CONSTRAINT "WorkBlock_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkBlock_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TaskSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionSession" (
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

-- CreateTable
CREATE TABLE "RunToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "taskSessionId" TEXT,
    "runId" TEXT NOT NULL,
    "runtimeSessionKey" TEXT NOT NULL,
    "nodeId" TEXT,
    "nodeAttemptId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspaceId" TEXT NOT NULL,
    CONSTRAINT "RunToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RunToken_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RunToken_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskPlanTerminalAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "taskSessionId" TEXT,
    "runtimeSessionKey" TEXT NOT NULL,
    "nodeId" TEXT,
    "nodeAttemptId" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskPlanTerminalAction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanTerminalAction_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanTerminalAction_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskPlanTerminalAction_nodeAttemptId_fkey" FOREIGN KEY ("nodeAttemptId") REFERENCES "TaskPlanNodeAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CalendarSource_workspaceId_lifecycleState_idx" ON "CalendarSource"("workspaceId", "lifecycleState");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarSource_workspaceId_sourceUrl_key" ON "CalendarSource"("workspaceId", "sourceUrl");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedCalendarEvent_workBlockId_key" ON "ImportedCalendarEvent"("workBlockId");

-- CreateIndex
CREATE INDEX "ImportedCalendarEvent_taskId_idx" ON "ImportedCalendarEvent"("taskId");

-- CreateIndex
CREATE INDEX "ImportedCalendarEvent_workspaceId_startsAt_endsAt_idx" ON "ImportedCalendarEvent"("workspaceId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "ImportedCalendarEvent_calendarSourceId_startsAt_idx" ON "ImportedCalendarEvent"("calendarSourceId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedCalendarEvent_calendarSourceId_dedupeKey_key" ON "ImportedCalendarEvent"("calendarSourceId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Task_workspaceId_status_idx" ON "Task"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Task_workspaceId_priority_idx" ON "Task"("workspaceId", "priority");

-- CreateIndex
CREATE INDEX "Task_workspaceId_seriesExternalUid_idx" ON "Task"("workspaceId", "seriesExternalUid");

-- CreateIndex
CREATE INDEX "Task_defaultSessionId_idx" ON "Task"("defaultSessionId");

-- CreateIndex
CREATE INDEX "Task_aiClientId_idx" ON "Task"("aiClientId");

-- CreateIndex
CREATE INDEX "SchedulerLease_ownerId_idx" ON "SchedulerLease"("ownerId");

-- CreateIndex
CREATE INDEX "SchedulerLease_expiresAt_idx" ON "SchedulerLease"("expiresAt");

-- CreateIndex
CREATE INDEX "GraphVersion_workspaceId_taskId_version_idx" ON "GraphVersion"("workspaceId", "taskId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "GraphVersion_taskId_version_key" ON "GraphVersion"("taskId", "version");

-- CreateIndex
CREATE INDEX "GraphMutationRecord_workspaceId_status_createdAt_idx" ON "GraphMutationRecord"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "GraphMutationRecord_taskId_baseGraphVersion_status_idx" ON "GraphMutationRecord"("taskId", "baseGraphVersion", "status");

-- CreateIndex
CREATE INDEX "ReconciliationEvent_workspaceId_createdAt_idx" ON "ReconciliationEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ReconciliationEvent_taskId_graphVersion_createdAt_idx" ON "ReconciliationEvent"("taskId", "graphVersion", "createdAt");

-- CreateIndex
CREATE INDEX "SchedulerEvent_workspaceId_eventType_createdAt_idx" ON "SchedulerEvent"("workspaceId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "SchedulerEvent_taskId_createdAt_idx" ON "SchedulerEvent"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskSession_sessionKey_key" ON "TaskSession"("sessionKey");

-- CreateIndex
CREATE INDEX "TaskSession_taskId_createdAt_idx" ON "TaskSession"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskSession_taskId_status_idx" ON "TaskSession"("taskId", "status");

-- CreateIndex
CREATE INDEX "TaskDependency_workspaceId_taskId_idx" ON "TaskDependency"("workspaceId", "taskId");

-- CreateIndex
CREATE INDEX "TaskDependency_workspaceId_dependsOnTaskId_idx" ON "TaskDependency"("workspaceId", "dependsOnTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDependency_taskId_dependsOnTaskId_key" ON "TaskDependency"("taskId", "dependsOnTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskPlan_planId_key" ON "TaskPlan"("planId");

-- CreateIndex
CREATE INDEX "TaskPlan_workspaceId_taskId_updatedAt_idx" ON "TaskPlan"("workspaceId", "taskId", "updatedAt");

-- CreateIndex
CREATE INDEX "TaskPlan_taskId_workBlockId_status_updatedAt_idx" ON "TaskPlan"("taskId", "workBlockId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "TaskPlan_workBlockId_status_updatedAt_idx" ON "TaskPlan"("workBlockId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "TaskPlanRun_taskId_planId_executionOwnerId_idx" ON "TaskPlanRun"("taskId", "planId", "executionOwnerId");

-- CreateIndex
CREATE INDEX "TaskPlanRun_taskId_workBlockId_planId_idx" ON "TaskPlanRun"("taskId", "workBlockId", "planId");

-- CreateIndex
CREATE INDEX "TaskPlanRun_executionLeaseUntil_idx" ON "TaskPlanRun"("executionLeaseUntil");

-- CreateIndex
CREATE INDEX "TaskPlanRun_workspaceId_taskId_updatedAt_idx" ON "TaskPlanRun"("workspaceId", "taskId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskPlanRun_taskId_planId_workBlockId_key" ON "TaskPlanRun"("taskId", "planId", "workBlockId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskPlanNodeAttempt_idempotencyKey_key" ON "TaskPlanNodeAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TaskPlanNodeAttempt_taskId_planId_nodeId_status_idx" ON "TaskPlanNodeAttempt"("taskId", "planId", "nodeId", "status");

-- CreateIndex
CREATE INDEX "TaskPlanNodeAttempt_planRunId_nodeId_attemptNumber_idx" ON "TaskPlanNodeAttempt"("planRunId", "nodeId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TaskPlanProviderRun_idempotencyKey_key" ON "TaskPlanProviderRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TaskPlanProviderRun_taskId_planId_status_idx" ON "TaskPlanProviderRun"("taskId", "planId", "status");

-- CreateIndex
CREATE INDEX "TaskPlanProviderRun_nodeAttemptId_status_idx" ON "TaskPlanProviderRun"("nodeAttemptId", "status");

-- CreateIndex
CREATE INDEX "TaskPlanProviderApproval_taskId_status_requestedAt_idx" ON "TaskPlanProviderApproval"("taskId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "TaskPlanProviderApproval_providerRunId_status_idx" ON "TaskPlanProviderApproval"("providerRunId", "status");

-- CreateIndex
CREATE INDEX "TaskPlanProviderApproval_workspaceId_status_requestedAt_idx" ON "TaskPlanProviderApproval"("workspaceId", "status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskPlanProviderApproval_providerRunId_approvalRef_key" ON "TaskPlanProviderApproval"("providerRunId", "approvalRef");

-- CreateIndex
CREATE UNIQUE INDEX "TaskPlanLayer_layerId_key" ON "TaskPlanLayer"("layerId");

-- CreateIndex
CREATE INDEX "TaskPlanLayer_taskId_planId_version_idx" ON "TaskPlanLayer"("taskId", "planId", "version");

-- CreateIndex
CREATE INDEX "TaskPlanLayer_workspaceId_taskId_createdAt_idx" ON "TaskPlanLayer"("workspaceId", "taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Run_runtimeRunRef_key" ON "Run"("runtimeRunRef");

-- CreateIndex
CREATE INDEX "Run_taskId_status_idx" ON "Run"("taskId", "status");

-- CreateIndex
CREATE INDEX "Run_taskId_workBlockId_status_idx" ON "Run"("taskId", "workBlockId", "status");

-- CreateIndex
CREATE INDEX "Run_taskSessionId_status_idx" ON "Run"("taskSessionId", "status");

-- CreateIndex
CREATE INDEX "Run_runtimeName_status_idx" ON "Run"("runtimeName", "status");

-- CreateIndex
CREATE INDEX "Approval_workspaceId_status_idx" ON "Approval"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Approval_taskId_status_idx" ON "Approval"("taskId", "status");

-- CreateIndex
CREATE INDEX "Approval_runId_status_idx" ON "Approval"("runId", "status");

-- CreateIndex
CREATE INDEX "Artifact_workspaceId_type_idx" ON "Artifact"("workspaceId", "type");

-- CreateIndex
CREATE INDEX "Artifact_taskId_createdAt_idx" ON "Artifact"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "Artifact_runId_createdAt_idx" ON "Artifact"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "Memory_workspaceId_scope_status_idx" ON "Memory"("workspaceId", "scope", "status");

-- CreateIndex
CREATE INDEX "Memory_taskId_idx" ON "Memory"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_dedupeKey_key" ON "Event"("dedupeKey");

-- CreateIndex
CREATE INDEX "Event_taskId_workBlockId_ingestSequence_idx" ON "Event"("taskId", "workBlockId", "ingestSequence");

-- CreateIndex
CREATE INDEX "Event_taskId_nodeId_workBlockId_ingestSequence_idx" ON "Event"("taskId", "nodeId", "workBlockId", "ingestSequence");

-- CreateIndex
CREATE INDEX "Event_runId_ingestSequence_idx" ON "Event"("runId", "ingestSequence");

-- CreateIndex
CREATE INDEX "Event_nodeAttemptId_ingestSequence_idx" ON "Event"("nodeAttemptId", "ingestSequence");

-- CreateIndex
CREATE INDEX "Event_correlationId_ingestSequence_idx" ON "Event"("correlationId", "ingestSequence");

-- CreateIndex
CREATE INDEX "Event_workspaceId_eventType_ingestSequence_idx" ON "Event"("workspaceId", "eventType", "ingestSequence");

-- CreateIndex
CREATE INDEX "RawEventLog_taskId_receivedAt_idx" ON "RawEventLog"("taskId", "receivedAt");

-- CreateIndex
CREATE INDEX "RawEventLog_runId_sequence_idx" ON "RawEventLog"("runId", "sequence");

-- CreateIndex
CREATE INDEX "RawEventLog_nodeAttemptId_receivedAt_idx" ON "RawEventLog"("nodeAttemptId", "receivedAt");

-- CreateIndex
CREATE INDEX "RawEventLog_correlationId_receivedAt_idx" ON "RawEventLog"("correlationId", "receivedAt");

-- CreateIndex
CREATE INDEX "RawEventLog_nativeToolCallId_idx" ON "RawEventLog"("nativeToolCallId");

-- CreateIndex
CREATE INDEX "RawEventLog_workspaceId_source_receivedAt_idx" ON "RawEventLog"("workspaceId", "source", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RawEventLog_source_externalRef_key" ON "RawEventLog"("source", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationEntry_externalRef_key" ON "ConversationEntry"("externalRef");

-- CreateIndex
CREATE INDEX "ConversationEntry_runId_sequence_idx" ON "ConversationEntry"("runId", "sequence");

-- CreateIndex
CREATE INDEX "ToolInvocation_taskId_createdAt_idx" ON "ToolInvocation"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "ToolInvocation_runId_createdAt_idx" ON "ToolInvocation"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "ToolInvocation_nodeAttemptId_createdAt_idx" ON "ToolInvocation"("nodeAttemptId", "createdAt");

-- CreateIndex
CREATE INDEX "ToolInvocation_toolName_status_idx" ON "ToolInvocation"("toolName", "status");

-- CreateIndex
CREATE INDEX "ToolInvocation_correlationId_idx" ON "ToolInvocation"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "ToolInvocation_runId_nativeToolCallId_key" ON "ToolInvocation"("runId", "nativeToolCallId");

-- CreateIndex
CREATE INDEX "TaskTimelineItem_taskId_workBlockId_sortTime_idx" ON "TaskTimelineItem"("taskId", "workBlockId", "sortTime");

-- CreateIndex
CREATE INDEX "TaskTimelineItem_taskId_nodeId_workBlockId_sortTime_idx" ON "TaskTimelineItem"("taskId", "nodeId", "workBlockId", "sortTime");

-- CreateIndex
CREATE INDEX "TaskTimelineItem_runId_sortTime_idx" ON "TaskTimelineItem"("runId", "sortTime");

-- CreateIndex
CREATE INDEX "TaskTimelineItem_eventId_idx" ON "TaskTimelineItem"("eventId");

-- CreateIndex
CREATE INDEX "TaskProjection_workspaceId_persistedStatus_idx" ON "TaskProjection"("workspaceId", "persistedStatus");

-- CreateIndex
CREATE INDEX "TaskProjection_workspaceId_displayState_idx" ON "TaskProjection"("workspaceId", "displayState");

-- CreateIndex
CREATE INDEX "ScheduleProposal_workspaceId_status_idx" ON "ScheduleProposal"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ScheduleProposal_taskId_status_idx" ON "ScheduleProposal"("taskId", "status");

-- CreateIndex
CREATE INDEX "WorkspaceUserPreference_userId_key_idx" ON "WorkspaceUserPreference"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceUserPreference_workspaceId_userId_key_key" ON "WorkspaceUserPreference"("workspaceId", "userId", "key");

-- CreateIndex
CREATE INDEX "WorkspaceAiSurface_surface_status_idx" ON "WorkspaceAiSurface"("surface", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceAiSurface_workspaceId_surface_key" ON "WorkspaceAiSurface"("workspaceId", "surface");

-- CreateIndex
CREATE UNIQUE INDEX "AiFeatureBinding_feature_key" ON "AiFeatureBinding"("feature");

-- CreateIndex
CREATE INDEX "TaskAssistantMessage_taskId_sequence_idx" ON "TaskAssistantMessage"("taskId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "WorkBlock_sessionId_key" ON "WorkBlock"("sessionId");

-- CreateIndex
CREATE INDEX "WorkBlock_workspaceId_status_idx" ON "WorkBlock"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "WorkBlock_taskId_status_idx" ON "WorkBlock"("taskId", "status");

-- CreateIndex
CREATE INDEX "WorkBlock_sessionId_idx" ON "WorkBlock"("sessionId");

-- CreateIndex
CREATE INDEX "WorkBlock_workspaceId_scheduledStartAt_idx" ON "WorkBlock"("workspaceId", "scheduledStartAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkBlock_taskId_recurrenceKey_key" ON "WorkBlock"("taskId", "recurrenceKey");

-- CreateIndex
CREATE INDEX "ExecutionSession_workspaceId_status_idx" ON "ExecutionSession"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ExecutionSession_taskId_status_idx" ON "ExecutionSession"("taskId", "status");

-- CreateIndex
CREATE INDEX "ExecutionSession_workBlockId_idx" ON "ExecutionSession"("workBlockId");

-- CreateIndex
CREATE UNIQUE INDEX "RunToken_tokenHash_key" ON "RunToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RunToken_taskId_nodeAttemptId_idx" ON "RunToken"("taskId", "nodeAttemptId");

-- CreateIndex
CREATE INDEX "RunToken_runId_idx" ON "RunToken"("runId");

-- CreateIndex
CREATE INDEX "RunToken_expiresAt_idx" ON "RunToken"("expiresAt");

-- CreateIndex
CREATE INDEX "TaskPlanTerminalAction_runId_recordedAt_idx" ON "TaskPlanTerminalAction"("runId", "recordedAt");

-- CreateIndex
CREATE INDEX "TaskPlanTerminalAction_nodeAttemptId_recordedAt_idx" ON "TaskPlanTerminalAction"("nodeAttemptId", "recordedAt");

-- CreateIndex
CREATE INDEX "TaskPlanTerminalAction_taskId_kind_idx" ON "TaskPlanTerminalAction"("taskId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "TaskPlanTerminalAction_nodeAttemptId_kind_key" ON "TaskPlanTerminalAction"("nodeAttemptId", "kind");
