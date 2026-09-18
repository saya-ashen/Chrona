-- Known post-v0.3.1 development history has the pre-B1 schema.
-- Verify its exact source/history, apply subsequent additions, then normalize history.

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

-- B2b controlled files; checked parent-table rebuild.
DROP TRIGGER "ResultVersionArtifact_delete";
DROP TRIGGER "ResultVersionArtifact_immutable";
DROP TRIGGER "ResultVersionArtifact_insert";
-- CreateTable
CREATE TABLE "ResultArtifactBytes" (
    "artifactId" TEXT NOT NULL PRIMARY KEY,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    CONSTRAINT "ResultArtifactBytes_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResultFileUpload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "occurrenceId" TEXT,
    "resultId" TEXT NOT NULL,
    "actorKey" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "receivedBytes" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "finalArtifactId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "ResultFileUpload_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "TaskResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResultFileChunk" (
    "uploadId" TEXT NOT NULL,
    "offset" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BLOB NOT NULL,

    PRIMARY KEY ("uploadId", "offset"),
    CONSTRAINT "ResultFileChunk_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "ResultFileUpload" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables


CREATE TABLE "new_Artifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "runId" TEXT,
    "ownerKind" TEXT NOT NULL DEFAULT 'run',
    "resultId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "contentPreview" TEXT,
    "metadata" JSONB,
    "occurrenceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Artifact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Artifact_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Artifact_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "TaskResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Artifact_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "TaskOccurrence" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Artifact" ("contentPreview", "createdAt", "id", "metadata", "occurrenceId", "runId", "taskId", "title", "type", "uri", "workspaceId") SELECT "contentPreview", "createdAt", "id", "metadata", "occurrenceId", "runId", "taskId", "title", "type", "uri", "workspaceId" FROM "Artifact";
DROP TABLE "Artifact";
ALTER TABLE "new_Artifact" RENAME TO "Artifact";
CREATE INDEX "Artifact_workspaceId_type_idx" ON "Artifact"("workspaceId", "type");
CREATE INDEX "Artifact_taskId_createdAt_idx" ON "Artifact"("taskId", "createdAt");
CREATE INDEX "Artifact_occurrenceId_createdAt_idx" ON "Artifact"("occurrenceId", "createdAt");
CREATE INDEX "Artifact_runId_createdAt_idx" ON "Artifact"("runId", "createdAt");
CREATE TABLE "new_ResultVersionArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "artifactRef" TEXT NOT NULL,
    "artifactFingerprint" TEXT NOT NULL,
    CONSTRAINT "ResultVersionArtifact_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "TaskResultVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResultVersionArtifact_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);
INSERT INTO "new_ResultVersionArtifact" ("artifactFingerprint", "artifactId", "artifactRef", "id", "key", "required", "role", "versionId") SELECT "artifactFingerprint", "artifactId", "artifactRef", "id", "key", "required", "role", "versionId" FROM "ResultVersionArtifact";
DROP TABLE "ResultVersionArtifact";
ALTER TABLE "new_ResultVersionArtifact" RENAME TO "ResultVersionArtifact";
CREATE INDEX "ResultVersionArtifact_artifactId_idx" ON "ResultVersionArtifact"("artifactId");
CREATE UNIQUE INDEX "ResultVersionArtifact_versionId_role_key_key" ON "ResultVersionArtifact"("versionId", "role", "key");


-- CreateIndex
CREATE UNIQUE INDEX "ResultFileUpload_finalArtifactId_key" ON "ResultFileUpload"("finalArtifactId");

-- CreateIndex
CREATE INDEX "ResultFileUpload_workspaceId_status_expiresAt_idx" ON "ResultFileUpload"("workspaceId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResultFileUpload_workspaceId_actorKey_requestId_key" ON "ResultFileUpload"("workspaceId", "actorKey", "requestId");


CREATE TRIGGER "ResultVersionArtifact_delete" BEFORE DELETE ON "ResultVersionArtifact"
WHEN EXISTS (SELECT 1 FROM "TaskResultVersion" v JOIN "TaskResult" r ON r."id" = v."resultId" WHERE v."id" = OLD."versionId")
BEGIN SELECT RAISE(ABORT, 'Delete the owning result, not a version artifact binding'); END;
CREATE TRIGGER "ResultVersionArtifact_immutable" BEFORE UPDATE ON "ResultVersionArtifact"
BEGIN SELECT RAISE(ABORT, 'Result artifact bindings are immutable'); END;
CREATE TRIGGER "ResultVersionArtifact_insert" BEFORE INSERT ON "ResultVersionArtifact"
WHEN NEW."role" NOT IN ('deliverable', 'evidence') OR length(NEW."artifactFingerprint") != 64 OR NOT EXISTS (
 SELECT 1 FROM "TaskResultVersion" v JOIN "TaskResult" r ON r."id" = v."resultId"
 JOIN "Artifact" a ON a."id" = NEW."artifactId" LEFT JOIN "Run" run ON run."id" = a."runId"
 WHERE v."id" = NEW."versionId" AND v."parentVersionId" IS r."headVersionId" AND v."id" IS NOT r."headVersionId"
 AND a."workspaceId" = r."workspaceId" AND a."taskId" = r."taskId" AND a."occurrenceId" IS r."occurrenceId"
 AND ((a."ownerKind" = 'result' AND a."resultId" = r."id") OR (a."ownerKind" = 'run'
 AND run."taskId" = r."taskId" AND run."occurrenceId" IS r."occurrenceId"
 AND (r."occurrenceId" IS NOT NULL OR run."workBlockId" IS NULL))))
BEGIN SELECT RAISE(ABORT, 'Invalid or sealed result artifact binding'); END;
-- B2b: result-owned artifacts and private transactional binary storage.
CREATE TRIGGER "Artifact_owner_insert" BEFORE INSERT ON "Artifact"
WHEN NOT ((NEW."ownerKind" = 'run' AND NEW."runId" IS NOT NULL AND NEW."resultId" IS NULL)
 OR (NEW."ownerKind" = 'result' AND NEW."runId" IS NULL AND NEW."type" = 'file' AND NEW."uri" = 'result-file://' || NEW."id" AND EXISTS (
 SELECT 1 FROM "TaskResult" r WHERE r."id" = NEW."resultId" AND r."workspaceId" = NEW."workspaceId" AND r."taskId" = NEW."taskId" AND r."occurrenceId" IS NEW."occurrenceId")))
BEGIN SELECT RAISE(ABORT, 'Invalid artifact ownership'); END;
CREATE TRIGGER "Artifact_owner_update" BEFORE UPDATE ON "Artifact"
WHEN NEW."ownerKind" IS NOT OLD."ownerKind" OR NEW."resultId" IS NOT OLD."resultId" OR OLD."ownerKind" = 'result'
 OR (NEW."ownerKind" = 'run' AND NEW."runId" IS NULL)
BEGIN SELECT RAISE(ABORT, 'Result artifact identity and content are immutable'); END;
CREATE TRIGGER "Artifact_result_delete" BEFORE DELETE ON "Artifact"
WHEN OLD."ownerKind" = 'result' AND EXISTS (SELECT 1 FROM "TaskResult" WHERE "id" = OLD."resultId")
BEGIN SELECT RAISE(ABORT, 'Delete the owning result, not finalized artifacts'); END;
CREATE TRIGGER "ResultArtifactBytes_insert" BEFORE INSERT ON "ResultArtifactBytes"
WHEN NEW."sizeBytes" NOT BETWEEN 0 AND 8388608 OR length(NEW."data") != NEW."sizeBytes" OR typeof(NEW."data") != 'blob'
 OR length(NEW."sha256") != 64 OR length(NEW."filename") NOT BETWEEN 1 AND 200 OR length(NEW."mimeType") NOT BETWEEN 1 AND 100
 OR NOT EXISTS (SELECT 1 FROM "Artifact" WHERE "id" = NEW."artifactId" AND "ownerKind" = 'result')
BEGIN SELECT RAISE(ABORT, 'Invalid result artifact bytes'); END;
CREATE TRIGGER "ResultArtifactBytes_immutable" BEFORE UPDATE ON "ResultArtifactBytes"
BEGIN SELECT RAISE(ABORT, 'Finalized result bytes are immutable'); END;
CREATE TRIGGER "ResultArtifactBytes_delete" BEFORE DELETE ON "ResultArtifactBytes"
WHEN EXISTS (SELECT 1 FROM "Artifact" WHERE "id" = OLD."artifactId")
BEGIN SELECT RAISE(ABORT, 'Delete the owning artifact, not its bytes'); END;
CREATE TRIGGER "ResultFileUpload_insert" BEFORE INSERT ON "ResultFileUpload"
WHEN NEW."status" != 'open' OR NEW."receivedBytes" != 0 OR NEW."finalArtifactId" IS NOT NULL
 OR NEW."sizeBytes" NOT BETWEEN 0 AND 8388608 OR length(NEW."sha256") != 64 OR length(NEW."payloadHash") != 64
 OR NOT EXISTS (SELECT 1 FROM "TaskResult" r WHERE r."id" = NEW."resultId" AND r."workspaceId" = NEW."workspaceId" AND r."taskId" = NEW."taskId" AND r."occurrenceId" IS NEW."occurrenceId")
BEGIN SELECT RAISE(ABORT, 'Invalid result upload'); END;
CREATE TRIGGER "ResultFileUpload_update" BEFORE UPDATE ON "ResultFileUpload"
WHEN OLD."status" != 'open' OR NEW."status" NOT IN ('open','completed','cancelled','expired')
 OR NEW."id" IS NOT OLD."id" OR NEW."workspaceId" IS NOT OLD."workspaceId" OR NEW."taskId" IS NOT OLD."taskId"
 OR NEW."occurrenceId" IS NOT OLD."occurrenceId" OR NEW."resultId" IS NOT OLD."resultId" OR NEW."actorKey" IS NOT OLD."actorKey"
 OR NEW."requestId" IS NOT OLD."requestId" OR NEW."payloadHash" IS NOT OLD."payloadHash" OR NEW."filename" IS NOT OLD."filename"
 OR NEW."mimeType" IS NOT OLD."mimeType" OR NEW."sizeBytes" IS NOT OLD."sizeBytes" OR NEW."sha256" IS NOT OLD."sha256"
 OR NEW."createdAt" IS NOT OLD."createdAt" OR NEW."expiresAt" IS NOT OLD."expiresAt"
 OR NEW."receivedBytes" < OLD."receivedBytes" OR NEW."receivedBytes" > NEW."sizeBytes"
 OR (NEW."status" != 'completed' AND NEW."finalArtifactId" IS NOT NULL)
 OR (NEW."status" = 'completed' AND (NEW."receivedBytes" != NEW."sizeBytes" OR NOT EXISTS (
 SELECT 1 FROM "Artifact" a JOIN "ResultArtifactBytes" b ON b."artifactId" = a."id"
 WHERE a."id" = NEW."finalArtifactId" AND a."resultId" = NEW."resultId" AND b."sizeBytes" = NEW."sizeBytes" AND b."sha256" = NEW."sha256")))
BEGIN SELECT RAISE(ABORT, 'Invalid result upload transition'); END;
CREATE TRIGGER "ResultFileUpload_delete" BEFORE DELETE ON "ResultFileUpload"
WHEN EXISTS (SELECT 1 FROM "TaskResult" WHERE "id" = OLD."resultId")
BEGIN SELECT RAISE(ABORT, 'Upload receipts belong to their result'); END;
CREATE TRIGGER "ResultFileChunk_insert" BEFORE INSERT ON "ResultFileChunk"
WHEN NEW."sizeBytes" NOT BETWEEN 1 AND 32768 OR length(NEW."data") != NEW."sizeBytes" OR typeof(NEW."data") != 'blob' OR length(NEW."sha256") != 64
 OR NOT EXISTS (SELECT 1 FROM "ResultFileUpload" u WHERE u."id" = NEW."uploadId" AND u."status" = 'open'
 AND u."receivedBytes" = NEW."offset" AND NEW."offset" % 32768 = 0
 AND NEW."sizeBytes" = MIN(32768, u."sizeBytes" - NEW."offset"))
BEGIN SELECT RAISE(ABORT, 'Invalid result upload chunk'); END;
CREATE TRIGGER "ResultFileChunk_immutable" BEFORE UPDATE ON "ResultFileChunk"
BEGIN SELECT RAISE(ABORT, 'Upload chunks are immutable'); END;
CREATE TRIGGER "ResultFileChunk_delete" BEFORE DELETE ON "ResultFileChunk"
WHEN EXISTS (SELECT 1 FROM "ResultFileUpload" WHERE "id" = OLD."uploadId" AND "status" = 'open')
BEGIN SELECT RAISE(ABORT, 'Close the upload before discarding chunks'); END;

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
