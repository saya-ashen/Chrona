-- v2-7: the entry module of a conversation receives its replies as routed calls. Additive only.
ALTER TABLE "Session" ADD COLUMN "entryModuleId" TEXT;
