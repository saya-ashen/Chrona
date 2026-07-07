-- Persist per-workspace UI preferences, scoped to local user until auth adds real users.
CREATE TABLE "WorkspaceUserPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'local',
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkspaceUserPreference_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WorkspaceUserPreference_workspaceId_userId_key_key" ON "WorkspaceUserPreference"("workspaceId", "userId", "key");
CREATE INDEX "WorkspaceUserPreference_userId_key_idx" ON "WorkspaceUserPreference"("userId", "key");
