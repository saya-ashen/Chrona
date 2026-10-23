-- Entry-module and policy approvals can be resolved from any entry; the rescue console is only a fallback.
ALTER TABLE "Approval" DROP COLUMN "rescueOnly";
