
-- Executor-independent work recording and meeting follow-through.
-- CreateTable
CREATE TABLE "WorkRecord" (
    "taskId" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "context" JSONB NOT NULL,
    "signals" JSONB NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "nextAction" TEXT NOT NULL DEFAULT '',
    "needsAttention" BOOLEAN NOT NULL DEFAULT true,
    "lastActorKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkRecord_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "actorKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkSource_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkRecord" ("taskId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorKey" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "resolvesId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkRecord" ("taskId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkCommand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorKey" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "receipt" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkCommand_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkRecord" ("taskId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WorkRecord_workspaceId_needsAttention_updatedAt_idx" ON "WorkRecord"("workspaceId", "needsAttention", "updatedAt");

-- CreateIndex
CREATE INDEX "WorkSource_taskId_idx" ON "WorkSource"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSource_workspaceId_sourceKey_key" ON "WorkSource"("workspaceId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "WorkEntry_resolvesId_key" ON "WorkEntry"("resolvesId");

-- CreateIndex
CREATE INDEX "WorkEntry_taskId_createdAt_idx" ON "WorkEntry"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkCommand_workspaceId_actorKey_operation_requestId_key" ON "WorkCommand"("workspaceId", "actorKey", "operation", "requestId");



-- Work recording is task-owned; provenance and receipts are append-only.
CREATE TRIGGER "WorkRecord_scope_insert" BEFORE INSERT ON "WorkRecord" BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM "Task" WHERE "id" = NEW."taskId" AND "workspaceId" = NEW."workspaceId" AND "taskExecutionMode" = 'manual' AND "autoPlanGeneration" = 0 AND "autoExecute" = 0)
    THEN RAISE(ABORT, 'WorkRecord requires same-workspace manual Task') END;
END;
CREATE TRIGGER "WorkRecord_identity_update" BEFORE UPDATE ON "WorkRecord" WHEN NEW."taskId" != OLD."taskId" OR NEW."workspaceId" != OLD."workspaceId" OR NEW."createdAt" != OLD."createdAt" BEGIN SELECT RAISE(ABORT, 'WorkRecord identity is immutable'); END;
CREATE TRIGGER "WorkSource_scope_insert" BEFORE INSERT ON "WorkSource" BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM "WorkRecord" WHERE "taskId" = NEW."taskId" AND "workspaceId" = NEW."workspaceId") THEN RAISE(ABORT, 'WorkSource scope mismatch') END;
END;
CREATE TRIGGER "WorkEntry_resolution_insert" BEFORE INSERT ON "WorkEntry" WHEN NEW."resolvesId" IS NOT NULL BEGIN
 SELECT CASE WHEN NEW."kind" != 'resolve' OR NOT EXISTS (SELECT 1 FROM "WorkEntry" WHERE "id" = NEW."resolvesId" AND "taskId" = NEW."taskId" AND "kind" = 'propose') THEN RAISE(ABORT, 'WorkEntry resolution scope mismatch') END;
END;
CREATE TRIGGER "WorkCommand_scope_insert" BEFORE INSERT ON "WorkCommand" BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM "WorkRecord" WHERE "taskId" = NEW."taskId" AND "workspaceId" = NEW."workspaceId") THEN RAISE(ABORT, 'WorkCommand scope mismatch') END;
END;
CREATE TRIGGER "WorkSource_immutable" BEFORE UPDATE ON "WorkSource" BEGIN SELECT RAISE(ABORT, 'WorkSource is immutable'); END;
CREATE TRIGGER "WorkEntry_immutable" BEFORE UPDATE ON "WorkEntry" BEGIN SELECT RAISE(ABORT, 'WorkEntry is immutable'); END;
CREATE TRIGGER "WorkCommand_immutable" BEFORE UPDATE ON "WorkCommand" BEGIN SELECT RAISE(ABORT, 'WorkCommand is immutable'); END;
CREATE TRIGGER "WorkSource_delete" BEFORE DELETE ON "WorkSource" WHEN EXISTS (SELECT 1 FROM "WorkRecord" WHERE "taskId" = OLD."taskId") BEGIN SELECT RAISE(ABORT, 'Delete the owning work record'); END;
CREATE TRIGGER "WorkEntry_delete" BEFORE DELETE ON "WorkEntry" WHEN EXISTS (SELECT 1 FROM "WorkRecord" WHERE "taskId" = OLD."taskId") BEGIN SELECT RAISE(ABORT, 'Delete the owning work record'); END;
CREATE TRIGGER "WorkCommand_delete" BEFORE DELETE ON "WorkCommand" WHEN EXISTS (SELECT 1 FROM "WorkRecord" WHERE "taskId" = OLD."taskId") BEGIN SELECT RAISE(ABORT, 'Delete the owning work record'); END;

