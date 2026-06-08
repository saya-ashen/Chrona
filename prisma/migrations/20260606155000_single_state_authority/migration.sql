-- Single state-authority refactor.
-- 1. Scope provider runs to a work-block occurrence so a recurring task's
--    failed occurrence no longer pollutes sibling occurrences. Run gains a
--    workBlockId FK (SetNull) matching TaskPlan/TaskPlanRun/ExecutionSession;
--    SQLite requires the table-rebuild pattern to add a foreign key.
-- 2. Carry the real failure detail and blocked node into the read projection so
--    a blocked task surfaces *why* it is blocked, not a hard-coded label.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "workBlockId" TEXT,
    "taskSessionId" TEXT,
    "runtimeName" TEXT NOT NULL,
    "runtimeConfigSnapshot" JSONB,
    "runtimeConfigVersion" TEXT,
    "runtimeRunRef" TEXT,
    "runtimeSessionRef" TEXT,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "errorSummary" TEXT,
    "resumeToken" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "resumeSupported" BOOLEAN NOT NULL DEFAULT false,
    "pendingInputPrompt" TEXT,
    "pendingInputType" TEXT,
    "lastSyncedAt" DATETIME,
    "syncStatus" TEXT NOT NULL DEFAULT 'healthy',
    "mappingPartial" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Run_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Run_workBlockId_fkey" FOREIGN KEY ("workBlockId") REFERENCES "WorkBlock" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Run_taskSessionId_fkey" FOREIGN KEY ("taskSessionId") REFERENCES "TaskSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Run" ("createdAt", "endedAt", "errorSummary", "id", "lastSyncedAt", "mappingPartial", "pendingInputPrompt", "pendingInputType", "resumeSupported", "resumeToken", "retryable", "runtimeConfigSnapshot", "runtimeConfigVersion", "runtimeName", "runtimeRunRef", "runtimeSessionRef", "startedAt", "status", "syncStatus", "taskId", "taskSessionId", "triggeredBy", "updatedAt") SELECT "createdAt", "endedAt", "errorSummary", "id", "lastSyncedAt", "mappingPartial", "pendingInputPrompt", "pendingInputType", "resumeSupported", "resumeToken", "retryable", "runtimeConfigSnapshot", "runtimeConfigVersion", "runtimeName", "runtimeRunRef", "runtimeSessionRef", "startedAt", "status", "syncStatus", "taskId", "taskSessionId", "triggeredBy", "updatedAt" FROM "Run";
DROP TABLE "Run";
ALTER TABLE "new_Run" RENAME TO "Run";
CREATE UNIQUE INDEX "Run_runtimeRunRef_key" ON "Run"("runtimeRunRef");
CREATE INDEX "Run_taskId_status_idx" ON "Run"("taskId", "status");
CREATE INDEX "Run_taskId_workBlockId_status_idx" ON "Run"("taskId", "workBlockId", "status");
CREATE INDEX "Run_taskSessionId_status_idx" ON "Run"("taskSessionId", "status");
CREATE INDEX "Run_runtimeName_status_idx" ON "Run"("runtimeName", "status");

PRAGMA foreign_keys=ON;

ALTER TABLE "TaskProjection" ADD COLUMN "blockDetail" TEXT;
ALTER TABLE "TaskProjection" ADD COLUMN "blockNodeId" TEXT;
