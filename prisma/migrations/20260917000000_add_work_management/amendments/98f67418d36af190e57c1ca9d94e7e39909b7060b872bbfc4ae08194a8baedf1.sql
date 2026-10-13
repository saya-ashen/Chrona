-- Owner continuation snapshots; existing inputs remain immutable.
DROP TRIGGER "WorkPageInput_insert";
CREATE TRIGGER "WorkPageInput_insert" BEFORE INSERT ON "WorkPageInput"
WHEN NEW."kind" NOT IN ('note','response','handoff') OR NOT json_valid(NEW."content") OR length(CAST(NEW."content" AS BLOB)) > 32768
 OR length(NEW."actorKey") NOT BETWEEN 1 AND 200 OR length(NEW."entryKey") NOT BETWEEN 1 AND 300
 OR (NEW."kind"='note' AND (NEW."versionId" IS NOT NULL OR NEW."formKey" IS NOT NULL))
 OR (NEW."kind"='response' AND (NEW."versionId" IS NULL OR NEW."formKey" IS NULL))
 OR (NEW."kind"='handoff' AND (NEW."versionId" IS NULL OR NEW."formKey" IS NOT NULL
   OR json_type(NEW."content", '$.snapshotRevision') IS NOT 'integer'
   OR json_extract(NEW."content", '$.snapshotRevision') != NEW."revision"-1
   OR json_type(NEW."content", '$.text') IS NOT 'text'
   OR length(trim(json_extract(NEW."content", '$.text'))) NOT BETWEEN 1 AND 2000))
 OR NOT EXISTS (SELECT 1 FROM "TaskResult" WHERE "id"=NEW."resultId" AND NEW."revision"="inputRevision"+1
 AND (NEW."kind"='note' OR "headVersionId"=NEW."versionId"))
BEGIN SELECT RAISE(ABORT, 'Invalid page input'); END;

