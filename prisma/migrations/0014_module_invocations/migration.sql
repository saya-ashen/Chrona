-- Module capability routing: calls routed by Chrona between modules (and from Chrona to modules).
-- Additive only: existing Notification rows stay untouched and are copied to the notify module at runtime.
CREATE TABLE "ModuleInvocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "caller" TEXT NOT NULL,
    "callerModuleId" TEXT,
    "callerHash" TEXT,
    "target" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "key" TEXT NOT NULL,
    "chain" JSONB NOT NULL DEFAULT '[]',
    "mode" TEXT NOT NULL,
    "idempotent" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "leaseToken" TEXT,
    "leaseUntil" DATETIME,
    "output" JSONB,
    "error" TEXT,
    "reply" BOOLEAN NOT NULL DEFAULT false,
    "replyAttempts" INTEGER NOT NULL DEFAULT 0,
    "repliedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "ModuleInvocation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ModuleInvocation_workspaceId_caller_target_tool_key_key" ON "ModuleInvocation"("workspaceId", "caller", "target", "tool", "key");
CREATE INDEX "ModuleInvocation_workspaceId_status_nextAttemptAt_idx" ON "ModuleInvocation"("workspaceId", "status", "nextAttemptAt");
CREATE INDEX "ModuleInvocation_workspaceId_reply_repliedAt_idx" ON "ModuleInvocation"("workspaceId", "reply", "repliedAt");
