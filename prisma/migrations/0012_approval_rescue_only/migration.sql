-- v2-4: entry-module changes and policy changes are approved only in the rescue console or chrona admin.
ALTER TABLE "Approval" ADD COLUMN "rescueOnly" BOOLEAN NOT NULL DEFAULT false;
