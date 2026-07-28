-- Manual Goal Working Set persistence is replaced by automatic accepted-result context snapshots and MCP retrieval.
DROP TABLE IF EXISTS "GoalWorkingSetItem";

-- Lock each Task to its first resolved execution model until the user changes model routing.
ALTER TABLE "Task" ADD COLUMN "pinnedModel" TEXT;
ALTER TABLE "Task" ADD COLUMN "pinnedModelSource" TEXT;
