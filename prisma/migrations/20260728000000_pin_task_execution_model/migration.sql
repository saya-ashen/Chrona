-- Add stable logical descriptions for Goal assets and backfill from current Artifact metadata.
ALTER TABLE "GoalAsset" ADD COLUMN "description" TEXT;
UPDATE "GoalAsset"
SET "description" = COALESCE(
  json_extract((SELECT "metadata" FROM "Artifact" WHERE "Artifact"."id" = "GoalAsset"."currentArtifactId"), '$.description'),
  json_extract((SELECT "metadata" FROM "Artifact" WHERE "Artifact"."id" = "GoalAsset"."currentArtifactId"), '$.summary')
)
WHERE "description" IS NULL;
