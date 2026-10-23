-- v2-2: sessions replace affairs and conversation keys; modules become workspace-wide apps.
-- Affair directories (files) are moved by the separate deploy-time data migration.
-- DropIndex
DROP INDEX "Affair_workspaceId_status_lastActivityAt_idx";

-- DropIndex
DROP INDEX "Affair_workspaceId_dirName_key";

-- DropIndex
DROP INDEX "Activity_affairId_at_idx";

-- DropIndex
DROP INDEX "Activity_workspaceId_at_idx";


-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "moduleId" TEXT,
    "originSessionId" TEXT,
    "providerSessionId" TEXT,
    "focus" JSONB NOT NULL DEFAULT '["files"]',
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "Session_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Session_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Session_originSessionId_fkey" FOREIGN KEY ("originSessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- One session per former conversation key; QQ conversations become the qq:dm entry.
INSERT INTO "Session" ("id", "workspaceId", "key", "source", "lastActivityAt", "createdAt")
SELECT lower(hex(randomblob(16))), "workspaceId", "conversationKey", CASE WHEN max("channel") = 'chrona_qqbot' THEN 'qq' ELSE 'web' END, max("at"), min("at")
FROM "Message" GROUP BY "workspaceId", "conversationKey";
INSERT INTO "Session" ("id", "workspaceId", "key", "source", "lastActivityAt", "createdAt")
SELECT lower(hex(randomblob(16))), "workspaceId", "conversationKey", 'web', max("createdAt"), min("createdAt")
FROM "Run" r WHERE "conversationKey" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Session" s WHERE s."workspaceId" = r."workspaceId" AND s."key" = r."conversationKey")
GROUP BY "workspaceId", "conversationKey";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Module" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "activeHash" TEXT,
    "dataSchema" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Module_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Module names were unique per affair; later duplicates get an id suffix.
INSERT INTO "new_Module" ("activeHash", "createdAt", "dataSchema", "id", "name", "status", "workspaceId")
SELECT "activeHash", "createdAt", "dataSchema", "id",
  "name" || CASE WHEN row_number() OVER (PARTITION BY "workspaceId", "name" ORDER BY "createdAt", "id") > 1 THEN '-' || substr("id", 1, 6) ELSE '' END,
  "status", "workspaceId" FROM "Module";
DROP TABLE "Module";
ALTER TABLE "new_Module" RENAME TO "Module";
CREATE INDEX "Module_workspaceId_status_idx" ON "Module"("workspaceId", "status");
CREATE UNIQUE INDEX "Module_workspaceId_name_key" ON "Module"("workspaceId", "name");
CREATE TABLE "new_Schedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "originSessionId" TEXT,
    "mode" TEXT NOT NULL,
    "rule" JSONB NOT NULL,
    "text" TEXT NOT NULL,
    "moduleId" TEXT,
    "triggerId" TEXT,
    "until" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "nextAt" DATETIME,
    "lastAt" DATETIME,
    "lastResult" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Schedule_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Schedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Schedule_originSessionId_fkey" FOREIGN KEY ("originSessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Schedule" ("createdAt", "createdBy", "failures", "id", "label", "lastAt", "lastResult", "mode", "moduleId", "nextAt", "rule", "status", "text", "triggerId", "until", "workspaceId") SELECT "createdAt", "createdBy", "failures", "id", "label", "lastAt", "lastResult", "mode", "moduleId", "nextAt", "rule", "status", "text", "triggerId", "until", "workspaceId" FROM "Schedule";
DROP TABLE "Schedule";
ALTER TABLE "new_Schedule" RENAME TO "Schedule";
CREATE INDEX "Schedule_workspaceId_status_nextAt_idx" ON "Schedule"("workspaceId", "status", "nextAt");
CREATE INDEX "Schedule_moduleId_status_idx" ON "Schedule"("moduleId", "status");
CREATE TABLE "new_Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT,
    "lane" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "provider" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "leaseUntil" DATETIME,
    "deadlineAt" DATETIME,
    "prompt" TEXT NOT NULL,
    "summary" TEXT,
    "label" TEXT,
    "cwd" TEXT NOT NULL,
    "toolCalls" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Run_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Run_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Run" ("createdAt", "cwd", "deadlineAt", "endedAt", "error", "id", "label", "lane", "leaseUntil", "prompt", "provider", "startedAt", "status", "summary", "tokenHash", "toolCalls", "trigger", "workspaceId", "sessionId")
SELECT "createdAt", "cwd", "deadlineAt", "endedAt", "error", "id", "label", "lane", "leaseUntil", "prompt", "provider", "startedAt", "status", "summary", "tokenHash", "toolCalls", "trigger", "workspaceId",
  (SELECT s."id" FROM "Session" s WHERE s."workspaceId" = r."workspaceId" AND s."key" = r."conversationKey" ORDER BY s."lastActivityAt" DESC LIMIT 1)
FROM "Run" r;
DROP TABLE "Run";
ALTER TABLE "new_Run" RENAME TO "Run";
CREATE UNIQUE INDEX "Run_tokenHash_key" ON "Run"("tokenHash");
CREATE INDEX "Run_workspaceId_lane_status_createdAt_idx" ON "Run"("workspaceId", "lane", "status", "createdAt");
CREATE INDEX "Run_workspaceId_status_leaseUntil_idx" ON "Run"("workspaceId", "status", "leaseUntil");
CREATE INDEX "Run_workspaceId_status_deadlineAt_idx" ON "Run"("workspaceId", "status", "deadlineAt");
CREATE INDEX "Run_sessionId_createdAt_idx" ON "Run"("sessionId", "createdAt");
CREATE TABLE "new_Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "quotedMessageId" TEXT,
    "externalId" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_quotedMessageId_fkey" FOREIGN KEY ("quotedMessageId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Message" ("at", "attachments", "channel", "direction", "externalId", "id", "quotedMessageId", "text", "workspaceId", "sessionId")
SELECT "at", "attachments", "channel", "direction", "externalId", "id", "quotedMessageId", "text", "workspaceId",
  (SELECT s."id" FROM "Session" s WHERE s."workspaceId" = m."workspaceId" AND s."key" = m."conversationKey" LIMIT 1)
FROM "Message" m;
DROP TABLE "Message";
ALTER TABLE "new_Message" RENAME TO "Message";
CREATE INDEX "Message_sessionId_at_idx" ON "Message"("sessionId", "at");
CREATE UNIQUE INDEX "Message_workspaceId_externalId_key" ON "Message"("workspaceId", "externalId");
CREATE TABLE "new_Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "moduleId" TEXT,
    "action" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "preview" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'once',
    "grantId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "Approval_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Approval_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Approval_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Approval" ("action", "createdAt", "detail", "grantId", "id", "payload", "preview", "resolvedAt", "scope", "status", "title", "workspaceId", "moduleId")
SELECT "action", "createdAt", "detail", "grantId", "id", "payload", "preview", "resolvedAt", CASE "scope" WHEN 'affair' THEN 'always' ELSE "scope" END, "status", "title", "workspaceId",
  (SELECT "id" FROM "Module" WHERE "id" = json_extract(a."payload", '$.moduleId'))
FROM "Approval" a;
DROP TABLE "Approval";
ALTER TABLE "new_Approval" RENAME TO "Approval";
CREATE INDEX "Approval_workspaceId_status_createdAt_idx" ON "Approval"("workspaceId", "status", "createdAt");
CREATE INDEX "Approval_moduleId_status_idx" ON "Approval"("moduleId", "status");
CREATE TABLE "new_Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "moduleId" TEXT,
    "sessionId" TEXT,
    "approvalId" TEXT,
    "level" TEXT NOT NULL DEFAULT 'digest',
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "recipient" TEXT,
    "link" TEXT,
    "receiptRef" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" DATETIME,
    "leaseUntil" DATETIME,
    "leaseToken" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    "acknowledgedAt" DATETIME,
    "feedback" TEXT,
    CONSTRAINT "Notification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Notification_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Notification_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "Approval" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Notification" ("acknowledgedAt", "approvalId", "attempts", "body", "channel", "createdAt", "feedback", "id", "idempotencyKey", "lastError", "leaseToken", "leaseUntil", "level", "link", "nextAttemptAt", "receiptRef", "recipient", "sentAt", "status", "title", "workspaceId") SELECT "acknowledgedAt", "approvalId", "attempts", "body", "channel", "createdAt", "feedback", "id", "idempotencyKey", "lastError", "leaseToken", "leaseUntil", "level", "link", "nextAttemptAt", "receiptRef", "recipient", "sentAt", "status", "title", "workspaceId" FROM "Notification";
DROP TABLE "Notification";
ALTER TABLE "new_Notification" RENAME TO "Notification";
CREATE INDEX "Notification_workspaceId_status_level_nextAttemptAt_idx" ON "Notification"("workspaceId", "status", "level", "nextAttemptAt");
CREATE INDEX "Notification_workspaceId_channel_sentAt_idx" ON "Notification"("workspaceId", "channel", "sentAt");
CREATE INDEX "Notification_sessionId_createdAt_idx" ON "Notification"("sessionId", "createdAt");
CREATE INDEX "Notification_approvalId_idx" ON "Notification"("approvalId");
CREATE UNIQUE INDEX "Notification_workspaceId_idempotencyKey_key" ON "Notification"("workspaceId", "idempotencyKey");
CREATE TABLE "new_Connector" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "cursor" TEXT,
    "secretRef" TEXT,
    "canSend" BOOLEAN NOT NULL DEFAULT false,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "nextSyncAt" DATETIME,
    "lastSyncAt" DATETIME,
    "lastError" TEXT,
    "coverageNote" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "Connector_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Connector" ("canSend", "coverageNote", "cursor", "failures", "id", "kind", "label", "lastError", "lastSyncAt", "nextSyncAt", "secretRef", "settings", "status", "workspaceId") SELECT "canSend", "coverageNote", "cursor", "failures", "id", "kind", "label", "lastError", "lastSyncAt", "nextSyncAt", "secretRef", "settings", "status", "workspaceId" FROM "Connector";
DROP TABLE "Connector";
ALTER TABLE "new_Connector" RENAME TO "Connector";
CREATE INDEX "Connector_workspaceId_status_nextSyncAt_idx" ON "Connector"("workspaceId", "status", "nextSyncAt");
-- Exactly one active QQ session: the most recent; older ones end.
UPDATE "Session" SET "status" = 'ended', "endedAt" = "lastActivityAt"
WHERE "source" = 'qq' AND "id" NOT IN (SELECT "id" FROM "Session" s WHERE "source" = 'qq' AND "lastActivityAt" = (SELECT max("lastActivityAt") FROM "Session" t WHERE t."workspaceId" = s."workspaceId" AND t."source" = 'qq'));
UPDATE "Session" SET "key" = 'qq:dm' WHERE "source" = 'qq';
-- Drop the affair tables last: inside the runner's transaction foreign keys stay on,
-- so every child table must already be rebuilt without references to them.
DROP TABLE "Activity";
DROP TABLE "Affair";
-- Affair-scoped grants have no v2 meaning; the user re-grants per module.
DELETE FROM "Grant" WHERE json_extract("scope", '$.kind') = 'affair';
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Session_workspaceId_key_status_idx" ON "Session"("workspaceId", "key", "status");

-- CreateIndex
CREATE INDEX "Session_workspaceId_source_lastActivityAt_idx" ON "Session"("workspaceId", "source", "lastActivityAt");

