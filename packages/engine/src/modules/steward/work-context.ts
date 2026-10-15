import type { Prisma, StewardWork, StewardWorkAttempt, Delegation } from "@chrona/db/generated/prisma/client";
export type WorkToolContext = { tx: Prisma.TransactionClient; work: StewardWork; attempt: StewardWorkAttempt; delegation: Delegation; now: Date; workspaceId: string };
export class WorkToolError extends Error { constructor(readonly code: string, message: string) { super(message); } }
