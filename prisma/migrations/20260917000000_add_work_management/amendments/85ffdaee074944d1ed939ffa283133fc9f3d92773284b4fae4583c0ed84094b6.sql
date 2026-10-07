
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
