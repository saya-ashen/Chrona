import { z } from "zod";
import { moduleVersionHashSchema } from "./module-lifecycle";

const id = z.string().min(1).max(128);
const requestKey = z.string().min(1).max(200);
const name = z.string().regex(/^[a-z][a-z0-9-]*$/).max(64);
const relativeDir = z.string().min(1).max(500).refine(value => !value.startsWith("/") && !value.includes("\\") && !value.includes("\0") && value.split("/").every(part => part && part !== "." && part !== ".." && part !== ".git"), "Expected a relative content directory");
export const candidateSubmitterSchema = z.object({ moduleId: id, hash: moduleVersionHashSchema }).strict();
export const candidateTargetSchema = z.object({ name, moduleId: id.nullable(), expectedActiveHash: moduleVersionHashSchema.nullable() }).strict().refine(target => target.moduleId !== null || target.expectedActiveHash === null, "New targets cannot have an active hash");
/** Material admission only; this grant does not authorize any model execution. */
export const candidateAdmissionInputSchema = z.object({ requestKey, submitter: candidateSubmitterSchema, targets: z.array(candidateTargetSchema).min(1).max(4) }).strict().refine(input => new Set(input.targets.map(target => target.name)).size === input.targets.length && new Set(input.targets.flatMap(target => target.moduleId ? [target.moduleId] : [])).size === input.targets.filter(target => target.moduleId).length, "Targets must be unique");
export const candidateIntentSchema = z.object({ changes: z.array(z.string().trim().min(1).max(500)).min(1).max(20), preserves: z.array(z.string().trim().min(1).max(500)).max(20).default([]) }).strict();
export const candidateSubmitInputSchema = z.object({ admissionId: id, requestKey, items: z.array(z.object({ name, dir: relativeDir, intent: candidateIntentSchema }).strict()).min(1).max(4) }).strict().refine(input => new Set(input.items.map(item => item.name)).size === input.items.length, "Items must be unique");
export const candidateSourceInputSchema = z.object({ admissionId: id, moduleId: id, hash: moduleVersionHashSchema, to: relativeDir }).strict();
/** The two exact selectors are exclusive; there is deliberately no latest selector. */
export const candidateCheckInputSchema = z.union([
  z.object({ receiptId: id }).strict(),
  z.object({ admissionId: id, requestKey }).strict(),
]);
export const candidateAdmissionOutputSchema = z.object({ admissionId: id, requestKey, submitter: candidateSubmitterSchema, targets: z.array(candidateTargetSchema).min(1).max(4) }).strict();
export const candidateSourceOutputSchema = z.object({ moduleId: id, hash: moduleVersionHashSchema, materialDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const candidateReceiptSchema = z.object({
  receiptId: id, admissionId: id, requestKey, submitter: candidateSubmitterSchema,
  state: z.enum(["submitted", "pending_approval", "approved", "rejected"]), approvalId: id.nullable(),
  members: z.array(z.object({ name, moduleId: id, hash: moduleVersionHashSchema, versionId: id, expectedActiveHash: moduleVersionHashSchema.nullable(), materialDigest: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(["building", "testing", "pending_review", "approved", "rejected"]), selected: z.boolean() }).strict()).min(1).max(4),
}).strict();
export const candidateSubmitOutputSchema = candidateReceiptSchema;
export const candidateCheckOutputSchema = candidateReceiptSchema;
export type CandidateAdmissionInput = z.infer<typeof candidateAdmissionInputSchema>;
export type CandidateSubmitInput = z.infer<typeof candidateSubmitInputSchema>;
export type CandidateSourceInput = z.infer<typeof candidateSourceInputSchema>;
export type CandidateCheckInput = z.infer<typeof candidateCheckInputSchema>;
export type CandidateReceipt = z.infer<typeof candidateReceiptSchema>;
export type CandidateAdmissionOutput = z.infer<typeof candidateAdmissionOutputSchema>;
export type CandidateSourceOutput = z.infer<typeof candidateSourceOutputSchema>;
export type CandidateSubmitOutput = CandidateReceipt;
export type CandidateCheckOutput = CandidateReceipt;
