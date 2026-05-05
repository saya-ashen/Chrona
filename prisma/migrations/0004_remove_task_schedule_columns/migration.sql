DROP INDEX IF EXISTS "Task_workspaceId_scheduleStatus_idx";

ALTER TABLE "Task" DROP COLUMN "scheduledStartAt";
ALTER TABLE "Task" DROP COLUMN "scheduledEndAt";
ALTER TABLE "Task" DROP COLUMN "scheduleStatus";
ALTER TABLE "Task" DROP COLUMN "scheduleSource";
