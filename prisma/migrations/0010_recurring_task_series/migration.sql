-- Decouple imported calendar occurrences from a single task.
DROP INDEX IF EXISTS "ImportedCalendarEvent_taskId_key";

-- Link each occurrence to its work block.
ALTER TABLE "ImportedCalendarEvent" ADD COLUMN "workBlockId" TEXT;
CREATE UNIQUE INDEX "ImportedCalendarEvent_workBlockId_key" ON "ImportedCalendarEvent"("workBlockId");

-- Carry the source RRULE onto each occurrence so the series task can read it.
ALTER TABLE "ImportedCalendarEvent" ADD COLUMN "recurrenceRule" TEXT;

-- Recurring series metadata on Task.
ALTER TABLE "Task" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'single';
ALTER TABLE "Task" ADD COLUMN "recurrenceRule" TEXT;
ALTER TABLE "Task" ADD COLUMN "seriesExternalUid" TEXT;
CREATE INDEX "Task_workspaceId_seriesExternalUid_idx" ON "Task"("workspaceId", "seriesExternalUid");
