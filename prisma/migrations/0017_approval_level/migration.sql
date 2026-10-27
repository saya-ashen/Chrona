-- v2-17: every approval carries a risk level computed by the kernel and a short brief (headline, what it adds, reversibility).
ALTER TABLE "Approval" ADD COLUMN "level" TEXT NOT NULL DEFAULT 'yellow';
ALTER TABLE "Approval" ADD COLUMN "brief" JSONB;
