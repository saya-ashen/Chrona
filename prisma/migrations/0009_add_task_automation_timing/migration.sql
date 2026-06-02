ALTER TABLE "Task" ADD COLUMN "autoPlanGenerationTiming" TEXT NOT NULL DEFAULT 'at_start';
ALTER TABLE "Task" ADD COLUMN "autoExecuteTiming" TEXT NOT NULL DEFAULT 'at_start';
