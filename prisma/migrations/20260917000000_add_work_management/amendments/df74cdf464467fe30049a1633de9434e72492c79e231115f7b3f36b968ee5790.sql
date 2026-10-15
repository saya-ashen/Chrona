-- Agent work protocol: one requested piece of work, its bounded authorization and its runs.
CREATE TABLE "StewardWork" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "affairId" TEXT NOT NULL,
    "delegationId" TEXT NOT NULL,
    "request" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "question" JSONB,
    "authorization" JSONB,
    "inputs" JSONB NOT NULL DEFAULT '[]',
    "progress" JSONB NOT NULL DEFAULT '[]',
    "handling" JSONB,
    "resultTaskId" TEXT,
    "resultVersionId" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "wakeReason" TEXT NOT NULL DEFAULT 'new_request',
    "nextRunAt" DATETIME,
    "leaseUntil" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StewardWork_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StewardWork_affairId_fkey" FOREIGN KEY ("affairId") REFERENCES "Affair" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StewardWork_delegationId_fkey" FOREIGN KEY ("delegationId") REFERENCES "Delegation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "StewardWorkAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "wakeReason" TEXT NOT NULL,
    "workRevision" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "toolCalls" JSONB NOT NULL DEFAULT '[]',
    "webCalls" INTEGER NOT NULL DEFAULT 0,
    "observedSources" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    CONSTRAINT "StewardWorkAttempt_workId_fkey" FOREIGN KEY ("workId") REFERENCES "StewardWork" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StewardWork_delegationId_key" ON "StewardWork"("delegationId");
CREATE INDEX "StewardWork_workspaceId_status_nextRunAt_idx" ON "StewardWork"("workspaceId", "status", "nextRunAt");
CREATE INDEX "StewardWork_affairId_idx" ON "StewardWork"("affairId");
CREATE UNIQUE INDEX "StewardWorkAttempt_tokenHash_key" ON "StewardWorkAttempt"("tokenHash");
CREATE INDEX "StewardWorkAttempt_workspaceId_status_deadlineAt_idx" ON "StewardWorkAttempt"("workspaceId", "status", "deadlineAt");
CREATE UNIQUE INDEX "StewardWorkAttempt_workId_number_key" ON "StewardWorkAttempt"("workId", "number");
CREATE TRIGGER "StewardWork_workspace_immutable" BEFORE UPDATE OF "workspaceId" ON "StewardWork"
WHEN NEW."workspaceId" <> OLD."workspaceId"
BEGIN SELECT RAISE(ABORT, 'Steward workspace is immutable'); END;
CREATE TRIGGER "StewardWork_scope_insert" BEFORE INSERT ON "StewardWork"
WHEN NOT EXISTS (SELECT 1 FROM "Affair" WHERE "id" = NEW."affairId" AND "workspaceId" = NEW."workspaceId") OR NOT EXISTS (SELECT 1 FROM "Delegation" WHERE "id" = NEW."delegationId" AND "workspaceId" = NEW."workspaceId")
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "StewardWork_scope_update" BEFORE UPDATE ON "StewardWork"
WHEN NOT EXISTS (SELECT 1 FROM "Affair" WHERE "id" = NEW."affairId" AND "workspaceId" = NEW."workspaceId") OR NOT EXISTS (SELECT 1 FROM "Delegation" WHERE "id" = NEW."delegationId" AND "workspaceId" = NEW."workspaceId")
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "StewardWorkAttempt_scope_insert" BEFORE INSERT ON "StewardWorkAttempt"
WHEN NOT EXISTS (SELECT 1 FROM "StewardWork" WHERE "id" = NEW."workId" AND "workspaceId" = NEW."workspaceId")
BEGIN SELECT RAISE(ABORT, 'Steward reference outside workspace'); END;
CREATE TRIGGER "StewardWorkAttempt_scope_update" BEFORE UPDATE ON "StewardWorkAttempt"
WHEN NEW."workspaceId" <> OLD."workspaceId" OR NEW."workId" <> OLD."workId"
BEGIN SELECT RAISE(ABORT, 'Steward workspace is immutable'); END;
