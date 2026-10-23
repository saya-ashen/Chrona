import { expect, test } from "bun:test";
import { ACTIONS, DEFAULT_POLICY, type Grant } from "@chrona/contracts/steward";
import { decidePolicy, MODE_STRICTNESS } from "./policy";
const now = new Date("2026-01-31T12:00:00Z");
const grant = (patch: Partial<Grant> = {}): Grant => ({ id: "g", action: "send_external_message", mode: "auto", scope: { kind: "global" }, once: false, consumedAt: null, expiresAt: null, revokedAt: null, createdAt: now.toISOString(), ...patch });
test.each([...ACTIONS])("default %s", (action) => { expect(decidePolicy(action, {}, [], now).mode).toBe(DEFAULT_POLICY[action]); });
test.each([
  ["global", [grant()], "auto", "g"],
  ["expired", [grant({ expiresAt: now.toISOString() })], "ask", null],
  ["invalid expiry", [grant({ expiresAt: "invalid" })], "ask", null],
  ["revoked", [grant({ revokedAt: now.toISOString() })], "ask", null],
  ["consumed", [grant({ once: true, consumedAt: now.toISOString() })], "ask", null],
  ["unused once", [grant({ once: true })], "auto", "g"],
  ["preapproved", [grant({ mode: "preapproved" })], "preapproved", "g"],
  ["wrong action", [grant({ action: "purchase" })], "ask", null],
  ["wrong module", [grant({ scope: { kind: "module", moduleId: "other" } })], "ask", null],
  ["wrong connector", [grant({ scope: { kind: "connector", connectorId: "other" } })], "ask", null],
  ["module over global", [grant({ mode: "ask" }), grant({ id: "a", scope: { kind: "module", moduleId: "a" } })], "auto", "a"],
  ["stricter connector", [grant({ scope: { kind: "module", moduleId: "a" } }), grant({ id: "c", mode: "ask", scope: { kind: "connector", connectorId: "c" } })], "ask", "c"],
  ["stricter module", [grant({ id: "a", mode: "never", scope: { kind: "module", moduleId: "a" } }), grant({ scope: { kind: "connector", connectorId: "c" } })], "never", "a"],
] as const)("grant %s", (_name, grants, mode, grantId) => {
  for (const list of [grants, [...grants].reverse()]) expect(decidePolicy("send_external_message", { moduleId: "a", connectorId: "c" }, list, now)).toMatchObject({ mode, grantId });
});
test.each(Object.keys(MODE_STRICTNESS) as Grant["mode"][])("never cannot loosen to %s", (mode) => {
  expect(decidePolicy("change_credentials", {}, [grant({ action: "change_credentials", mode })], now)).toMatchObject({ mode: "never", grantId: null });
});
test("human reason", () => { expect(decidePolicy("send_external_message", {}, [], now).reason).toBe("内置规则：对外发消息需要先问你"); });
