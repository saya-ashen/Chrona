import { expect, test } from "bun:test";
import { moduleReadinessReportSchema, projectReadiness } from "./module-readiness";

const now = new Date("2026-11-07T00:00:00Z");
test.each(["ready", "needs_configuration", "degraded", "unknown"] as const)("module readiness retains reported %s only while observed process and report are current", status => {
  const report = { ...moduleReadinessReportSchema.parse({ status, summary: "Module diagnosis" }), reportedAt: now.toISOString(), expiresAt: "2026-11-07T00:05:00Z" };
  expect(projectReadiness(report, true, now)).toMatchObject({ source: "module", status, stale: false });
  expect(projectReadiness(report, false, now)).toMatchObject({ status: "unknown", stale: true });
  expect(projectReadiness(report, true, new Date(report.expiresAt))).toMatchObject({ status: "unknown", stale: true });
});
test.each([{ validForSeconds: 0 }, { validForSeconds: 3601 }, { summary: "x".repeat(301) }, { extra: "untrusted" }])("invalid readiness report rejects %j", extra => {
  expect(moduleReadinessReportSchema.safeParse({ status: "ready", summary: "Ready", ...extra }).success).toBe(false);
});
test("no report remains unknown even for a running process", () => {
  expect(projectReadiness(undefined, true, now)).toMatchObject({ status: "unknown", reportedAt: null, stale: false });
});
