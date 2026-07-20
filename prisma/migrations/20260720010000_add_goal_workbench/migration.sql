-- Goal Workbench stores explicit, user-visible cross-Task context while all
-- provider execution remains owned by bounded Tasks.
ALTER TABLE "Goal" ADD COLUMN "operationalBrief" JSONB;
ALTER TABLE "Task" ADD COLUMN "goalContext" JSONB;

CREATE TABLE "GoalWorkingSetItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoalWorkingSetItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalWorkingSetItem_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "GoalBriefRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "brief" JSONB NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoalBriefRevision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalBriefRevision_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "GoalWorkingSetItem_goalId_subjectType_subjectId_key" ON "GoalWorkingSetItem"("goalId", "subjectType", "subjectId");
CREATE INDEX "GoalWorkingSetItem_workspaceId_goalId_rank_idx" ON "GoalWorkingSetItem"("workspaceId", "goalId", "rank");
CREATE INDEX "GoalBriefRevision_goalId_createdAt_idx" ON "GoalBriefRevision"("goalId", "createdAt");
CREATE INDEX "GoalBriefRevision_workspaceId_goalId_idx" ON "GoalBriefRevision"("workspaceId", "goalId");
