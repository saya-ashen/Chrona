-- Goal editing: persistent CAS across MCP, UI and all canonical writers.
ALTER TABLE "Goal" ADD COLUMN "configRevision" INTEGER NOT NULL DEFAULT 1;
CREATE TRIGGER "Goal_config_update" AFTER UPDATE OF
  "title", "description", "operationalBrief", "successCriteria", "status",
  "nextReviewAt", "achievementConfirmation", "workspaceId" ON "Goal"
WHEN OLD."title" IS NOT NEW."title" OR OLD."description" IS NOT NEW."description"
  OR OLD."operationalBrief" IS NOT NEW."operationalBrief" OR OLD."successCriteria" IS NOT NEW."successCriteria"
  OR OLD."status" IS NOT NEW."status" OR OLD."nextReviewAt" IS NOT NEW."nextReviewAt"
  OR OLD."achievementConfirmation" IS NOT NEW."achievementConfirmation" OR OLD."workspaceId" IS NOT NEW."workspaceId"
BEGIN UPDATE "Goal" SET "configRevision" = OLD."configRevision" + 1 WHERE "id" = NEW."id"; END;
