-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{"notifications":{"dailyCap":5,"quietHours":{"start":"23:00","end":"08:00"},"timezone":"Asia/Shanghai","digestAt":"09:00"}}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Affair" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "goal" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "nextStep" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "agentState" TEXT NOT NULL DEFAULT 'queued',
    "handling" JSONB,
    "cadenceSeconds" INTEGER,
    "notify" TEXT NOT NULL DEFAULT 'digest',
    "connectionId" TEXT,
    "lastCheckAt" DATETIME,
    "nextCheckAt" DATETIME,
    "ref" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "wakeReason" TEXT NOT NULL DEFAULT 'new_request',
    "nextRunAt" DATETIME,
    "leaseUntil" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Affair_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Affair_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "SourceConnection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AffairEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "affairId" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "data" JSONB,
    "idempotencyKey" TEXT,
    CONSTRAINT "AffairEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AffairEntry_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AffairResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "affairId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "limitations" TEXT NOT NULL DEFAULT '',
    "nextSteps" JSONB NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffairResult_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AffairResult_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AffairRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "affairId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "wakeReason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "affairRevision" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "leaseUntil" DATETIME NOT NULL,
    "deadlineAt" DATETIME NOT NULL,
    "toolCalls" JSONB NOT NULL DEFAULT '[]',
    "webCalls" INTEGER NOT NULL DEFAULT 0,
    "observedSources" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "AffairRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AffairRun_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "affairId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "questions" JSONB NOT NULL DEFAULT '[]',
    "action" TEXT,
    "actionPayload" JSONB,
    "affairRevision" INTEGER,
    "topic" TEXT,
    "answer" TEXT,
    "decision" TEXT,
    "approvalScope" TEXT,
    "ref" TEXT,
    "idempotencyKey" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" DATETIME,
    "cooldownUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "Ask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Ask_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "affairId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FollowUp_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FollowUp_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Grant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'user',
    "once" BOOLEAN NOT NULL DEFAULT false,
    "consumedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "revision" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Grant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SourceConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'poll',
    "status" TEXT NOT NULL DEFAULT 'needs_authorization',
    "config" JSONB NOT NULL DEFAULT '{}',
    "cursor" TEXT,
    "readScopes" JSONB NOT NULL DEFAULT '[]',
    "writeScopes" JSONB NOT NULL DEFAULT '[]',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "pollIntervalSeconds" INTEGER,
    "baselineAt" DATETIME,
    "lastSuccessAt" DATETIME,
    "lastFailureAt" DATETIME,
    "lastError" TEXT,
    "nextCheckAt" DATETIME,
    "leaseUntil" DATETIME,
    "leaseToken" TEXT,
    "coverageNote" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SourceConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InboundEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "affairId" TEXT,
    "disposition" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "leaseUntil" DATETIME,
    "leaseToken" TEXT,
    "lastError" TEXT,
    CONSTRAINT "InboundEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InboundEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "SourceConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InboundEvent_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventAssessment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "assessor" TEXT NOT NULL,
    "disposition" TEXT NOT NULL,
    "whatHappened" TEXT NOT NULL,
    "whyItMatters" TEXT NOT NULL,
    "important" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventAssessment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EventAssessment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "InboundEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "affairId" TEXT,
    "askId" TEXT,
    "level" TEXT NOT NULL DEFAULT 'digest',
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "recipient" TEXT,
    "link" TEXT,
    "receiptRef" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" DATETIME,
    "leaseUntil" DATETIME,
    "leaseToken" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    "acknowledgedAt" DATETIME,
    "feedback" TEXT,
    CONSTRAINT "Notification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Notification_askId_fkey" FOREIGN KEY ("askId") REFERENCES "Ask" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "affairId" TEXT,
    "externalId" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatMessage_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Preference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    CONSTRAINT "Preference_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ManagedTool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "affairId" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "rationale" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'draft',
    "approvedVersion" INTEGER,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "lastRunAt" DATETIME,
    "lastRunOk" BOOLEAN,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ManagedTool_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ManagedTool_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PanelEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PanelEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PanelEntry_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "ManagedTool" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ToolVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "script" JSONB,
    "spec" JSONB,
    "contentHash" TEXT NOT NULL,
    "validationSummary" TEXT,
    "approvedAt" DATETIME,
    "approvedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ToolVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ToolVersion_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "ManagedTool" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ToolRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "idempotencyKey" TEXT NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "error" TEXT,
    "leaseUntil" DATETIME,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "ToolRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ToolRun_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "ManagedTool" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ToolRun_toolId_version_fkey" FOREIGN KEY ("toolId", "version") REFERENCES "ToolVersion" ("toolId", "version") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT,
    "actorKey" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Audit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StewardState" (
    "workspaceId" TEXT NOT NULL PRIMARY KEY,
    "lastTickAt" DATETIME,
    "leaseUntil" DATETIME,
    "leaseToken" TEXT,
    "agentName" TEXT NOT NULL DEFAULT 'unconfigured',
    "agentAvailable" BOOLEAN NOT NULL DEFAULT false,
    "agentLastError" TEXT,
    CONSTRAINT "StewardState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Affair_workspaceId_status_lastActivityAt_idx" ON "Affair"("workspaceId", "status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "Affair_workspaceId_agentState_nextRunAt_idx" ON "Affair"("workspaceId", "agentState", "nextRunAt");

-- CreateIndex
CREATE INDEX "Affair_workspaceId_status_nextCheckAt_idx" ON "Affair"("workspaceId", "status", "nextCheckAt");

-- CreateIndex
CREATE INDEX "Affair_workspaceId_agentState_leaseUntil_idx" ON "Affair"("workspaceId", "agentState", "leaseUntil");

-- CreateIndex
CREATE INDEX "Affair_connectionId_idx" ON "Affair"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Affair_workspaceId_ref_key" ON "Affair"("workspaceId", "ref");

-- CreateIndex
CREATE INDEX "AffairEntry_affairId_at_idx" ON "AffairEntry"("affairId", "at");

-- CreateIndex
CREATE INDEX "AffairEntry_workspaceId_kind_at_idx" ON "AffairEntry"("workspaceId", "kind", "at");

-- CreateIndex
CREATE UNIQUE INDEX "AffairEntry_workspaceId_idempotencyKey_key" ON "AffairEntry"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AffairResult_workspaceId_createdAt_idx" ON "AffairResult"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AffairResult_affairId_version_key" ON "AffairResult"("affairId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AffairRun_tokenHash_key" ON "AffairRun"("tokenHash");

-- CreateIndex
CREATE INDEX "AffairRun_workspaceId_status_leaseUntil_idx" ON "AffairRun"("workspaceId", "status", "leaseUntil");

-- CreateIndex
CREATE INDEX "AffairRun_workspaceId_status_deadlineAt_idx" ON "AffairRun"("workspaceId", "status", "deadlineAt");

-- CreateIndex
CREATE INDEX "AffairRun_affairId_startedAt_idx" ON "AffairRun"("affairId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AffairRun_affairId_number_key" ON "AffairRun"("affairId", "number");

-- CreateIndex
CREATE INDEX "Ask_workspaceId_status_createdAt_idx" ON "Ask"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Ask_affairId_status_idx" ON "Ask"("affairId", "status");

-- CreateIndex
CREATE INDEX "Ask_workspaceId_topic_resolvedAt_idx" ON "Ask"("workspaceId", "topic", "resolvedAt");

-- CreateIndex
CREATE INDEX "Ask_workspaceId_status_expiresAt_idx" ON "Ask"("workspaceId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Ask_workspaceId_ref_key" ON "Ask"("workspaceId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "Ask_workspaceId_idempotencyKey_key" ON "Ask"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "FollowUp_workspaceId_status_dueAt_idx" ON "FollowUp"("workspaceId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "FollowUp_affairId_dueAt_idx" ON "FollowUp"("affairId", "dueAt");

-- CreateIndex
CREATE INDEX "Grant_workspaceId_action_revokedAt_expiresAt_idx" ON "Grant"("workspaceId", "action", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "SourceConnection_workspaceId_status_mode_nextCheckAt_idx" ON "SourceConnection"("workspaceId", "status", "mode", "nextCheckAt");

-- CreateIndex
CREATE INDEX "InboundEvent_workspaceId_status_nextAttemptAt_idx" ON "InboundEvent"("workspaceId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "InboundEvent_affairId_occurredAt_idx" ON "InboundEvent"("affairId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "InboundEvent_connectionId_externalId_key" ON "InboundEvent"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "EventAssessment_workspaceId_createdAt_idx" ON "EventAssessment"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "EventAssessment_eventId_createdAt_idx" ON "EventAssessment"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_workspaceId_status_level_nextAttemptAt_idx" ON "Notification"("workspaceId", "status", "level", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Notification_workspaceId_channel_sentAt_idx" ON "Notification"("workspaceId", "channel", "sentAt");

-- CreateIndex
CREATE INDEX "Notification_affairId_createdAt_idx" ON "Notification"("affairId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_askId_idx" ON "Notification"("askId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_workspaceId_idempotencyKey_key" ON "Notification"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ChatMessage_workspaceId_at_idx" ON "ChatMessage"("workspaceId", "at");

-- CreateIndex
CREATE INDEX "ChatMessage_affairId_at_idx" ON "ChatMessage"("affairId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_workspaceId_channel_externalId_key" ON "ChatMessage"("workspaceId", "channel", "externalId");

-- CreateIndex
CREATE INDEX "Preference_workspaceId_createdAt_idx" ON "Preference"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ManagedTool_workspaceId_state_idx" ON "ManagedTool"("workspaceId", "state");

-- CreateIndex
CREATE INDEX "ManagedTool_affairId_idx" ON "ManagedTool"("affairId");

-- CreateIndex
CREATE INDEX "PanelEntry_toolId_createdAt_idx" ON "PanelEntry"("toolId", "createdAt");

-- CreateIndex
CREATE INDEX "ToolVersion_workspaceId_createdAt_idx" ON "ToolVersion"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ToolVersion_toolId_version_key" ON "ToolVersion"("toolId", "version");

-- CreateIndex
CREATE INDEX "ToolRun_workspaceId_status_leaseUntil_idx" ON "ToolRun"("workspaceId", "status", "leaseUntil");

-- CreateIndex
CREATE INDEX "ToolRun_toolId_startedAt_idx" ON "ToolRun"("toolId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ToolRun_workspaceId_idempotencyKey_key" ON "ToolRun"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Audit_workspaceId_createdAt_idx" ON "Audit"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Audit_workspaceId_subjectId_createdAt_idx" ON "Audit"("workspaceId", "subjectId", "createdAt");
