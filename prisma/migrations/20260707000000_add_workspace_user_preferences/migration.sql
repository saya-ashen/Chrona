
-- A node attempt has exactly one terminal outcome. Same-kind retries are handled idempotently in the engine.
DROP INDEX IF EXISTS "TaskPlanTerminalAction_nodeAttemptId_kind_key";
CREATE UNIQUE INDEX "TaskPlanTerminalAction_nodeAttemptId_key" ON "TaskPlanTerminalAction"("nodeAttemptId");
