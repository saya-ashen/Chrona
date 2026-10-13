import { describe, expect, test } from "bun:test";
import { DELEGATION_STATUSES, DELEGATION_TRANSITIONS, PILOT_DENIED_ACTIONS, permissionDecisionSchema, type DelegationStatus, type StewardAction } from "@chrona/contracts/steward";
import { decidePermission, InvalidDelegationTransitionError, nextDelegationStatus, type PermissionDelegation } from "./permission";

const now = new Date("2026-10-13T12:00:00Z");
const active: PermissionDelegation = {
  id: "delegation", revision: 3, status: "active", expiresAt: null,
  allowedActions: ["summarize"], askFirstActions: [],
};

describe("decidePermission", () => {
  const cases: { name: string; delegation: PermissionDelegation | null | undefined; action?: StewardAction; outcome: string; clock?: Date }[] = [
    { name: "missing", delegation: null, outcome: "denied" },
    { name: "undefined", delegation: undefined, outcome: "denied" },
    ...DELEGATION_STATUSES.filter((status) => status !== "active").map((status) => ({ name: status, delegation: { ...active, status }, outcome: "denied" })),
    { name: "allowed", delegation: active, outcome: "allowed" },
    { name: "unlisted", delegation: active, action: "notify_user", outcome: "denied" },
    { name: "confirmation", delegation: { ...active, allowedActions: [], askFirstActions: ["summarize"] }, outcome: "ask_first" },
    { name: "confirmation wins", delegation: { ...active, askFirstActions: ["summarize"] }, outcome: "ask_first" },
    { name: "expired", delegation: { ...active, expiresAt: "2026-10-13T11:59:59Z" }, outcome: "denied" },
    { name: "expiry boundary", delegation: { ...active, expiresAt: now }, outcome: "denied" },
    { name: "future expiry", delegation: { ...active, expiresAt: "2026-10-13T12:00:01Z" }, outcome: "allowed" },
    { name: "invalid expiry", delegation: { ...active, expiresAt: "invalid" }, outcome: "denied" },
    { name: "invalid clock", delegation: active, clock: new Date(NaN), outcome: "denied" },
    ...PILOT_DENIED_ACTIONS.map((action) => ({ name: `pilot blocks ${action}`, action, delegation: { ...active, allowedActions: [action], askFirstActions: [action] }, outcome: "denied" })),
  ];
  test.each(cases)("$name", ({ delegation, action = "summarize", outcome, clock = now }) => {
    const snapshot = JSON.stringify(delegation);
    const decision = decidePermission({ action, delegation, now: clock });
    expect(String(decision.outcome)).toBe(outcome);
    expect(decision.delegationId).toBe(delegation?.id ?? null);
    expect(decision.delegationRevision).toBe(delegation?.revision ?? null);
    expect(permissionDecisionSchema.safeParse(decision).success).toBe(true);
    expect(JSON.stringify(delegation)).toBe(snapshot);
  });
});

describe("nextDelegationStatus", () => {
  const valid: Record<string, DelegationStatus> = {
    "proposed:grant": "active", "active:pause": "paused", "paused:resume": "active",
    "proposed:revoke": "revoked", "active:revoke": "revoked", "paused:revoke": "revoked", "expired:revoke": "revoked",
  };
  test.each(DELEGATION_STATUSES.flatMap((current) => DELEGATION_TRANSITIONS.map((transition) => ({ current, transition }))))("$current + $transition", ({ current, transition }) => {
    const target = valid[`${current}:${transition}`];
    if (target) expect(nextDelegationStatus(current, transition)).toBe(target);
    else expect(() => nextDelegationStatus(current, transition)).toThrow(InvalidDelegationTransitionError);
  });
});
