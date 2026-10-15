import { expect, test } from "bun:test";
import { ACTIONS, DEFAULT_POLICY, type Grant } from "@chrona/contracts/steward";
import { decidePolicy, MODE_STRICTNESS } from "./policy";
const now = new Date("2026-01-31T12:00:00Z");
const grant = (patch: Partial<Grant> = {}): Grant => ({ id: "g", action: "run_script", mode: "auto", scope: { kind: "global" }, once: false, consumedAt: null, expiresAt: null, revokedAt: null, createdAt: now.toISOString(), ...patch });
test.each([...ACTIONS])("default %s", (action) => { expect(decidePolicy(action, {}, [], now).mode).toBe(DEFAULT_POLICY[action]); });
test.each([
  ["global", [grant()], "auto", "g"],
  ["expired", [grant({ expiresAt: now.toISOString() })], "ask", null],
  ["revoked", [grant({ revokedAt: now.toISOString() })], "ask", null],
  ["consumed", [grant({ once: true, consumedAt: now.toISOString() })], "ask", null],
  ["unused once", [grant({ once: true })], "auto", "g"],
  ["preapproved", [grant({ mode: "preapproved" })], "preapproved", "g"],
  ["wrong action", [grant({ action: "purchase" })], "ask", null],
  ["wrong affair", [grant({ scope: { kind: "affair", affairId: "other" } })], "ask", null],
  ["wrong version", [grant({ scope: { kind: "tool_version", toolId: "t", version: 2 } })], "ask", null],
  ["affair over global", [grant({ mode: "never" }), grant({ id: "a", scope: { kind: "affair", affairId: "a" } })], "auto", "a"],
  ["stricter connection", [grant({ scope: { kind: "affair", affairId: "a" } }), grant({ id: "c", mode: "ask", scope: { kind: "connection", connectionId: "c" } })], "ask", "c"],
  ["tool over affair", [grant({ mode: "never", scope: { kind: "affair", affairId: "a" } }), grant({ id: "t", scope: { kind: "tool_version", toolId: "t", version: 1 } })], "auto", "t"],
] as const)("grant %s", (_name, grants, mode, grantId) => {
  const target = { affairId: "a", connectionId: "c", toolId: "t", toolVersion: 1 };
  for (const list of [grants, [...grants].reverse()]) expect(decidePolicy("run_script", target, list, now)).toMatchObject({ mode, grantId });
});
test.each(Object.keys(MODE_STRICTNESS) as Grant["mode"][])("never cannot loosen to %s", (mode) => {
  expect(decidePolicy("change_credentials", {}, [grant({ action: "change_credentials", mode })], now)).toMatchObject({ mode: "never", grantId: null });
});
test("human reason", () => { expect(decidePolicy("send_external_message", {}, [], now).reason).toBe("内置规则：对外发消息需要先问你"); });
