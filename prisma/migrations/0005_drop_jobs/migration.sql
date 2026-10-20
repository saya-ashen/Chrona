-- Job schedules have been replaced by approved modules; no legacy compatibility.
DELETE FROM "Schedule" WHERE "mode" = 'job';

-- Bun's bundled SQLite supports DROP COLUMN (3.35+); other columns, indexes and
-- foreign keys, including moduleId/triggerId, remain unchanged.
ALTER TABLE "Schedule" DROP COLUMN "command";
ALTER TABLE "Schedule" DROP COLUMN "lastOutputHash";
