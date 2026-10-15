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
    "status" TEXT NOT NULL DEFAULT 'active',
    "dirName" TEXT NOT NULL,
    "sessionId" TEXT,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Affair_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "affairId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "rule" JSONB NOT NULL,
    "text" TEXT NOT NULL,
    "command" TEXT,
    "until" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "nextAt" DATETIME,
    "lastAt" DATETIME,
    "lastResult" TEXT,
    "lastOutputHash" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Schedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Schedule_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "affairId" TEXT,
    "lane" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "provider" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "leaseUntil" DATETIME,
    "deadlineAt" DATETIME,
    "conversationKey" TEXT,
    "prompt" TEXT NOT NULL,
    "summary" TEXT,
    "cwd" TEXT NOT NULL,
    "toolCalls" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Run_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Run_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "affairId" TEXT,
    "quotedMessageId" TEXT,
    "externalId" TEXT,
    "conversationKey" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Message_quotedMessageId_fkey" FOREIGN KEY ("quotedMessageId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "affairId" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "data" JSONB,
    CONSTRAINT "Activity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Activity_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "affairId" TEXT,
    "action" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "preview" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'once',
    "grantId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "Approval_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Approval_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Approval_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Grant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "once" BOOLEAN NOT NULL DEFAULT false,
    "consumedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "Grant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "affairId" TEXT,
    "approvalId" TEXT,
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
    CONSTRAINT "Notification_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "Approval" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Connector" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "affairId" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "cursor" TEXT,
    "secretRef" TEXT,
    "canSend" BOOLEAN NOT NULL DEFAULT false,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "nextSyncAt" DATETIME,
    "lastSyncAt" DATETIME,
    "lastError" TEXT,
    "coverageNote" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "Connector_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Connector_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InboundItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL,
    "path" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "ruleNote" TEXT,
    "action" TEXT NOT NULL DEFAULT 'batch',
    "batchId" TEXT,
    "deliverAt" DATETIME,
    "deliveredAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" DATETIME,
    "leaseToken" TEXT,
    "lastError" TEXT,
    CONSTRAINT "InboundItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InboundItem_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "providerName" TEXT NOT NULL DEFAULT 'unconfigured',
    "providerAvailable" BOOLEAN NOT NULL DEFAULT false,
    "providerSandboxed" BOOLEAN NOT NULL DEFAULT false,
    "providerLastError" TEXT,
    CONSTRAINT "StewardState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Affair_workspaceId_status_lastActivityAt_idx" ON "Affair"("workspaceId", "status", "lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "Affair_workspaceId_dirName_key" ON "Affair"("workspaceId", "dirName");

-- CreateIndex
CREATE INDEX "Schedule_workspaceId_status_nextAt_idx" ON "Schedule"("workspaceId", "status", "nextAt");

-- CreateIndex
CREATE INDEX "Schedule_affairId_status_nextAt_idx" ON "Schedule"("affairId", "status", "nextAt");

-- CreateIndex
CREATE UNIQUE INDEX "Run_tokenHash_key" ON "Run"("tokenHash");

-- CreateIndex
CREATE INDEX "Run_workspaceId_lane_status_createdAt_idx" ON "Run"("workspaceId", "lane", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Run_workspaceId_status_leaseUntil_idx" ON "Run"("workspaceId", "status", "leaseUntil");

-- CreateIndex
CREATE INDEX "Run_workspaceId_status_deadlineAt_idx" ON "Run"("workspaceId", "status", "deadlineAt");

-- CreateIndex
CREATE INDEX "Run_workspaceId_conversationKey_status_idx" ON "Run"("workspaceId", "conversationKey", "status");

-- CreateIndex
CREATE INDEX "Run_affairId_createdAt_idx" ON "Run"("affairId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_workspaceId_conversationKey_at_idx" ON "Message"("workspaceId", "conversationKey", "at");

-- CreateIndex
CREATE INDEX "Message_affairId_at_idx" ON "Message"("affairId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Message_workspaceId_externalId_key" ON "Message"("workspaceId", "externalId");

-- CreateIndex
CREATE INDEX "Activity_affairId_at_idx" ON "Activity"("affairId", "at");

-- CreateIndex
CREATE INDEX "Activity_workspaceId_at_idx" ON "Activity"("workspaceId", "at");

-- CreateIndex
CREATE INDEX "Approval_workspaceId_status_createdAt_idx" ON "Approval"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Approval_affairId_status_idx" ON "Approval"("affairId", "status");

-- CreateIndex
CREATE INDEX "Grant_workspaceId_action_revokedAt_expiresAt_idx" ON "Grant"("workspaceId", "action", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "Preference_workspaceId_createdAt_idx" ON "Preference"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_workspaceId_status_level_nextAttemptAt_idx" ON "Notification"("workspaceId", "status", "level", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Notification_workspaceId_channel_sentAt_idx" ON "Notification"("workspaceId", "channel", "sentAt");

-- CreateIndex
CREATE INDEX "Notification_affairId_createdAt_idx" ON "Notification"("affairId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_approvalId_idx" ON "Notification"("approvalId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_workspaceId_idempotencyKey_key" ON "Notification"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Connector_workspaceId_status_nextSyncAt_idx" ON "Connector"("workspaceId", "status", "nextSyncAt");

-- CreateIndex
CREATE INDEX "Connector_affairId_idx" ON "Connector"("affairId");

-- CreateIndex
CREATE INDEX "InboundItem_workspaceId_status_deliverAt_idx" ON "InboundItem"("workspaceId", "status", "deliverAt");

-- CreateIndex
CREATE INDEX "InboundItem_connectorId_status_receivedAt_idx" ON "InboundItem"("connectorId", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "InboundItem_workspaceId_batchId_idx" ON "InboundItem"("workspaceId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "InboundItem_connectorId_externalId_key" ON "InboundItem"("connectorId", "externalId");

-- CreateIndex
CREATE INDEX "Audit_workspaceId_createdAt_idx" ON "Audit"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Audit_workspaceId_subjectId_createdAt_idx" ON "Audit"("workspaceId", "subjectId", "createdAt");
