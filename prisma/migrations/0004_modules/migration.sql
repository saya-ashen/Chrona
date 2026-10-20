CREATE TABLE "Module" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "affairId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "activeHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Module_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Module_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Module_affairId_name_key" ON "Module"("affairId", "name");
CREATE INDEX "Module_workspaceId_status_idx" ON "Module"("workspaceId", "status");

CREATE TABLE "ModuleVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "intent" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModuleVersion_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ModuleVersion_moduleId_hash_key" ON "ModuleVersion"("moduleId", "hash");
CREATE INDEX "ModuleVersion_moduleId_status_createdAt_idx" ON "ModuleVersion"("moduleId", "status", "createdAt");

CREATE TABLE "Generation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "modules" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Generation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Generation_workspaceId_seq_key" ON "Generation"("workspaceId", "seq");

CREATE TABLE "ModuleRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "firedAt" DATETIME NOT NULL,
    "exitCode" INTEGER NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "executed" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModuleRun_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ModuleRun_moduleId_createdAt_idx" ON "ModuleRun"("moduleId", "createdAt");
CREATE INDEX "ModuleRun_moduleId_hash_firedAt_idx" ON "ModuleRun"("moduleId", "hash", "firedAt");

ALTER TABLE "Schedule" ADD COLUMN "moduleId" TEXT REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Schedule" ADD COLUMN "triggerId" TEXT;
CREATE INDEX "Schedule_moduleId_status_idx" ON "Schedule"("moduleId", "status");

UPDATE "Schedule" SET "status" = 'paused', "lastResult" = 'job 已停用：请改为模块' WHERE "mode" = 'job' AND "status" = 'active';
