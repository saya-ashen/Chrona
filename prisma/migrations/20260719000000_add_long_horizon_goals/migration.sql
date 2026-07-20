-- Phase 3 long-horizon Goal aggregate. Goal owns durable outcome state while
-- bounded Tasks continue to own all plans, runs, sessions, and artifacts.
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "successCriteria" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "nextReviewAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "achievedAt" DATETIME,
    "stoppedAt" DATETIME,
    CONSTRAINT "Goal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "Task" ADD COLUMN "goalId" TEXT REFERENCES "Goal" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "GoalAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "sourceArtifactId" TEXT NOT NULL,
    "currentArtifactId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoalAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAsset_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAsset_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "Artifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GoalAsset_currentArtifactId_fkey" FOREIGN KEY ("currentArtifactId") REFERENCES "Artifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Goal_workspaceId_status_idx" ON "Goal"("workspaceId", "status");
CREATE INDEX "Goal_workspaceId_updatedAt_idx" ON "Goal"("workspaceId", "updatedAt");
CREATE INDEX "Task_goalId_idx" ON "Task"("goalId");
CREATE UNIQUE INDEX "GoalAsset_goalId_sourceArtifactId_key" ON "GoalAsset"("goalId", "sourceArtifactId");
CREATE INDEX "GoalAsset_workspaceId_goalId_idx" ON "GoalAsset"("workspaceId", "goalId");
CREATE INDEX "GoalAsset_sourceArtifactId_idx" ON "GoalAsset"("sourceArtifactId");
CREATE INDEX "GoalAsset_currentArtifactId_idx" ON "GoalAsset"("currentArtifactId");
