import { expect, it } from "vitest";
import { ACTIONS, DEFAULT_POLICY, type Grant } from "@chrona/contracts";
import { policyRows, parseModuleModelForm, parseNotificationForm } from "./settings";
const modelForm = { model: "fake/exact", maxCallsPerEvent: "2", maxOutputTokens: "2000", dailyCalls: "100", timeoutMs: "60000" };
it("parses the exact module model and limits", () => expect(parseModuleModelForm(modelForm)).toEqual({ model: "fake/exact", maxCallsPerEvent: 2, maxOutputTokens: 2000, dailyCalls: 100, timeoutMs: 60000 }));
it.each([
  { model: " " }, { maxCallsPerEvent: "0" }, { maxCallsPerEvent: "21" }, { maxCallsPerEvent: "1.5" },
  { maxOutputTokens: "32001" }, { dailyCalls: "10001" }, { dailyCalls: "" }, { timeoutMs: "4999" }, { timeoutMs: "600001" },
])("rejects invalid module model form %j", patch => expect(parseModuleModelForm({ ...modelForm, ...patch })).toBeNull());
const now = Date.parse("2026-01-01T00:00:00Z");
const grant = (patch: Partial<Grant> = {}): Grant => ({ id: "g", action: "connect_source", mode: "auto", scope: { kind: "global" }, once: false, consumedAt: null, revokedAt: null, expiresAt: null, createdAt: "2025-01-01T00:00:00Z", ...patch });
it.each(ACTIONS)("default and editability: %s", action => {
  const row = policyRows([], now).find(r => r.action === action)!;
  expect(row.mode).toBe(DEFAULT_POLICY[action]); expect(row.editable).toBe(action !== "change_credentials");
});
it.each([
  ["global override", [grant()], "auto"],
  ["most restrictive global", [grant(), grant({ mode: "never" })], "never"],
  ["scoped excluded", [grant({ scope: { kind: "module", moduleId: "a" } })], "ask"],
  ["revoked", [grant({ revokedAt: "2025-12-31T00:00:00Z" })], "ask"],
  ["expired", [grant({ expiresAt: "2026-01-01T00:00:00Z" })], "ask"],
  ["consumed", [grant({ once: true, consumedAt: "2025-12-31T00:00:00Z" })], "ask"],
] as const)("policy %s", (_name, grants, mode) => expect(policyRows([...grants], now).find(r => r.action === "connect_source")?.mode).toBe(mode));
it("cannot loosen never", () => expect(policyRows([grant({ action: "change_credentials" })], now).find(r => r.action === "change_credentials")?.mode).toBe("never"));
it.each([
  ["5", "23:00", "08:00", "09:00", true, true],
  ["0", "", "", "00:00", false, true],
  ["50", "08:00", "09:00", "23:59", true, true],
  ["51", "23:00", "08:00", "09:00", true, false],
  ["1.5", "23:00", "08:00", "09:00", true, false],
  ["", "23:00", "08:00", "09:00", true, false],
  ["5", "24:00", "08:00", "09:00", true, false],
  ["5", "23:00", "23:00", "09:00", true, false],
  ["5", "23:00", "08:60", "09:00", true, false],
  ["5", "23:00", "08:00", "24:00", false, false],
] as const)("validates form %s %s %s %s %s", (cap, start, end, digest, quiet, valid) => expect(parseNotificationForm(cap, start, end, digest, quiet) !== null).toBe(valid));
