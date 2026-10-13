-- Declarative managed-tool definitions and terminal lifecycle timestamps.
ALTER TABLE "ManagedTool" ADD COLUMN "spec" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ManagedTool" ADD COLUMN "disabledAt" DATETIME;
ALTER TABLE "ManagedTool" ADD COLUMN "retiredAt" DATETIME;
