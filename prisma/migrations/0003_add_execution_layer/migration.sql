-- CreateTable
CREATE TABLE "WorkBlock" (
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
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ExecutionSession" (
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
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "WorkBlock_workspaceId_status_idx" ON "WorkBlock"("workspaceId", "status");
CREATE INDEX "WorkBlock_taskId_status_idx" ON "WorkBlock"("taskId", "status");
CREATE INDEX "WorkBlock_workspaceId_scheduledStartAt_idx" ON "WorkBlock"("workspaceId", "scheduledStartAt");
CREATE INDEX "ExecutionSession_workspaceId_status_idx" ON "ExecutionSession"("workspaceId", "status");
CREATE INDEX "ExecutionSession_taskId_status_idx" ON "ExecutionSession"("taskId", "status");
CREATE INDEX "ExecutionSession_workBlockId_idx" ON "ExecutionSession"("workBlockId");
