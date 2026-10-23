-- v2-3: reminders become schedules of the built-in remind module; their text moves into payload.
-- moduleId is filled in when the built-in remind module is registered.
ALTER TABLE "Schedule" ADD COLUMN "payload" JSONB;
UPDATE "Schedule" SET "mode" = 'module', "payload" = json_object('text', "text") WHERE "mode" = 'remind';
