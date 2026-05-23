ALTER TABLE "Event" ADD COLUMN "nodeId" TEXT;
ALTER TABLE "Event" ADD COLUMN "nodeTitle" TEXT;

CREATE INDEX "Event_taskId_nodeId_ingestSequence_idx" ON "Event"("taskId", "nodeId", "ingestSequence");
