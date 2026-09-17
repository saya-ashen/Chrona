-- Phase 2A amendment for databases already on the management-MCP release-line checksum.
-- Existing records intentionally retain the AI default; no task is inferred as manual.
ALTER TABLE "Task" ADD COLUMN "taskExecutionMode" TEXT NOT NULL DEFAULT 'ai';

-- Goal editing: persistent CAS across MCP, UI and all canonical writers.
ALTER TABLE "Goal" ADD COLUMN "configRevision" INTEGER NOT NULL DEFAULT 1;
CREATE TRIGGER "Goal_config_update" AFTER UPDATE OF
  "title", "description", "operationalBrief", "successCriteria", "status",
  "nextReviewAt", "achievementConfirmation", "workspaceId" ON "Goal"
WHEN OLD."title" IS NOT NEW."title" OR OLD."description" IS NOT NEW."description"
  OR OLD."operationalBrief" IS NOT NEW."operationalBrief" OR OLD."successCriteria" IS NOT NEW."successCriteria"
  OR OLD."status" IS NOT NEW."status" OR OLD."nextReviewAt" IS NOT NEW."nextReviewAt"
  OR OLD."achievementConfirmation" IS NOT NEW."achievementConfirmation" OR OLD."workspaceId" IS NOT NEW."workspaceId"
BEGIN UPDATE "Goal" SET "configRevision" = OLD."configRevision" + 1 WHERE "id" = NEW."id"; END;

-- Work-owned result foundation (B1).
-- CreateTable
CREATE TABLE "TaskResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "occurrenceId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "headVersionId" TEXT,
    "acceptedVersionId" TEXT,
    "editRevision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskResult_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskResult_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskResult_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "TaskOccurrence" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "TaskResult_headVersionId_id_fkey" FOREIGN KEY ("headVersionId", "id") REFERENCES "TaskResultVersion" ("id", "resultId") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "TaskResult_acceptedVersionId_id_fkey" FOREIGN KEY ("acceptedVersionId", "id") REFERENCES "TaskResultVersion" ("id", "resultId") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "TaskResultVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resultId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "parentVersionId" TEXT,
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "actorKey" TEXT NOT NULL,
    "sourceLabel" TEXT,
    "sourceWorkId" TEXT,
    "sourceReportedAt" DATETIME,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskResultVersion_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "TaskResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskResultVersion_parentVersionId_resultId_fkey" FOREIGN KEY ("parentVersionId", "resultId") REFERENCES "TaskResultVersion" ("id", "resultId") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "ResultCommand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "actorKey" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "receipt" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResultCommand_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "TaskResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResultCommand_versionId_resultId_fkey" FOREIGN KEY ("versionId", "resultId") REFERENCES "TaskResultVersion" ("id", "resultId") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "TaskResultReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resultId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "feedback" TEXT,
    "actorKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskResultReview_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "TaskResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskResultReview_versionId_resultId_fkey" FOREIGN KEY ("versionId", "resultId") REFERENCES "TaskResultVersion" ("id", "resultId") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "TaskResultReview_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "ResultCommand" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResultVersionArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "artifactRef" TEXT NOT NULL,
    "artifactFingerprint" TEXT NOT NULL,
    CONSTRAINT "ResultVersionArtifact_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "TaskResultVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResultVersionArtifact_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TaskResult_workspaceId_updatedAt_idx" ON "TaskResult"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "TaskResult_occurrenceId_idx" ON "TaskResult"("occurrenceId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskResult_taskId_scopeKey_key" ON "TaskResult"("taskId", "scopeKey");

