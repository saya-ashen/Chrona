CREATE TABLE "CalendarSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'subscription',
    "sourceUrl" TEXT NOT NULL,
    "redactedUrlLabel" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "lifecycleState" TEXT NOT NULL DEFAULT 'active',
    "syncState" TEXT NOT NULL DEFAULT 'idle',
    "lastSuccessfulRefreshAt" DATETIME,
    "nextExpectedRefreshAt" DATETIME,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarSource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ImportedCalendarEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "calendarSourceId" TEXT NOT NULL,
    "externalUid" TEXT NOT NULL,
    "recurrenceId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportedCalendarEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportedCalendarEvent_calendarSourceId_fkey" FOREIGN KEY ("calendarSourceId") REFERENCES "CalendarSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CalendarSource_workspaceId_lifecycleState_idx" ON "CalendarSource"("workspaceId", "lifecycleState");
CREATE UNIQUE INDEX "CalendarSource_workspaceId_sourceUrl_key" ON "CalendarSource"("workspaceId", "sourceUrl");
CREATE UNIQUE INDEX "ImportedCalendarEvent_calendarSourceId_dedupeKey_key" ON "ImportedCalendarEvent"("calendarSourceId", "dedupeKey");
CREATE INDEX "ImportedCalendarEvent_workspaceId_startsAt_endsAt_idx" ON "ImportedCalendarEvent"("workspaceId", "startsAt", "endsAt");
CREATE INDEX "ImportedCalendarEvent_calendarSourceId_startsAt_idx" ON "ImportedCalendarEvent"("calendarSourceId", "startsAt");
