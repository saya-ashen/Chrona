import {
  PILOT_DENIED_ACTIONS,
  type DELEGATION_TRANSITIONS,
  type Delegation,
  type DelegationStatus,
  type PermissionDecision,
  type StewardAction,
} from "@chrona/contracts/steward";

export type PermissionDelegation = Pick<Delegation,
  "id" | "revision" | "status" | "allowedActions" | "askFirstActions"
> & { expiresAt: string | Date | null };

/** Fail closed; external content never supplies permission. No clock or I/O access. */
export function decidePermission({ action, delegation, now }: {
  action: StewardAction;
  delegation: PermissionDelegation | null | undefined;
  now: Date;
}): PermissionDecision {
  const decision = (outcome: PermissionDecision["outcome"], reason: string): PermissionDecision => ({
    action, outcome, reason,
    delegationId: delegation?.id ?? null,
    delegationRevision: delegation?.revision ?? null,
  });
  if (PILOT_DENIED_ACTIONS.some((denied) => denied === action)) {
    return decision("denied", "Action prohibited by the read-only pilot.");
  }
  if (!delegation || delegation.status !== "active") {
    return decision("denied", "An active delegation is required.");
  }
  const expires = delegation.expiresAt === null ? null : new Date(delegation.expiresAt).getTime();
  if (!Number.isFinite(now.getTime()) || (expires !== null && (!Number.isFinite(expires) || expires <= now.getTime()))) {
    return decision("denied", "Delegation expired or permission time is invalid.");
  }
  if (delegation.askFirstActions.includes(action)) {
    return decision("ask_first", "Delegation requires confirmation for this action.");
  }
  if (delegation.allowedActions.includes(action)) {
    return decision("allowed", "Action explicitly allowed by the delegation.");
  }
  return decision("denied", "Action is outside the delegation.");
}

export type DelegationTransition = (typeof DELEGATION_TRANSITIONS)[number];

export class InvalidDelegationTransitionError extends Error {
  readonly code = "INVALID_DELEGATION_TRANSITION";
  constructor(readonly current: DelegationStatus, readonly transition: DelegationTransition) {
    super(`Cannot ${transition} delegation in ${current} state.`);
    this.name = "InvalidDelegationTransitionError";
  }
}

export function nextDelegationStatus(current: DelegationStatus, transition: DelegationTransition): DelegationStatus {
  if (transition === "grant" && current === "proposed") return "active";
  if (transition === "pause" && current === "active") return "paused";
  if (transition === "resume" && current === "paused") return "active";
  if (transition === "revoke" && ["proposed", "active", "paused", "expired"].includes(current)) return "revoked";
  throw new InvalidDelegationTransitionError(current, transition);
}
