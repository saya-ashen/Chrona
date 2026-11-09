import { expect, test } from "bun:test";
import { ACTIONS, DEFAULT_POLICY, type Grant } from "@chrona/contracts/steward";
import { decidePolicy } from "./policy";
const now = new Date("2026-01-31T12:00:00Z");
const grant = (patch: Partial<Grant> = {}): Grant => ({ id: "g", action: "modify_external", mode: "allow", scope: { kind: "global" }, once: false, consumedAt: null, expiresAt: null, revokedAt: null, createdAt: now.toISOString(), ...patch });
test.each([...ACTIONS])("default %s", (action) => { expect(decidePolicy(action, {}, [], now).mode).toBe(DEFAULT_POLICY[action]); });
test.each([
  ["global", [grant()], "allow", "g"],
  ["expired", [grant({ expiresAt: now.toISOString() })], "ask", null],
  ["invalid expiry", [grant({ expiresAt: "invalid" })], "ask", null],
  ["revoked", [grant({ revokedAt: now.toISOString() })], "ask", null],
  ["consumed", [grant({ once: true, consumedAt: now.toISOString() })], "ask", null],
  ["unused once", [grant({ once: true })], "allow", "g"],
  ["wrong action", [grant({ action: "delete_data" })], "ask", null],
  ["wrong module", [grant({ scope: { kind: "module", moduleId: "other" } })], "ask", null],
  ["module over global", [grant({ mode: "ask" }), grant({ id: "a", scope: { kind: "module", moduleId: "a" } })], "allow", "a"],
  ["stricter module", [grant({ id: "a", mode: "ask", scope: { kind: "module", moduleId: "a" } }), grant()], "ask", "a"],
  ["once over standing ask", [grant({ id: "ask", mode: "ask" }), grant({ once: true })], "allow", "g"],
  ["standing ask over standing allow", [grant({ id: "ask", mode: "ask" }), grant()], "ask", "ask"],
  ["once ask over once allow", [grant({ id: "ask", mode: "ask", once: true }), grant({ once: true })], "ask", "ask"],
] as const)("grant %s", (_name, grants, mode, grantId) => {
  for (const list of [grants, [...grants].reverse()]) expect(decidePolicy("modify_external", { moduleId: "a" }, list, now)).toMatchObject({ mode, grantId });
});
test("human reason", () => { expect(decidePolicy("modify_external", {}, [], now).reason).toBe("内置规则：修改外部系统需要先问你"); });
