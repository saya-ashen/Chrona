-- Security simplification §3.1: approvals have no levels, briefs or AI review.
ALTER TABLE "Approval" DROP COLUMN "level";
ALTER TABLE "Approval" DROP COLUMN "brief";
UPDATE "Workspace" SET "settings" = json_remove("settings", '$.moduleModel.review') WHERE json_extract("settings", '$.moduleModel.review') IS NOT NULL;