-- CreateIndex
CREATE UNIQUE INDEX "TaskResultVersion_resultId_version_key" ON "TaskResultVersion"("resultId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TaskResultVersion_id_resultId_key" ON "TaskResultVersion"("id", "resultId");

-- CreateIndex
CREATE INDEX "ResultCommand_resultId_createdAt_idx" ON "ResultCommand"("resultId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResultCommand_workspaceId_actorKey_operation_requestId_key" ON "ResultCommand"("workspaceId", "actorKey", "operation", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskResultReview_commandId_key" ON "TaskResultReview"("commandId");

-- CreateIndex
CREATE INDEX "TaskResultReview_versionId_revision_idx" ON "TaskResultReview"("versionId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "TaskResultReview_resultId_revision_key" ON "TaskResultReview"("resultId", "revision");

-- CreateIndex
CREATE INDEX "ResultVersionArtifact_artifactId_idx" ON "ResultVersionArtifact"("artifactId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultVersionArtifact_versionId_role_key_key" ON "ResultVersionArtifact"("versionId", "role", "key");


-- B1: database-enforced result identity, append-only versions and receipt history.
CREATE TRIGGER "TaskResult_scope_insert" BEFORE INSERT ON "TaskResult"
WHEN NEW."scopeKey" != CASE WHEN NEW."occurrenceId" IS NULL THEN 'task' ELSE 'occurrence:' || NEW."occurrenceId" END
 OR NEW."editRevision" != 0 OR NEW."headVersionId" IS NOT NULL OR NEW."acceptedVersionId" IS NOT NULL
 OR NOT EXISTS (SELECT 1 FROM "Task" WHERE "id" = NEW."taskId" AND "workspaceId" = NEW."workspaceId")
 OR (NEW."occurrenceId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "TaskOccurrence" WHERE "id" = NEW."occurrenceId" AND "taskId" = NEW."taskId" AND "workspaceId" = NEW."workspaceId"))
BEGIN SELECT RAISE(ABORT, 'Invalid result scope'); END;

CREATE TRIGGER "TaskResult_scope_update" BEFORE UPDATE ON "TaskResult"
WHEN NEW."id" IS NOT OLD."id" OR NEW."workspaceId" IS NOT OLD."workspaceId" OR NEW."taskId" IS NOT OLD."taskId"
 OR NEW."occurrenceId" IS NOT OLD."occurrenceId" OR NEW."scopeKey" IS NOT OLD."scopeKey" OR NEW."createdAt" IS NOT OLD."createdAt"
 OR NEW."editRevision" != OLD."editRevision" + 1
BEGIN SELECT RAISE(ABORT, 'Result identity is immutable and revision must advance'); END;

CREATE TRIGGER "TaskResult_head_update" BEFORE UPDATE OF "headVersionId" ON "TaskResult"
WHEN NEW."headVersionId" IS NOT OLD."headVersionId" AND NOT EXISTS (
 SELECT 1 FROM "TaskResultVersion" v WHERE v."id" = NEW."headVersionId" AND v."resultId" = OLD."id"
 AND v."parentVersionId" IS OLD."headVersionId"
 AND v."version" = COALESCE((SELECT "version" FROM "TaskResultVersion" WHERE "id" = OLD."headVersionId"), 0) + 1)
BEGIN SELECT RAISE(ABORT, 'Result head must advance one version'); END;

CREATE TRIGGER "TaskResult_accept_update" BEFORE UPDATE OF "acceptedVersionId" ON "TaskResult"
WHEN NEW."acceptedVersionId" IS NOT OLD."acceptedVersionId" AND
 (NEW."acceptedVersionId" IS NULL OR NEW."acceptedVersionId" IS NOT NEW."headVersionId" OR NOT EXISTS (
 SELECT 1 FROM "TaskResultReview" WHERE "resultId" = OLD."id" AND "versionId" = NEW."acceptedVersionId" AND "decision" = 'accept'))
BEGIN SELECT RAISE(ABORT, 'Acceptance requires a review of the head version'); END;

CREATE TRIGGER "TaskResultVersion_insert" BEFORE INSERT ON "TaskResultVersion"
WHEN NEW."sourceKind" NOT IN ('human', 'external', 'managed') OR NEW."version" < 1 OR length(NEW."actorKey") NOT BETWEEN 1 AND 200
 OR length(NEW."contentHash") != 64 OR NOT json_valid(NEW."content") OR length(CAST(NEW."content" AS BLOB)) > 98304
 OR NOT EXISTS (SELECT 1 FROM "TaskResult" r WHERE r."id" = NEW."resultId" AND NEW."parentVersionId" IS r."headVersionId"
 AND NEW."version" = COALESCE((SELECT "version" FROM "TaskResultVersion" WHERE "id" = r."headVersionId"), 0) + 1)
BEGIN SELECT RAISE(ABORT, 'Invalid result version'); END;
CREATE TRIGGER "TaskResultVersion_immutable" BEFORE UPDATE ON "TaskResultVersion"
BEGIN SELECT RAISE(ABORT, 'Published result versions are immutable'); END;
CREATE TRIGGER "TaskResultVersion_delete" BEFORE DELETE ON "TaskResultVersion"
WHEN EXISTS (SELECT 1 FROM "TaskResult" WHERE "id" = OLD."resultId")
BEGIN SELECT RAISE(ABORT, 'Delete the owning result, not a published version'); END;

CREATE TRIGGER "ResultCommand_insert" BEFORE INSERT ON "ResultCommand"
WHEN NEW."operation" NOT IN ('publish', 'review') OR NOT json_valid(NEW."receipt") OR length(CAST(NEW."receipt" AS BLOB)) > 4096
 OR NOT EXISTS (SELECT 1 FROM "TaskResult" WHERE "id" = NEW."resultId" AND "workspaceId" = NEW."workspaceId")
BEGIN SELECT RAISE(ABORT, 'Invalid result command'); END;
CREATE TRIGGER "ResultCommand_immutable" BEFORE UPDATE ON "ResultCommand"
BEGIN SELECT RAISE(ABORT, 'Result receipts are immutable'); END;
CREATE TRIGGER "ResultCommand_delete" BEFORE DELETE ON "ResultCommand"
WHEN EXISTS (SELECT 1 FROM "TaskResult" WHERE "id" = OLD."resultId")
BEGIN SELECT RAISE(ABORT, 'Delete the owning result, not its command receipt'); END;

CREATE TRIGGER "TaskResultReview_insert" BEFORE INSERT ON "TaskResultReview"
WHEN NEW."decision" NOT IN ('accept', 'request_changes', 'reject') OR length(NEW."feedback") > 8000
 OR NOT EXISTS (SELECT 1 FROM "TaskResult" WHERE "id" = NEW."resultId" AND "headVersionId" = NEW."versionId" AND NEW."revision" = "editRevision" + 1)
 OR NOT EXISTS (SELECT 1 FROM "ResultCommand" WHERE "id" = NEW."commandId" AND "resultId" = NEW."resultId"
 AND "versionId" = NEW."versionId" AND "actorKey" = NEW."actorKey" AND "operation" = 'review')
BEGIN SELECT RAISE(ABORT, 'Invalid version review'); END;
CREATE TRIGGER "TaskResultReview_immutable" BEFORE UPDATE ON "TaskResultReview"
BEGIN SELECT RAISE(ABORT, 'Result reviews are immutable'); END;
CREATE TRIGGER "TaskResultReview_delete" BEFORE DELETE ON "TaskResultReview"
WHEN EXISTS (SELECT 1 FROM "TaskResult" WHERE "id" = OLD."resultId")
BEGIN SELECT RAISE(ABORT, 'Delete the owning result, not its review history'); END;

-- A version's links can be inserted only before that version becomes the head.
CREATE TRIGGER "ResultVersionArtifact_insert" BEFORE INSERT ON "ResultVersionArtifact"
WHEN NEW."role" NOT IN ('deliverable', 'evidence') OR length(NEW."artifactFingerprint") != 64 OR NOT EXISTS (
 SELECT 1 FROM "TaskResultVersion" v JOIN "TaskResult" r ON r."id" = v."resultId"
 JOIN "Artifact" a ON a."id" = NEW."artifactId" JOIN "Run" run ON run."id" = a."runId"
 WHERE v."id" = NEW."versionId" AND v."parentVersionId" IS r."headVersionId" AND v."id" IS NOT r."headVersionId"
 AND a."workspaceId" = r."workspaceId" AND a."taskId" = r."taskId" AND a."occurrenceId" IS r."occurrenceId"
 AND run."taskId" = r."taskId" AND run."occurrenceId" IS r."occurrenceId"
 AND (r."occurrenceId" IS NOT NULL OR run."workBlockId" IS NULL))
BEGIN SELECT RAISE(ABORT, 'Invalid or sealed result artifact binding'); END;
CREATE TRIGGER "ResultVersionArtifact_immutable" BEFORE UPDATE ON "ResultVersionArtifact"
BEGIN SELECT RAISE(ABORT, 'Result artifact bindings are immutable'); END;
CREATE TRIGGER "ResultVersionArtifact_delete" BEFORE DELETE ON "ResultVersionArtifact"
WHEN EXISTS (SELECT 1 FROM "TaskResultVersion" v JOIN "TaskResult" r ON r."id" = v."resultId" WHERE v."id" = OLD."versionId")
BEGIN SELECT RAISE(ABORT, 'Delete the owning result, not a version artifact binding'); END;

CREATE TRIGGER "Task_result_scope_guard" BEFORE UPDATE OF "workspaceId" ON "Task"
WHEN NEW."workspaceId" IS NOT OLD."workspaceId" AND EXISTS (SELECT 1 FROM "TaskResult" WHERE "taskId" = OLD."id")
BEGIN SELECT RAISE(ABORT, 'Cannot move a task with scoped results'); END;
CREATE TRIGGER "TaskOccurrence_result_scope_guard" BEFORE UPDATE OF "workspaceId", "taskId" ON "TaskOccurrence"
WHEN (NEW."workspaceId" IS NOT OLD."workspaceId" OR NEW."taskId" IS NOT OLD."taskId") AND EXISTS (SELECT 1 FROM "TaskResult" WHERE "occurrenceId" = OLD."id")
BEGIN SELECT RAISE(ABORT, 'Cannot move an occurrence with scoped results'); END;
