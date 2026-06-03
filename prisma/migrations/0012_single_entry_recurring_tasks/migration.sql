-- Single-entry recurring task model.
ALTER TABLE "Task" ADD COLUMN "recurrenceAnchorStartAt" DATETIME;
ALTER TABLE "Task" ADD COLUMN "recurrenceAnchorEndAt" DATETIME;
ALTER TABLE "Task" ADD COLUMN "recurrenceWindowUntil" DATETIME;

ALTER TABLE "WorkBlock" ADD COLUMN "recurrenceKey" TEXT;
CREATE UNIQUE INDEX "WorkBlock_taskId_recurrenceKey_key" ON "WorkBlock"("taskId", "recurrenceKey");
