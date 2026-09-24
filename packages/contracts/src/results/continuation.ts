import { z } from "zod";

/** Contributor reporting, never acceptance, execution authority or proof of success. */
export const pageContinuationSchema = z.object({
  requestId: z.string().min(1).max(128).describe("Exact owner handoff entry ID from page_read(view=handoff), not a command UUID."),
  baseVersionId: z.string().min(1).max(128).describe("The immutable version bound to that request. Read the current head separately before merging."),
  summary: z.string().trim().min(1).max(1000),
  changes: z.array(z.string().trim().min(1).max(300)).min(1).max(20),
  feedback: z.array(z.object({
    entryId: z.string().min(1).max(128),
    disposition: z.enum(["incorporated", "deferred", "needs_clarification"]),
    explanation: z.string().trim().min(1).max(300),
  }).strict()).max(100).default([]),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.feedback.map((item) => item.entryId)).size !== value.feedback.length) ctx.addIssue({ code: "custom", message: "Duplicate feedback reference" });
  if (new TextEncoder().encode(JSON.stringify(value)).length > 24 * 1024) ctx.addIssue({ code: "custom", message: "Continuation report exceeds 24 KiB" });
});
export type PageContinuation = z.infer<typeof pageContinuationSchema>;
