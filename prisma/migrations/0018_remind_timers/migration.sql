-- v2-24: Provider reminders become the remind module's own timers. `text` held the reminder (also in payload); it now holds the timer key.
-- shortcut: reminders from a database that never had the remind module stay unattached; only one pre-0011 deployment existed and it is attached.
UPDATE "Schedule" SET "moduleId" = (SELECT "id" FROM "Module" WHERE "Module"."workspaceId" = "Schedule"."workspaceId" AND "Module"."name" = 'remind' AND "Module"."builtin" = 1)
WHERE "mode" = 'module' AND "payload" IS NOT NULL AND "triggerId" IS NULL AND "moduleId" IS NULL;
UPDATE "Schedule" SET "text" = 'legacy-' || "id"
WHERE "mode" = 'module' AND "payload" IS NOT NULL AND "triggerId" IS NULL
  AND "moduleId" IN (SELECT "id" FROM "Module" WHERE "name" = 'remind' AND "builtin" = 1);
