-- Per-call audit records now live in ModuleCall.
ALTER TABLE "ModuleRun" DROP COLUMN "executed";
