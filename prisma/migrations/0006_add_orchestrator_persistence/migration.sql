-- Task orchestrator persistence
CREATE TABLE "SchedulerLease" (
  "name" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "heartbeatAt" DATETIME NOT NULL,
  "metadata" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "GraphVersion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "graph" JSONB NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GraphVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GraphVersion_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "GraphMutationRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "baseGraphVersion" INTEGER NOT NULL,
  "operation" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Pending',
  "payload" JSONB NOT NULL,
  "validationResult" JSONB,
  "affectedNodeIds" JSONB,
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt" DATETIME,
  CONSTRAINT "GraphMutationRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GraphMutationRecord_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ReconciliationEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "graphVersion" INTEGER NOT NULL,
  "executionState" TEXT NOT NULL,
  "currentNodeId" TEXT,
  "issues" JSONB,
  "repairActions" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReconciliationEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReconciliationEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SchedulerEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "graphVersion" INTEGER,
  "eventType" TEXT NOT NULL,
  "reason" TEXT,
  "payload" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchedulerEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SchedulerEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SchedulerLease_ownerId_idx" ON "SchedulerLease"("ownerId");
CREATE INDEX "SchedulerLease_expiresAt_idx" ON "SchedulerLease"("expiresAt");
CREATE UNIQUE INDEX "GraphVersion_taskId_version_key" ON "GraphVersion"("taskId", "version");
CREATE INDEX "GraphVersion_workspaceId_taskId_version_idx" ON "GraphVersion"("workspaceId", "taskId", "version");
CREATE INDEX "GraphMutationRecord_workspaceId_status_createdAt_idx" ON "GraphMutationRecord"("workspaceId", "status", "createdAt");
CREATE INDEX "GraphMutationRecord_taskId_baseGraphVersion_status_idx" ON "GraphMutationRecord"("taskId", "baseGraphVersion", "status");
CREATE INDEX "ReconciliationEvent_workspaceId_createdAt_idx" ON "ReconciliationEvent"("workspaceId", "createdAt");
CREATE INDEX "ReconciliationEvent_taskId_graphVersion_createdAt_idx" ON "ReconciliationEvent"("taskId", "graphVersion", "createdAt");
CREATE INDEX "SchedulerEvent_workspaceId_eventType_createdAt_idx" ON "SchedulerEvent"("workspaceId", "eventType", "createdAt");
CREATE INDEX "SchedulerEvent_taskId_createdAt_idx" ON "SchedulerEvent"("taskId", "createdAt");
