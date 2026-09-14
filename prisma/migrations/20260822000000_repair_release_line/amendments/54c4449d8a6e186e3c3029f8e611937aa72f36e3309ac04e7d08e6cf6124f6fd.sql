-- Phase 2A amendment for databases already on the management-MCP release-line checksum.
-- Existing records intentionally retain the AI default; no task is inferred as manual.
ALTER TABLE "Task" ADD COLUMN "taskExecutionMode" TEXT NOT NULL DEFAULT 'ai';
