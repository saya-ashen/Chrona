ALTER TABLE "ImportedCalendarEvent" ADD COLUMN "taskId" TEXT;

CREATE UNIQUE INDEX "ImportedCalendarEvent_taskId_key" ON "ImportedCalendarEvent"("taskId");
CREATE INDEX "ImportedCalendarEvent_taskId_idx" ON "ImportedCalendarEvent"("taskId");
