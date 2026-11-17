import { z } from "zod";

/** Business readiness is the module's claim, independent of observed process state. */
export const moduleReadinessReportSchema = z.object({
  status: z.enum(["ready", "needs_configuration", "degraded", "unknown"]),
  summary: z.string().max(300),
  nextAction: z.string().max(300).optional(),
  validForSeconds: z.number().int().min(1).max(3600).default(300),
}).strict();
export type ModuleReadinessReport = z.infer<typeof moduleReadinessReportSchema>;
export type ModuleReadinessRecord = ModuleReadinessReport & { reportedAt: string; expiresAt: string };
export function projectReadiness(report: ModuleReadinessRecord | undefined, available: boolean, now: Date) {
  if (!report) return { source: "module" as const, status: "unknown" as const, summary: "", nextAction: null, reportedAt: null, expiresAt: null, stale: false };
  const stale = !available || now.getTime() >= Date.parse(report.expiresAt);
  return { source: "module" as const, status: stale ? "unknown" as const : report.status, summary: report.summary,
    nextAction: report.nextAction ?? null, reportedAt: report.reportedAt, expiresAt: report.expiresAt, stale };
}
export const moduleReadinessSchema = z.object({
  source: z.literal("module"),
  status: moduleReadinessReportSchema.shape.status,
  summary: z.string().max(300), nextAction: z.string().max(300).nullable(),
  reportedAt: z.string().nullable(), expiresAt: z.string().nullable(),
  stale: z.boolean(),
});
