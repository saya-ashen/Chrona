ALTER TABLE "WorkBlock" ADD COLUMN "sessionId" TEXT;

CREATE UNIQUE INDEX "WorkBlock_sessionId_key" ON "WorkBlock"("sessionId");
CREATE INDEX "WorkBlock_sessionId_idx" ON "WorkBlock"("sessionId");