-- Work pages v1: additive storage, no parent table rebuild.
ALTER TABLE "TaskResult" ADD COLUMN "inputRevision" INTEGER NOT NULL DEFAULT 0;
-- CreateTable
CREATE TABLE "WorkPageInput" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resultId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "entryKey" TEXT NOT NULL,
    "versionId" TEXT,
    "formKey" TEXT,
    "content" JSONB NOT NULL,
    "actorKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkPageInput_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "TaskResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkPageInput_versionId_resultId_fkey" FOREIGN KEY ("versionId", "resultId") REFERENCES "TaskResultVersion" ("id", "resultId") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "WorkPageCommand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "actorKey" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "receipt" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkPageCommand_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "TaskResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);


-- CreateIndex
CREATE INDEX "WorkPageInput_resultId_entryKey_revision_idx" ON "WorkPageInput"("resultId", "entryKey", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "WorkPageInput_resultId_revision_key" ON "WorkPageInput"("resultId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "WorkPageCommand_workspaceId_actorKey_requestId_key" ON "WorkPageCommand"("workspaceId", "actorKey", "requestId");


-- Work pages: independent owner input revision; result review/publication keep their revision semantics.
DROP TRIGGER "TaskResult_scope_update";
CREATE TRIGGER "TaskResult_scope_update" BEFORE UPDATE ON "TaskResult"
WHEN NEW."id" IS NOT OLD."id" OR NEW."workspaceId" IS NOT OLD."workspaceId" OR NEW."taskId" IS NOT OLD."taskId"
 OR NEW."occurrenceId" IS NOT OLD."occurrenceId" OR NEW."scopeKey" IS NOT OLD."scopeKey" OR NEW."createdAt" IS NOT OLD."createdAt"
 OR NOT ((NEW."editRevision" = OLD."editRevision" + 1 AND NEW."inputRevision" = OLD."inputRevision")
 OR (NEW."editRevision" = OLD."editRevision" AND NEW."inputRevision" = OLD."inputRevision" + 1
 AND NEW."headVersionId" IS OLD."headVersionId" AND NEW."acceptedVersionId" IS OLD."acceptedVersionId"
 AND EXISTS (SELECT 1 FROM "WorkPageInput" WHERE "resultId"=OLD."id" AND "revision"=NEW."inputRevision")))
BEGIN SELECT RAISE(ABORT, 'Result identity is immutable and one revision must advance'); END;
CREATE TRIGGER "TaskResult_input_initial" BEFORE INSERT ON "TaskResult" WHEN NEW."inputRevision" != 0
BEGIN SELECT RAISE(ABORT, 'Input revision must start at zero'); END;
CREATE TRIGGER "WorkPageInput_insert" BEFORE INSERT ON "WorkPageInput"
WHEN NEW."kind" NOT IN ('note','response') OR NOT json_valid(NEW."content") OR length(CAST(NEW."content" AS BLOB)) > 32768
 OR length(NEW."actorKey") NOT BETWEEN 1 AND 200 OR length(NEW."entryKey") NOT BETWEEN 1 AND 300
 OR (NEW."kind"='note' AND (NEW."versionId" IS NOT NULL OR NEW."formKey" IS NOT NULL))
 OR (NEW."kind"='response' AND (NEW."versionId" IS NULL OR NEW."formKey" IS NULL))
 OR NOT EXISTS (SELECT 1 FROM "TaskResult" WHERE "id"=NEW."resultId" AND NEW."revision"="inputRevision"+1
 AND (NEW."kind"='note' OR "headVersionId"=NEW."versionId"))
BEGIN SELECT RAISE(ABORT, 'Invalid page input'); END;
CREATE TRIGGER "WorkPageInput_immutable" BEFORE UPDATE ON "WorkPageInput"
BEGIN SELECT RAISE(ABORT, 'Page input history is immutable'); END;
CREATE TRIGGER "WorkPageInput_delete" BEFORE DELETE ON "WorkPageInput"
WHEN EXISTS (SELECT 1 FROM "TaskResult" WHERE "id"=OLD."resultId")
BEGIN SELECT RAISE(ABORT, 'Delete the owning result, not input history'); END;
CREATE TRIGGER "WorkPageCommand_insert" BEFORE INSERT ON "WorkPageCommand"
WHEN NOT json_valid(NEW."receipt") OR length(CAST(NEW."receipt" AS BLOB)) > 4096 OR length(NEW."payloadHash") != 64
 OR NOT EXISTS (SELECT 1 FROM "TaskResult" WHERE "id"=NEW."resultId" AND "workspaceId"=NEW."workspaceId")
BEGIN SELECT RAISE(ABORT, 'Invalid page command'); END;
CREATE TRIGGER "WorkPageCommand_immutable" BEFORE UPDATE ON "WorkPageCommand"
BEGIN SELECT RAISE(ABORT, 'Page receipts are immutable'); END;
CREATE TRIGGER "WorkPageCommand_delete" BEFORE DELETE ON "WorkPageCommand"
WHEN EXISTS (SELECT 1 FROM "TaskResult" WHERE "id"=OLD."resultId")
BEGIN SELECT RAISE(ABORT, 'Delete the owning result, not page receipts'); END;

-- Grouped, mutually-exclusive classifications over existing Tasks. No result copies.
CREATE TABLE "LibraryState" (
 "workspaceId" TEXT NOT NULL PRIMARY KEY,
 "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision">=0),
 CONSTRAINT "LibraryState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "LibraryGroup" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "workspaceId" TEXT NOT NULL,
 "name" TEXT NOT NULL,
 "nameKey" TEXT NOT NULL,
 "instructions" TEXT NOT NULL DEFAULT '',
 "allowAgentFolders" BOOLEAN NOT NULL DEFAULT true,
 CONSTRAINT "LibraryGroup_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LibraryGroup_workspaceId_nameKey_key" ON "LibraryGroup"("workspaceId","nameKey");
CREATE TABLE "LibraryFolder" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "groupId" TEXT NOT NULL,
 "name" TEXT NOT NULL,
 "nameKey" TEXT NOT NULL,
 "description" TEXT NOT NULL DEFAULT '',
 CONSTRAINT "LibraryFolder_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "LibraryGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LibraryFolder_groupId_nameKey_key" ON "LibraryFolder"("groupId","nameKey");
CREATE TABLE "LibraryAssignment" (
 "taskId" TEXT NOT NULL,
 "groupId" TEXT NOT NULL,
 "folderId" TEXT,
 "protected" BOOLEAN NOT NULL DEFAULT false,
 "actorKey" TEXT NOT NULL,
 PRIMARY KEY ("taskId","groupId"),
 CONSTRAINT "LibraryAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "LibraryAssignment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "LibraryGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "LibraryAssignment_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "LibraryFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "LibraryAssignment_folderId_idx" ON "LibraryAssignment"("folderId");
CREATE INDEX "LibraryAssignment_groupId_idx" ON "LibraryAssignment"("groupId");
CREATE TABLE "LibraryCommand" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "workspaceId" TEXT NOT NULL,
 "actorKey" TEXT NOT NULL,
 "requestId" TEXT NOT NULL,
 "payloadHash" TEXT NOT NULL,
 "taskId" TEXT,
 "receipt" JSONB NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "LibraryCommand_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LibraryCommand_workspaceId_actorKey_requestId_key" ON "LibraryCommand"("workspaceId","actorKey","requestId");
CREATE INDEX "LibraryCommand_workspaceId_taskId_createdAt_idx" ON "LibraryCommand"("workspaceId","taskId","createdAt");
CREATE TRIGGER "LibraryAssignment_insert_scope" BEFORE INSERT ON "LibraryAssignment"
WHEN NOT EXISTS (SELECT 1 FROM "Task" t JOIN "LibraryGroup" g ON t."workspaceId"=g."workspaceId" WHERE t."id"=NEW."taskId" AND g."id"=NEW."groupId")
 OR (NEW."folderId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "LibraryFolder" f WHERE f."id"=NEW."folderId" AND f."groupId"=NEW."groupId"))
BEGIN SELECT RAISE(ABORT, 'Invalid classification scope'); END;
CREATE TRIGGER "LibraryAssignment_update_scope" BEFORE UPDATE ON "LibraryAssignment"
WHEN NEW."taskId"!=OLD."taskId" OR NEW."groupId"!=OLD."groupId"
 OR (NEW."folderId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "LibraryFolder" f WHERE f."id"=NEW."folderId" AND f."groupId"=NEW."groupId"))
BEGIN SELECT RAISE(ABORT, 'Invalid classification move'); END;
CREATE TRIGGER "LibraryGroup_scope" BEFORE UPDATE OF "workspaceId" ON "LibraryGroup"
WHEN NEW."workspaceId"!=OLD."workspaceId"
BEGIN SELECT RAISE(ABORT, 'Classification workspace is immutable'); END;
CREATE TRIGGER "LibraryFolder_scope" BEFORE UPDATE OF "groupId" ON "LibraryFolder"
WHEN NEW."groupId"!=OLD."groupId"
BEGIN SELECT RAISE(ABORT, 'Folder group is immutable'); END;
CREATE TRIGGER "LibraryTask_scope" BEFORE UPDATE OF "workspaceId" ON "Task"
WHEN NEW."workspaceId"!=OLD."workspaceId" AND EXISTS(SELECT 1 FROM "LibraryAssignment" WHERE "taskId"=OLD."id")
BEGIN SELECT RAISE(ABORT, 'Classified task cannot cross workspace'); END;
CREATE TRIGGER "LibraryCommand_insert" BEFORE INSERT ON "LibraryCommand"
WHEN NOT json_valid(NEW."receipt") OR length(CAST(NEW."receipt" AS BLOB))>32768 OR length(NEW."payloadHash")!=64
 OR (NEW."taskId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Task" WHERE "id"=NEW."taskId" AND "workspaceId"=NEW."workspaceId"))
BEGIN SELECT RAISE(ABORT, 'Invalid library receipt'); END;
CREATE TRIGGER "LibraryCommand_immutable" BEFORE UPDATE ON "LibraryCommand"
BEGIN SELECT RAISE(ABORT, 'Library receipts are immutable'); END;
CREATE TRIGGER "LibraryCommand_delete" BEFORE DELETE ON "LibraryCommand"
WHEN EXISTS(SELECT 1 FROM "LibraryState" WHERE "workspaceId"=OLD."workspaceId")
 AND EXISTS(SELECT 1 FROM "Workspace" WHERE "id"=OLD."workspaceId")
BEGIN SELECT RAISE(ABORT, 'Library receipts are retained with the library'); END;

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

-- Chat loop: reply refs, the delegation revision a decision asks about, user feedback, and destination snapshots.
ALTER TABLE "Delegation" ADD COLUMN "replyRef" TEXT;
ALTER TABLE "AttentionItem" ADD COLUMN "replyRef" TEXT;
ALTER TABLE "AttentionItem" ADD COLUMN "delegationRevision" INTEGER;
ALTER TABLE "AttentionItem" ADD COLUMN "userNote" TEXT;
ALTER TABLE "StewardNotification" ADD COLUMN "recipient" TEXT;
CREATE UNIQUE INDEX "Delegation_workspaceId_replyRef_key" ON "Delegation"("workspaceId", "replyRef");
CREATE UNIQUE INDEX "AttentionItem_workspaceId_replyRef_key" ON "AttentionItem"("workspaceId", "replyRef");

-- Agent work protocol: one requested piece of work, its bounded authorization and its runs.
CREATE TABLE "StewardWork" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "affairId" TEXT NOT NULL,
    "delegationId" TEXT NOT NULL,
    "request" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "question" JSONB,
    "authorization" JSONB,
    "inputs" JSONB NOT NULL DEFAULT '[]',
    "progress" JSONB NOT NULL DEFAULT '[]',
    "handling" JSONB,
    "resultTaskId" TEXT,
    "resultVersionId" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "wakeReason" TEXT NOT NULL DEFAULT 'new_request',
    "nextRunAt" DATETIME,
    "leaseUntil" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StewardWork_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StewardWork_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StewardWork_delegationId_fkey" FOREIGN KEY ("delegationId") REFERENCES "Delegation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "StewardWorkAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "wakeReason" TEXT NOT NULL,
    "workRevision" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "toolCalls" JSONB NOT NULL DEFAULT '[]',
    "webCalls" INTEGER NOT NULL DEFAULT 0,
    "observedSources" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    CONSTRAINT "StewardWorkAttempt_workId_fkey" FOREIGN KEY ("workId") REFERENCES "StewardWork" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StewardWork_delegationId_key" ON "StewardWork"("delegationId");
CREATE INDEX "StewardWork_workspaceId_status_nextRunAt_idx" ON "StewardWork"("workspaceId", "status", "nextRunAt");
CREATE INDEX "StewardWork_affairId_idx" ON "StewardWork"("affairId");
CREATE UNIQUE INDEX "StewardWorkAttempt_tokenHash_key" ON "StewardWorkAttempt"("tokenHash");
CREATE INDEX "StewardWorkAttempt_workspaceId_status_deadlineAt_idx" ON "StewardWorkAttempt"("workspaceId", "status", "deadlineAt");
CREATE UNIQUE INDEX "StewardWorkAttempt_workId_number_key" ON "StewardWorkAttempt"("workId", "number");
CREATE TRIGGER "StewardWork_workspace_immutable" BEFORE UPDATE OF "workspaceId" ON "StewardWork"
WHEN NEW."workspaceId" <> OLD."workspaceId"
BEGIN SELECT RAISE(ABORT, 'Steward workspace is immutable'); END;
CREATE TRIGGER "StewardWork_scope_insert" BEFORE INSERT ON "StewardWork"
WHEN NOT EXISTS (SELECT 1 FROM "Affair" WHERE "id" = NEW."affairId" AND "workspaceId" = NEW."workspaceId") OR NOT EXISTS (SELECT 1 FROM "Delegation" WHERE "id" = NEW."delegationId" AND "workspaceId" = NEW."workspaceId")
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "StewardWork_scope_update" BEFORE UPDATE ON "StewardWork"
WHEN NOT EXISTS (SELECT 1 FROM "Affair" WHERE "id" = NEW."affairId" AND "workspaceId" = NEW."workspaceId") OR NOT EXISTS (SELECT 1 FROM "Delegation" WHERE "id" = NEW."delegationId" AND "workspaceId" = NEW."workspaceId")
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "StewardWorkAttempt_scope_insert" BEFORE INSERT ON "StewardWorkAttempt"
WHEN NOT EXISTS (SELECT 1 FROM "StewardWork" WHERE "id" = NEW."workId" AND "workspaceId" = NEW."workspaceId")
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "StewardWorkAttempt_scope_update" BEFORE UPDATE ON "StewardWorkAttempt"
WHEN NEW."workspaceId" <> OLD."workspaceId" OR NEW."workId" <> OLD."workId"
BEGIN SELECT RAISE(ABORT, 'Steward workspace is immutable'); END;
