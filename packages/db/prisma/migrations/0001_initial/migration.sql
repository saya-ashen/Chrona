-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "activeHash" TEXT,
    "activationId" TEXT NOT NULL,
    "executionFenceAt" DATETIME,
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
    "moduleId" TEXT,
    "accountingModuleId" TEXT,
    "workspaceId" TEXT,
    "moduleName" TEXT,
    "hash" TEXT NOT NULL,
    "moduleRunId" TEXT,
    "eventKey" TEXT,
    "method" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModuleCall_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModuleInvocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "caller" TEXT NOT NULL,
    "callerModuleId" TEXT,
    "callerHash" TEXT,
    "runId" TEXT,
    "target" TEXT NOT NULL,
    "targetIdentity" TEXT NOT NULL DEFAULT '',
    "targetBound" BOOLEAN NOT NULL DEFAULT false,
    "targetModuleId" TEXT,
    "targetHash" TEXT,
    "targetContractHash" TEXT,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "key" TEXT NOT NULL,
    "requestDigest" TEXT,
    "chain" JSONB NOT NULL DEFAULT '[]',
    "mode" TEXT NOT NULL,
    "idempotent" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "leaseToken" TEXT,
    "leaseUntil" DATETIME,
    "output" JSONB,
    "operationOutput" JSONB,
    "error" TEXT,
    "errorCode" TEXT,
    "errorReason" TEXT,
    "reply" BOOLEAN NOT NULL DEFAULT false,
    "replyAttempts" INTEGER NOT NULL DEFAULT 0,
    "repliedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "ModuleInvocation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ModuleInvocation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Timer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "timerId" TEXT NOT NULL,
    "rule" JSONB NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "nextAt" DATETIME,
    "lastAt" DATETIME,
    "lastResult" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Timer_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Timer_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "eventSequence" INTEGER NOT NULL DEFAULT 0,
    "cancelRequestedAt" DATETIME,
    "stopStatus" TEXT NOT NULL DEFAULT 'pending',
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
    CONSTRAINT "Run_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentContext" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "Approval_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Approval_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    CONSTRAINT "StewardState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentContext" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "moduleId" TEXT,
    "hash" TEXT NOT NULL,
    "cwd" TEXT,
    "providerId" TEXT,
    "providerRevision" TEXT,
    "providerSessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentContext_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentContext_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentProvider" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "declaration" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("workspaceId", "id"),
    CONSTRAINT "AgentProvider_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentRunProvider" (
    "runId" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "declaration" JSONB NOT NULL,
    "providerOptions" JSONB NOT NULL,
    "completion" JSONB,
    "kind" TEXT NOT NULL DEFAULT 'conversation',
    CONSTRAINT "AgentRunProvider_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentRunAdmission" (
    "runId" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "targets" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    CONSTRAINT "AgentRunAdmission_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentCommand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "output" JSONB NOT NULL,
    "settled" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentCommand_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProviderLaunch" (
    "runId" TEXT NOT NULL PRIMARY KEY,
    "digest" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderLaunch_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RunEvent" (
    "runId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("runId", "sequence"),
    CONSTRAINT "RunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RunInteraction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" DATETIME,
    CONSTRAINT "RunInteraction_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KernelFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "consumedBy" TEXT,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "KernelFact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KernelFactConsumer" (
    "workspaceId" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT,
    "revision" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KernelFactConsumer_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CandidateAdmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "submitterModuleId" TEXT NOT NULL,
    "submitterHash" TEXT NOT NULL,
    "targets" JSONB NOT NULL,
    "issuer" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "CandidateAdmission_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CandidateReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "admissionId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "approvalId" TEXT,
    "createdAt" DATETIME NOT NULL,
    "members" JSONB NOT NULL,
    CONSTRAINT "CandidateReceipt_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "CandidateAdmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CandidateMember" (
    "versionId" TEXT NOT NULL PRIMARY KEY,
    "receiptId" TEXT NOT NULL,
    CONSTRAINT "CandidateMember_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "CandidateReceipt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModuleExecutionResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "activationId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "consecutiveFailures" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "ModuleExecutionResult_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModuleActivation" (
    "activationId" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "previousHash" TEXT,
    "candidateHash" TEXT NOT NULL,
    "activatedAt" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "checks" JSONB NOT NULL,
    "observedCapabilities" JSONB NOT NULL,
    "dataHandling" TEXT NOT NULL,
    "nextAction" TEXT NOT NULL,
    "rollback" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ModuleActivation_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModuleInstallation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "package" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "moduleId" TEXT,
    "hash" TEXT,
    "approvalId" TEXT,
    "errorCode" TEXT,
    "errorReason" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModuleInstallation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModuleInstallationHead" (
    "workspaceId" TEXT NOT NULL,
    "package" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,

    PRIMARY KEY ("workspaceId", "package"),
    CONSTRAINT "ModuleInstallationHead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ModuleInstallationHead_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "ModuleInstallation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModuleInstallationSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "installationId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "moduleId" TEXT,
    "existingVersionId" TEXT,
    "marker" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "error" TEXT,
    CONSTRAINT "ModuleInstallationSubmission_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "ModuleInstallation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModuleRemoval" (
    "moduleId" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hash" TEXT,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "ModuleRemoval_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModuleMigration" (
    "moduleId" TEXT NOT NULL PRIMARY KEY,
    "hash" TEXT NOT NULL,
    "fromSchema" INTEGER,
    "toSchema" INTEGER NOT NULL,
    "previousStatus" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "ModuleMigration_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Module_workspaceId_status_idx" ON "Module"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Module_workspaceId_name_key" ON "Module"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "ModuleVersion_moduleId_status_createdAt_idx" ON "ModuleVersion"("moduleId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ModuleVersion_moduleId_createdAt_id_idx" ON "ModuleVersion"("moduleId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleVersion_moduleId_hash_key" ON "ModuleVersion"("moduleId", "hash");

-- CreateIndex
CREATE INDEX "ModuleRun_moduleId_createdAt_id_idx" ON "ModuleRun"("moduleId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ModuleRun_moduleId_hash_firedAt_idx" ON "ModuleRun"("moduleId", "hash", "firedAt");

-- CreateIndex
CREATE INDEX "ModuleCall_moduleId_method_key_status_idx" ON "ModuleCall"("moduleId", "method", "key", "status");

-- CreateIndex
CREATE INDEX "ModuleCall_moduleRunId_idx" ON "ModuleCall"("moduleRunId");

-- CreateIndex
CREATE INDEX "ModuleInvocation_workspaceId_status_nextAttemptAt_idx" ON "ModuleInvocation"("workspaceId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ModuleInvocation_workspaceId_mode_createdAt_idx" ON "ModuleInvocation"("workspaceId", "mode", "createdAt");

-- CreateIndex
CREATE INDEX "ModuleInvocation_workspaceId_reply_repliedAt_idx" ON "ModuleInvocation"("workspaceId", "reply", "repliedAt");

-- CreateIndex
CREATE INDEX "ModuleInvocation_runId_status_idx" ON "ModuleInvocation"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleInvocation_workspaceId_caller_targetIdentity_tool_key_key" ON "ModuleInvocation"("workspaceId", "caller", "targetIdentity", "tool", "key");

-- CreateIndex
CREATE INDEX "Timer_workspaceId_status_nextAt_idx" ON "Timer"("workspaceId", "status", "nextAt");

-- CreateIndex
CREATE INDEX "Timer_moduleId_status_idx" ON "Timer"("moduleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Timer_moduleId_timerId_key" ON "Timer"("moduleId", "timerId");

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
CREATE INDEX "Approval_workspaceId_status_createdAt_idx" ON "Approval"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Approval_moduleId_status_idx" ON "Approval"("moduleId", "status");

-- CreateIndex
CREATE INDEX "Audit_workspaceId_createdAt_idx" ON "Audit"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Audit_workspaceId_subjectId_createdAt_idx" ON "Audit"("workspaceId", "subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentContext_workspaceId_moduleId_idx" ON "AgentContext"("workspaceId", "moduleId");

-- CreateIndex
CREATE INDEX "AgentContext_workspaceId_status_lastActivityAt_idx" ON "AgentContext"("workspaceId", "status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "AgentProvider_workspaceId_moduleId_idx" ON "AgentProvider"("workspaceId", "moduleId");

-- CreateIndex
CREATE INDEX "AgentRunProvider_moduleId_hash_idx" ON "AgentRunProvider"("moduleId", "hash");

-- CreateIndex
CREATE INDEX "AgentCommand_workspaceId_moduleId_idx" ON "AgentCommand"("workspaceId", "moduleId");

-- CreateIndex
CREATE INDEX "RunInteraction_runId_createdAt_id_idx" ON "RunInteraction"("runId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "KernelFact_workspaceId_consumedAt_createdAt_id_idx" ON "KernelFact"("workspaceId", "consumedAt", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateReceipt_admissionId_key" ON "CandidateReceipt"("admissionId");

-- CreateIndex
CREATE INDEX "CandidateMember_receiptId_idx" ON "CandidateMember"("receiptId");

-- CreateIndex
CREATE INDEX "ModuleExecutionResult_moduleId_activationId_createdAt_id_idx" ON "ModuleExecutionResult"("moduleId", "activationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleExecutionResult_activationId_resultId_key" ON "ModuleExecutionResult"("activationId", "resultId");

-- CreateIndex
CREATE INDEX "ModuleActivation_moduleId_candidateHash_createdAt_idx" ON "ModuleActivation"("moduleId", "candidateHash", "createdAt");

-- CreateIndex
CREATE INDEX "ModuleActivation_moduleId_updatedAt_idx" ON "ModuleActivation"("moduleId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleInstallation_workspaceId_requestKey_key" ON "ModuleInstallation"("workspaceId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleInstallationSubmission_installationId_key" ON "ModuleInstallationSubmission"("installationId");

-- CreateIndex
CREATE INDEX "ModuleRemoval_workspaceId_name_hash_createdAt_idx" ON "ModuleRemoval"("workspaceId", "name", "hash", "createdAt");
