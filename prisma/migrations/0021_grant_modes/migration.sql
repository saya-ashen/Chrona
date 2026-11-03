UPDATE "Grant" SET "mode"='allow' WHERE "mode" IN ('auto','notify_after','preapproved');
UPDATE "Grant" SET "mode"='ask' WHERE "mode"='never';
DELETE FROM "Grant" WHERE "action"='activate_module';
