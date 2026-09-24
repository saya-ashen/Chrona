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
