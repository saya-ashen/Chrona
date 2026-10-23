CREATE TABLE "ModuleCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "moduleRunId" TEXT,
    "eventKey" TEXT,
    "method" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModuleCall_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ModuleCall_moduleId_method_key_status_idx" ON "ModuleCall"("moduleId", "method", "key", "status");
CREATE INDEX "ModuleCall_moduleRunId_idx" ON "ModuleCall"("moduleRunId");