-- Personal steward persistence (additive).
-- CreateTable
CREATE TABLE "Affair" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "goal" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "keywords" JSONB NOT NULL DEFAULT '[]',
    "taskId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Affair_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "pollIntervalSeconds" INTEGER,
    "baselineAt" DATETIME,
    "lastSuccessAt" DATETIME,
    "lastFailureAt" DATETIME,
    "lastError" TEXT,
    "nextCheckAt" DATETIME,
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
    "author" TEXT NOT NULL,
    "url" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "affairId" TEXT,
    "linkStatus" TEXT NOT NULL DEFAULT 'unlinked',
    "threadId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
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
    "nextStep" TEXT NOT NULL,
    "proposedAction" TEXT,
    "permission" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventAssessment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EventAssessment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "InboundEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Delegation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "affairId" TEXT,
    "connectionId" TEXT,
    "purpose" TEXT NOT NULL,
    "originalWording" TEXT NOT NULL DEFAULT '',
    "cadenceSeconds" INTEGER,
    "allowedActions" JSONB NOT NULL DEFAULT '[]',
    "askFirstActions" JSONB NOT NULL DEFAULT '[]',
    "notification" JSONB NOT NULL DEFAULT '{"mode":"digest","cooldownMinutes":60,"quietHours":null,"channel":"local_test"}',
    "limits" JSONB NOT NULL DEFAULT '{"maxEventsPerCheck":50,"maxNotificationsPerDay":10}',
    "grantedAt" DATETIME,
    "expiresAt" DATETIME,
    "lastCheckAt" DATETIME,
    "lastSuccessAt" DATETIME,
    "lastFailureAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Delegation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Delegation_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Delegation_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "SourceConnection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AttentionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "affairId" TEXT,
    "eventId" TEXT,
    "delegationId" TEXT,
    "title" TEXT NOT NULL,
    "whatHappened" TEXT NOT NULL,
    "whyItMatters" TEXT NOT NULL,
    "nextStep" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "dueAt" DATETIME,
    "snoozedUntil" DATETIME,
    "cooldownUntil" DATETIME,
    "decision" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AttentionItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AttentionItem_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AttentionItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "InboundEvent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AttentionItem_delegationId_fkey" FOREIGN KEY ("delegationId") REFERENCES "Delegation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StewardNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "attentionItemId" TEXT,
    "delegationId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'generated',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" DATETIME,
    "receiptRef" TEXT,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    "acknowledgedAt" DATETIME,
    CONSTRAINT "StewardNotification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StewardNotification_attentionItemId_fkey" FOREIGN KEY ("attentionItemId") REFERENCES "AttentionItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StewardNotification_delegationId_fkey" FOREIGN KEY ("delegationId") REFERENCES "Delegation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "affairId" TEXT,
    "attentionItemId" TEXT,
    "note" TEXT NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FollowUp_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FollowUp_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FollowUp_attentionItemId_fkey" FOREIGN KEY ("attentionItemId") REFERENCES "AttentionItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ManagedTool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "affairId" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "handlingMode" TEXT NOT NULL,
    "selectionRationale" TEXT NOT NULL,
    "dataScopes" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'generated',
    "validationSummary" TEXT,
    "validatedVersion" INTEGER,
    "authorizedAt" DATETIME,
    "enabledAt" DATETIME,
    "lastRunAt" DATETIME,
    "lastSuccessAt" DATETIME,
    "lastFailureAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ManagedTool_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ManagedTool_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StewardAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT,
    "actorKey" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StewardAudit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StewardState" (
    "workspaceId" TEXT NOT NULL PRIMARY KEY,
    "lastTickAt" DATETIME,
    "assessorName" TEXT NOT NULL DEFAULT 'unconfigured',
    "assessorAvailable" BOOLEAN NOT NULL DEFAULT false,
    "assessorLastError" TEXT,
    CONSTRAINT "StewardState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Affair_workspaceId_status_updatedAt_idx" ON "Affair"("workspaceId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "Affair_taskId_idx" ON "Affair"("taskId");

-- CreateIndex
CREATE INDEX "SourceConnection_workspaceId_status_mode_nextCheckAt_idx" ON "SourceConnection"("workspaceId", "status", "mode", "nextCheckAt");

-- CreateIndex
CREATE INDEX "SourceConnection_status_mode_nextCheckAt_idx" ON "SourceConnection"("status", "mode", "nextCheckAt");

-- CreateIndex
CREATE INDEX "InboundEvent_workspaceId_status_nextAttemptAt_idx" ON "InboundEvent"("workspaceId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "InboundEvent_status_nextAttemptAt_idx" ON "InboundEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "InboundEvent_workspaceId_affairId_linkStatus_idx" ON "InboundEvent"("workspaceId", "affairId", "linkStatus");

-- CreateIndex
CREATE INDEX "InboundEvent_connectionId_threadId_idx" ON "InboundEvent"("connectionId", "threadId");

-- CreateIndex
CREATE UNIQUE INDEX "InboundEvent_connectionId_externalId_key" ON "InboundEvent"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "EventAssessment_workspaceId_eventId_createdAt_idx" ON "EventAssessment"("workspaceId", "eventId", "createdAt");

-- CreateIndex
CREATE INDEX "EventAssessment_eventId_idx" ON "EventAssessment"("eventId");

-- CreateIndex
CREATE INDEX "Delegation_workspaceId_status_lastCheckAt_idx" ON "Delegation"("workspaceId", "status", "lastCheckAt");

-- CreateIndex
CREATE INDEX "Delegation_affairId_idx" ON "Delegation"("affairId");

-- CreateIndex
CREATE INDEX "Delegation_connectionId_idx" ON "Delegation"("connectionId");

-- CreateIndex
CREATE INDEX "AttentionItem_workspaceId_status_snoozedUntil_idx" ON "AttentionItem"("workspaceId", "status", "snoozedUntil");

-- CreateIndex
CREATE INDEX "AttentionItem_workspaceId_kind_dueAt_idx" ON "AttentionItem"("workspaceId", "kind", "dueAt");

-- CreateIndex
CREATE INDEX "AttentionItem_affairId_idx" ON "AttentionItem"("affairId");

-- CreateIndex
CREATE INDEX "AttentionItem_eventId_idx" ON "AttentionItem"("eventId");

-- CreateIndex
CREATE INDEX "AttentionItem_delegationId_idx" ON "AttentionItem"("delegationId");

-- CreateIndex
CREATE UNIQUE INDEX "AttentionItem_workspaceId_dedupeKey_key" ON "AttentionItem"("workspaceId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "StewardNotification_idempotencyKey_key" ON "StewardNotification"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StewardNotification_workspaceId_status_nextAttemptAt_idx" ON "StewardNotification"("workspaceId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "StewardNotification_status_nextAttemptAt_idx" ON "StewardNotification"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "StewardNotification_attentionItemId_idx" ON "StewardNotification"("attentionItemId");

-- CreateIndex
CREATE INDEX "StewardNotification_delegationId_idx" ON "StewardNotification"("delegationId");

-- CreateIndex
CREATE INDEX "FollowUp_workspaceId_status_dueAt_idx" ON "FollowUp"("workspaceId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "FollowUp_affairId_idx" ON "FollowUp"("affairId");

-- CreateIndex
CREATE INDEX "FollowUp_attentionItemId_idx" ON "FollowUp"("attentionItemId");

-- CreateIndex
CREATE INDEX "ManagedTool_workspaceId_state_idx" ON "ManagedTool"("workspaceId", "state");

-- CreateIndex
CREATE INDEX "ManagedTool_affairId_idx" ON "ManagedTool"("affairId");

-- CreateIndex
CREATE INDEX "StewardAudit_workspaceId_createdAt_idx" ON "StewardAudit"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "StewardAudit_workspaceId_subjectId_createdAt_idx" ON "StewardAudit"("workspaceId", "subjectId", "createdAt");

-- Audit history is immutable, except deletion of its owning workspace.
CREATE TRIGGER "StewardAudit_no_update" BEFORE UPDATE ON "StewardAudit"
BEGIN SELECT RAISE(ABORT, 'StewardAudit is append-only'); END;
CREATE TRIGGER "StewardAudit_no_delete" BEFORE DELETE ON "StewardAudit"
WHEN EXISTS (SELECT 1 FROM "Workspace" WHERE "id" = OLD."workspaceId")
BEGIN SELECT RAISE(ABORT, 'StewardAudit is append-only'); END;

-- Steward references cannot cross workspace boundaries.
CREATE TRIGGER "Affair_workspace_immutable" BEFORE UPDATE OF "workspaceId" ON "Affair"
WHEN NEW."workspaceId" <> OLD."workspaceId"
BEGIN SELECT RAISE(ABORT, 'Steward workspace is immutable'); END;
CREATE TRIGGER "Affair_scope_insert" BEFORE INSERT ON "Affair"
WHEN (NEW."taskId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Task" WHERE "id" = NEW."taskId" AND "workspaceId" = NEW."workspaceId"))
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "Affair_scope_update" BEFORE UPDATE ON "Affair"
WHEN (NEW."taskId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Task" WHERE "id" = NEW."taskId" AND "workspaceId" = NEW."workspaceId"))
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "SourceConnection_workspace_immutable" BEFORE UPDATE OF "workspaceId" ON "SourceConnection"
WHEN NEW."workspaceId" <> OLD."workspaceId"
BEGIN SELECT RAISE(ABORT, 'Steward workspace is immutable'); END;
CREATE TRIGGER "InboundEvent_workspace_immutable" BEFORE UPDATE OF "workspaceId" ON "InboundEvent"
WHEN NEW."workspaceId" <> OLD."workspaceId"
BEGIN SELECT RAISE(ABORT, 'Steward workspace is immutable'); END;
CREATE TRIGGER "InboundEvent_scope_insert" BEFORE INSERT ON "InboundEvent"
WHEN (NEW."connectionId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "SourceConnection" WHERE "id" = NEW."connectionId" AND "workspaceId" = NEW."workspaceId")) OR (NEW."affairId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Affair" WHERE "id" = NEW."affairId" AND "workspaceId" = NEW."workspaceId"))
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "InboundEvent_scope_update" BEFORE UPDATE ON "InboundEvent"
WHEN (NEW."connectionId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "SourceConnection" WHERE "id" = NEW."connectionId" AND "workspaceId" = NEW."workspaceId")) OR (NEW."affairId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Affair" WHERE "id" = NEW."affairId" AND "workspaceId" = NEW."workspaceId"))
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "EventAssessment_workspace_immutable" BEFORE UPDATE OF "workspaceId" ON "EventAssessment"
WHEN NEW."workspaceId" <> OLD."workspaceId"
BEGIN SELECT RAISE(ABORT, 'Steward workspace is immutable'); END;
CREATE TRIGGER "EventAssessment_scope_insert" BEFORE INSERT ON "EventAssessment"
WHEN (NEW."eventId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "InboundEvent" WHERE "id" = NEW."eventId" AND "workspaceId" = NEW."workspaceId"))
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "EventAssessment_scope_update" BEFORE UPDATE ON "EventAssessment"
WHEN (NEW."eventId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "InboundEvent" WHERE "id" = NEW."eventId" AND "workspaceId" = NEW."workspaceId"))
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "Delegation_workspace_immutable" BEFORE UPDATE OF "workspaceId" ON "Delegation"
WHEN NEW."workspaceId" <> OLD."workspaceId"
BEGIN SELECT RAISE(ABORT, 'Steward workspace is immutable'); END;
CREATE TRIGGER "Delegation_scope_insert" BEFORE INSERT ON "Delegation"
WHEN (NEW."affairId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Affair" WHERE "id" = NEW."affairId" AND "workspaceId" = NEW."workspaceId")) OR (NEW."connectionId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "SourceConnection" WHERE "id" = NEW."connectionId" AND "workspaceId" = NEW."workspaceId"))
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "Delegation_scope_update" BEFORE UPDATE ON "Delegation"
WHEN (NEW."affairId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Affair" WHERE "id" = NEW."affairId" AND "workspaceId" = NEW."workspaceId")) OR (NEW."connectionId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "SourceConnection" WHERE "id" = NEW."connectionId" AND "workspaceId" = NEW."workspaceId"))
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "AttentionItem_workspace_immutable" BEFORE UPDATE OF "workspaceId" ON "AttentionItem"
WHEN NEW."workspaceId" <> OLD."workspaceId"
BEGIN SELECT RAISE(ABORT, 'Steward workspace is immutable'); END;
CREATE TRIGGER "AttentionItem_scope_insert" BEFORE INSERT ON "AttentionItem"
WHEN (NEW."affairId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Affair" WHERE "id" = NEW."affairId" AND "workspaceId" = NEW."workspaceId")) OR (NEW."eventId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "InboundEvent" WHERE "id" = NEW."eventId" AND "workspaceId" = NEW."workspaceId")) OR (NEW."delegationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Delegation" WHERE "id" = NEW."delegationId" AND "workspaceId" = NEW."workspaceId"))
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "AttentionItem_scope_update" BEFORE UPDATE ON "AttentionItem"
WHEN (NEW."affairId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Affair" WHERE "id" = NEW."affairId" AND "workspaceId" = NEW."workspaceId")) OR (NEW."eventId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "InboundEvent" WHERE "id" = NEW."eventId" AND "workspaceId" = NEW."workspaceId")) OR (NEW."delegationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Delegation" WHERE "id" = NEW."delegationId" AND "workspaceId" = NEW."workspaceId"))
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "StewardNotification_workspace_immutable" BEFORE UPDATE OF "workspaceId" ON "StewardNotification"
WHEN NEW."workspaceId" <> OLD."workspaceId"
BEGIN SELECT RAISE(ABORT, 'Steward workspace is immutable'); END;
CREATE TRIGGER "StewardNotification_scope_insert" BEFORE INSERT ON "StewardNotification"
WHEN (NEW."attentionItemId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AttentionItem" WHERE "id" = NEW."attentionItemId" AND "workspaceId" = NEW."workspaceId")) OR (NEW."delegationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Delegation" WHERE "id" = NEW."delegationId" AND "workspaceId" = NEW."workspaceId"))
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "StewardNotification_scope_update" BEFORE UPDATE ON "StewardNotification"
WHEN (NEW."attentionItemId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AttentionItem" WHERE "id" = NEW."attentionItemId" AND "workspaceId" = NEW."workspaceId")) OR (NEW."delegationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Delegation" WHERE "id" = NEW."delegationId" AND "workspaceId" = NEW."workspaceId"))
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "FollowUp_workspace_immutable" BEFORE UPDATE OF "workspaceId" ON "FollowUp"
WHEN NEW."workspaceId" <> OLD."workspaceId"
BEGIN SELECT RAISE(ABORT, 'Steward workspace is immutable'); END;
CREATE TRIGGER "FollowUp_scope_insert" BEFORE INSERT ON "FollowUp"
WHEN (NEW."affairId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Affair" WHERE "id" = NEW."affairId" AND "workspaceId" = NEW."workspaceId")) OR (NEW."attentionItemId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AttentionItem" WHERE "id" = NEW."attentionItemId" AND "workspaceId" = NEW."workspaceId"))
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "FollowUp_scope_update" BEFORE UPDATE ON "FollowUp"
WHEN (NEW."affairId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Affair" WHERE "id" = NEW."affairId" AND "workspaceId" = NEW."workspaceId")) OR (NEW."attentionItemId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AttentionItem" WHERE "id" = NEW."attentionItemId" AND "workspaceId" = NEW."workspaceId"))
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "ManagedTool_workspace_immutable" BEFORE UPDATE OF "workspaceId" ON "ManagedTool"
WHEN NEW."workspaceId" <> OLD."workspaceId"
BEGIN SELECT RAISE(ABORT, 'Steward workspace is immutable'); END;
CREATE TRIGGER "ManagedTool_scope_insert" BEFORE INSERT ON "ManagedTool"
WHEN (NEW."affairId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Affair" WHERE "id" = NEW."affairId" AND "workspaceId" = NEW."workspaceId"))
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "ManagedTool_scope_update" BEFORE UPDATE ON "ManagedTool"
WHEN (NEW."affairId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Affair" WHERE "id" = NEW."affairId" AND "workspaceId" = NEW."workspaceId"))
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "StewardState_workspace_immutable" BEFORE UPDATE OF "workspaceId" ON "StewardState"
WHEN NEW."workspaceId" <> OLD."workspaceId"
BEGIN SELECT RAISE(ABORT, 'Steward workspace is immutable'); END;

-- Declarative managed-tool definitions and terminal lifecycle timestamps.
ALTER TABLE "ManagedTool" ADD COLUMN "spec" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ManagedTool" ADD COLUMN "disabledAt" DATETIME;
ALTER TABLE "ManagedTool" ADD COLUMN "retiredAt" DATETIME;
