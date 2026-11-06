-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{"notifications":{"dailyCap":5,"quietHours":{"start":"23:00","end":"08:00"},"timezone":"Asia/Shanghai","digestAt":"09:00"}}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "moduleId" TEXT,
    "originSessionId" TEXT,
    "providerSessionId" TEXT,
    "entryModuleId" TEXT,
    "focus" JSONB NOT NULL DEFAULT '["files"]',
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "Session_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Session_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Session_originSessionId_fkey" FOREIGN KEY ("originSessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "activeHash" TEXT,
    "dataSchema" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Module_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModuleVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "intent" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModuleVersion_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Generation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "modules" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Generation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModuleRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "firedAt" DATETIME NOT NULL,
    "exitCode" INTEGER NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModuleRun_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModuleCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "moduleRunId" TEXT,
    "eventKey" TEXT,
    "method" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModuleCall_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModuleInvocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "caller" TEXT NOT NULL,
    "callerModuleId" TEXT,
    "callerHash" TEXT,
    "target" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "key" TEXT NOT NULL,
    "chain" JSONB NOT NULL DEFAULT '[]',
    "mode" TEXT NOT NULL,
    "idempotent" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "leaseToken" TEXT,
    "leaseUntil" DATETIME,
    "output" JSONB,
    "error" TEXT,
    "reply" BOOLEAN NOT NULL DEFAULT false,
    "replyAttempts" INTEGER NOT NULL DEFAULT 0,
    "repliedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "ModuleInvocation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "originSessionId" TEXT,
    "mode" TEXT NOT NULL,
    "rule" JSONB NOT NULL,
    "text" TEXT NOT NULL,
    "moduleId" TEXT,
    "triggerId" TEXT,
    "payload" JSONB,
    "until" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "nextAt" DATETIME,
    "lastAt" DATETIME,
    "lastResult" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Schedule_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Schedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Schedule_originSessionId_fkey" FOREIGN KEY ("originSessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT,
    "lane" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "provider" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "leaseUntil" DATETIME,
    "deadlineAt" DATETIME,
    "prompt" TEXT NOT NULL,
    "summary" TEXT,
    "label" TEXT,
    "cwd" TEXT NOT NULL,
    "toolCalls" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Run_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Run_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "callerKey" TEXT NOT NULL,
    "moduleId" TEXT,
    "callerHash" TEXT,
    "workId" TEXT NOT NULL,
    "commandKey" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "projectRef" TEXT NOT NULL,
    "projectDigest" TEXT NOT NULL,
    "resolvedCwd" TEXT,
    "executorId" TEXT NOT NULL DEFAULT 'server',
    "executorGeneration" INTEGER NOT NULL DEFAULT 1,
    "mappingRevision" INTEGER NOT NULL DEFAULT 1,
    "directoryIdentity" TEXT,
    "queueExpiresAt" DATETIME,
    "workspaceRef" TEXT,
    "workspaceMode" TEXT,
    "sourceManifest" JSONB,
    "sourceReceipt" JSONB,
    "logDir" TEXT NOT NULL,
    "baseline" TEXT NOT NULL,
    "budget" JSONB NOT NULL,
    "cancelRequestedAt" DATETIME,
    "capabilityRevokedAt" DATETIME,
    "stopConfirmedAt" DATETIME,
    "stopEvidence" JSONB,
    "heldDirectory" TEXT,
    "snapshotChargeBytes" INTEGER NOT NULL DEFAULT 0,
    "controlChargeBytes" INTEGER NOT NULL DEFAULT 0,
    "detailBytes" INTEGER NOT NULL DEFAULT 0,
    "highWatermark" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExecutionAttempt_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExecutionAttempt_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExecutionAttempt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionDetail" (
    "attemptId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "event" JSONB NOT NULL,
    "bytes" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,

    PRIMARY KEY ("attemptId", "seq"),
    CONSTRAINT "ExecutionDetail_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExecutionAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionSnapshot" (
    "attemptId" TEXT NOT NULL PRIMARY KEY,
    "snapshot" JSONB NOT NULL,
    "bytes" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "ExecutionSnapshot_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExecutionAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionControl" (
    "attemptId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "fact" JSONB NOT NULL,
    "bytes" INTEGER NOT NULL,

    PRIMARY KEY ("attemptId", "slot"),
    CONSTRAINT "ExecutionControl_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExecutionAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionCommand" (
    "attemptId" TEXT NOT NULL,
    "commandKey" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "receipt" JSONB NOT NULL,
    "offeredAt" DATETIME,
    "effect" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("attemptId", "commandKey"),
    CONSTRAINT "ExecutionCommand_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExecutionAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionExecutor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "credentialHash" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "revokedAt" DATETIME,
    "authorizedUntil" DATETIME,
    "incarnation" TEXT,
    "reconciledAt" DATETIME,
    "lastSeenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ExecutorPairing" (
    "codeHash" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "receiptExpiresAt" DATETIME NOT NULL,
    "executorId" TEXT,
    "credentialHash" TEXT,
    "consumedAt" DATETIME,
    CONSTRAINT "ExecutorPairing_executorId_fkey" FOREIGN KEY ("executorId") REFERENCES "ExecutionExecutor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutorAssignment" (
    "attemptId" TEXT NOT NULL PRIMARY KEY,
    "assignmentId" TEXT NOT NULL,
    "executorId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "incarnation" TEXT NOT NULL,
    "launchDigest" TEXT,
    "launch" JSONB,
    "preparedAt" DATETIME,
    "offeredAt" DATETIME,
    "startedAt" DATETIME,
    "processIdentity" JSONB,
    "sourceHighWatermark" INTEGER NOT NULL DEFAULT 0,
    "sourceProducedThrough" INTEGER NOT NULL DEFAULT 0,
    "receiptCount" INTEGER NOT NULL DEFAULT 0,
    "receiptBytes" INTEGER NOT NULL DEFAULT 0,
    "finalDigest" TEXT,
    "final" JSONB,
    "finalizedAt" DATETIME,
    "tombstoneDigest" TEXT,
    CONSTRAINT "ExecutorAssignment_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExecutionAttempt" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExecutorAssignment_executorId_fkey" FOREIGN KEY ("executorId") REFERENCES "ExecutionExecutor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutorSourceReceipt" (
    "attemptId" TEXT NOT NULL,
    "sourceSeq" INTEGER NOT NULL,
    "digest" TEXT NOT NULL,
    "throughSourceSeq" INTEGER NOT NULL,
    "storedSeq" INTEGER,
    "bytes" INTEGER NOT NULL,

    PRIMARY KEY ("attemptId", "sourceSeq"),
    CONSTRAINT "ExecutorSourceReceipt_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExecutorAssignment" ("attemptId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "quotedMessageId" TEXT,
    "externalId" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_quotedMessageId_fkey" FOREIGN KEY ("quotedMessageId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "moduleId" TEXT,
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
    CONSTRAINT "Approval_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
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
    "topic" TEXT NOT NULL DEFAULT 'general',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    CONSTRAINT "Preference_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
CREATE INDEX "Session_workspaceId_key_status_idx" ON "Session"("workspaceId", "key", "status");

-- CreateIndex
CREATE INDEX "Session_workspaceId_source_lastActivityAt_idx" ON "Session"("workspaceId", "source", "lastActivityAt");

-- CreateIndex
CREATE INDEX "Module_workspaceId_status_idx" ON "Module"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Module_workspaceId_name_key" ON "Module"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "ModuleVersion_moduleId_status_createdAt_idx" ON "ModuleVersion"("moduleId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleVersion_moduleId_hash_key" ON "ModuleVersion"("moduleId", "hash");

-- CreateIndex
CREATE UNIQUE INDEX "Generation_workspaceId_seq_key" ON "Generation"("workspaceId", "seq");

-- CreateIndex
CREATE INDEX "ModuleRun_moduleId_createdAt_idx" ON "ModuleRun"("moduleId", "createdAt");

-- CreateIndex
CREATE INDEX "ModuleRun_moduleId_hash_firedAt_idx" ON "ModuleRun"("moduleId", "hash", "firedAt");

-- CreateIndex
CREATE INDEX "ModuleCall_moduleId_method_key_status_idx" ON "ModuleCall"("moduleId", "method", "key", "status");

-- CreateIndex
CREATE INDEX "ModuleCall_moduleRunId_idx" ON "ModuleCall"("moduleRunId");

-- CreateIndex
CREATE INDEX "ModuleInvocation_workspaceId_status_nextAttemptAt_idx" ON "ModuleInvocation"("workspaceId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ModuleInvocation_workspaceId_reply_repliedAt_idx" ON "ModuleInvocation"("workspaceId", "reply", "repliedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleInvocation_workspaceId_caller_target_tool_key_key" ON "ModuleInvocation"("workspaceId", "caller", "target", "tool", "key");

-- CreateIndex
CREATE INDEX "Schedule_workspaceId_status_nextAt_idx" ON "Schedule"("workspaceId", "status", "nextAt");

-- CreateIndex
CREATE INDEX "Schedule_moduleId_status_idx" ON "Schedule"("moduleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Run_tokenHash_key" ON "Run"("tokenHash");

-- CreateIndex
CREATE INDEX "Run_workspaceId_lane_status_createdAt_idx" ON "Run"("workspaceId", "lane", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Run_workspaceId_status_leaseUntil_idx" ON "Run"("workspaceId", "status", "leaseUntil");

-- CreateIndex
CREATE INDEX "Run_workspaceId_status_deadlineAt_idx" ON "Run"("workspaceId", "status", "deadlineAt");

-- CreateIndex
CREATE INDEX "Run_sessionId_createdAt_idx" ON "Run"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionAttempt_runId_key" ON "ExecutionAttempt"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionAttempt_heldDirectory_key" ON "ExecutionAttempt"("heldDirectory");

-- CreateIndex
CREATE INDEX "ExecutionAttempt_executorId_stopConfirmedAt_idx" ON "ExecutionAttempt"("executorId", "stopConfirmedAt");

-- CreateIndex
CREATE INDEX "ExecutionAttempt_moduleId_stopConfirmedAt_idx" ON "ExecutionAttempt"("moduleId", "stopConfirmedAt");

-- CreateIndex
CREATE INDEX "ExecutionAttempt_workspaceId_ownerId_workId_createdAt_idx" ON "ExecutionAttempt"("workspaceId", "ownerId", "workId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionAttempt_workspaceId_ownerId_callerKey_commandKey_key" ON "ExecutionAttempt"("workspaceId", "ownerId", "callerKey", "commandKey");

-- CreateIndex
CREATE INDEX "ExecutionDetail_expiresAt_idx" ON "ExecutionDetail"("expiresAt");

-- CreateIndex
CREATE INDEX "ExecutionSnapshot_expiresAt_idx" ON "ExecutionSnapshot"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionExecutor_credentialHash_key" ON "ExecutionExecutor"("credentialHash");

-- CreateIndex
CREATE INDEX "ExecutionExecutor_workspaceId_ownerId_idx" ON "ExecutionExecutor"("workspaceId", "ownerId");

-- CreateIndex
CREATE INDEX "ExecutorPairing_receiptExpiresAt_idx" ON "ExecutorPairing"("receiptExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutorAssignment_assignmentId_key" ON "ExecutorAssignment"("assignmentId");

-- CreateIndex
CREATE INDEX "ExecutorAssignment_executorId_generation_idx" ON "ExecutorAssignment"("executorId", "generation");

-- CreateIndex
CREATE INDEX "Message_sessionId_at_idx" ON "Message"("sessionId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Message_workspaceId_externalId_key" ON "Message"("workspaceId", "externalId");

-- CreateIndex
CREATE INDEX "Approval_workspaceId_status_createdAt_idx" ON "Approval"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Approval_moduleId_status_idx" ON "Approval"("moduleId", "status");

-- CreateIndex
CREATE INDEX "Grant_workspaceId_action_revokedAt_expiresAt_idx" ON "Grant"("workspaceId", "action", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "Preference_workspaceId_createdAt_idx" ON "Preference"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Audit_workspaceId_createdAt_idx" ON "Audit"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Audit_workspaceId_subjectId_createdAt_idx" ON "Audit"("workspaceId", "subjectId", "createdAt");
