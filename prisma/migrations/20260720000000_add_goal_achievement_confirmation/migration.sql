-- Retain evidence-backed, actor-confirmed Goal achievement details separately
-- from the lifecycle status and success-criterion snapshot.
ALTER TABLE "Goal" ADD COLUMN "achievementConfirmation" JSONB;
