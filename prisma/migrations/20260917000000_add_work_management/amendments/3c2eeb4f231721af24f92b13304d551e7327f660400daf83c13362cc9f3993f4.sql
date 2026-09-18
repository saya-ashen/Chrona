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
