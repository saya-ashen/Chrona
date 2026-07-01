-- AlterTable
ALTER TABLE "Task" ADD COLUMN "aiClientId" TEXT;


-- CreateTable
CREATE TABLE "WorkspaceAiSurface" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'dirty',
    "inputFingerprint" TEXT,
    "generatedSpec" JSONB,
    "summaryText" TEXT,
    "providerClientId" TEXT,
    "dirtyAt" DATETIME,
    "generatedAt" DATETIME,
    "lastAttemptAt" DATETIME,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkspaceAiSurface_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceAiSurface_workspaceId_surface_key" ON "WorkspaceAiSurface"("workspaceId", "surface");

-- CreateIndex
CREATE INDEX "WorkspaceAiSurface_surface_status_idx" ON "WorkspaceAiSurface"("surface", "status");

-- CreateIndex
CREATE INDEX "Task_aiClientId_idx" ON "Task"("aiClientId");
