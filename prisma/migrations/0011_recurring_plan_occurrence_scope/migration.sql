-- Add occurrence scope to task plans and plan runs so recurring work blocks can
-- carry independent plan and runtime state while keeping task-level plans valid.
ALTER TABLE "TaskPlan" ADD COLUMN "workBlockId" TEXT;
ALTER TABLE "TaskPlanRun" ADD COLUMN "workBlockId" TEXT;

CREATE INDEX "TaskPlan_taskId_workBlockId_status_updatedAt_idx" ON "TaskPlan"("taskId", "workBlockId", "status", "updatedAt");
CREATE INDEX "TaskPlan_workBlockId_status_updatedAt_idx" ON "TaskPlan"("workBlockId", "status", "updatedAt");
CREATE INDEX "TaskPlanRun_taskId_workBlockId_planId_idx" ON "TaskPlanRun"("taskId", "workBlockId", "planId");

CREATE UNIQUE INDEX "TaskPlanRun_taskId_planId_workBlockId_key" ON "TaskPlanRun"("taskId", "planId", "workBlockId");
