PRAGMA foreign_keys=OFF;

-- Remove records that were possible while SQLite foreign keys were disabled or absent.
DELETE FROM "ExecutionSession"
WHERE "taskId" NOT IN (SELECT "id" FROM "Task");

DELETE FROM "WorkBlock"
WHERE "taskId" NOT IN (SELECT "id" FROM "Task");

DELETE FROM "RuntimeCursor"
WHERE "runId" IN (SELECT "id" FROM "Run" WHERE "taskId" NOT IN (SELECT "id" FROM "Task"));

DELETE FROM "ToolCallDetail"
WHERE "runId" IN (SELECT "id" FROM "Run" WHERE "taskId" NOT IN (SELECT "id" FROM "Task"));

DELETE FROM "ConversationEntry"
WHERE "runId" IN (SELECT "id" FROM "Run" WHERE "taskId" NOT IN (SELECT "id" FROM "Task"));

DELETE FROM "Approval"
WHERE "runId" IN (SELECT "id" FROM "Run" WHERE "taskId" NOT IN (SELECT "id" FROM "Task"));

DELETE FROM "Artifact"
WHERE "runId" IN (SELECT "id" FROM "Run" WHERE "taskId" NOT IN (SELECT "id" FROM "Task"));

UPDATE "Event"
SET "runId" = NULL
WHERE "runId" IN (SELECT "id" FROM "Run" WHERE "taskId" NOT IN (SELECT "id" FROM "Task"));

DELETE FROM "Run"
WHERE "taskId" NOT IN (SELECT "id" FROM "Task");

UPDATE "ExecutionSession"
SET "workBlockId" = NULL
WHERE "workBlockId" IS NOT NULL AND "workBlockId" NOT IN (SELECT "id" FROM "WorkBlock");

-- Rebuild execution-layer tables created before their Prisma relations were enforced.
CREATE TABLE "new_WorkBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "planId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Scheduled',
    "scheduledStartAt" DATETIME NOT NULL,
    "scheduledEndAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "trigger" TEXT NOT NULL DEFAULT 'scheduled',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkBlock_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkBlock_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_WorkBlock" (
    "id", "workspaceId", "taskId", "planId", "title", "status", "scheduledStartAt", "scheduledEndAt",
    "startedAt", "completedAt", "trigger", "createdAt", "updatedAt"
)
SELECT
    "id", "workspaceId", "taskId", "planId", "title", "status", "scheduledStartAt", "scheduledEndAt",
    "startedAt", "completedAt", "trigger", "createdAt", "updatedAt"
FROM "WorkBlock";

DROP TABLE "WorkBlock";
ALTER TABLE "new_WorkBlock" RENAME TO "WorkBlock";
CREATE INDEX "WorkBlock_workspaceId_status_idx" ON "WorkBlock"("workspaceId", "status");
CREATE INDEX "WorkBlock_taskId_status_idx" ON "WorkBlock"("taskId", "status");
CREATE INDEX "WorkBlock_workspaceId_scheduledStartAt_idx" ON "WorkBlock"("workspaceId", "scheduledStartAt");

CREATE TABLE "new_ExecutionSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workBlockId" TEXT,
    "planId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "currentNodeId" TEXT,
    "pauseReason" TEXT,
    "completedNodeIds" TEXT NOT NULL DEFAULT '[]',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pausedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExecutionSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExecutionSession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExecutionSession_workBlockId_fkey" FOREIGN KEY ("workBlockId") REFERENCES "WorkBlock" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_ExecutionSession" (
    "id", "workspaceId", "taskId", "workBlockId", "planId", "status", "currentNodeId", "pauseReason",
    "completedNodeIds", "startedAt", "pausedAt", "completedAt", "createdAt", "updatedAt"
)
SELECT
    "id", "workspaceId", "taskId", "workBlockId", "planId", "status", "currentNodeId", "pauseReason",
    "completedNodeIds", "startedAt", "pausedAt", "completedAt", "createdAt", "updatedAt"
FROM "ExecutionSession";

DROP TABLE "ExecutionSession";
ALTER TABLE "new_ExecutionSession" RENAME TO "ExecutionSession";
CREATE INDEX "ExecutionSession_workspaceId_status_idx" ON "ExecutionSession"("workspaceId", "status");
CREATE INDEX "ExecutionSession_taskId_status_idx" ON "ExecutionSession"("taskId", "status");
CREATE INDEX "ExecutionSession_workBlockId_idx" ON "ExecutionSession"("workBlockId");

PRAGMA foreign_keys=ON;
