import { PILOT_DENIED_ACTIONS, type DelegationStatus, type ConnectionStatus, type StewardAction, type NotificationStatus } from "@chrona/contracts/steward";
export type DelegationTransition = "grant" | "pause" | "resume" | "revoke";
const transitions: Record<DelegationStatus, DelegationTransition[]> = { proposed: ["grant", "revoke"], active: ["pause", "revoke"], paused: ["resume", "revoke"], revoked: [], expired: [] };
export function delegationTransitions(status: DelegationStatus) { return transitions[status]; }
export function pilotDenied(action: StewardAction) { return (PILOT_DENIED_ACTIONS as readonly string[]).includes(action); }
export function staleResponse(error: unknown) { return typeof error === "object" && error !== null && "status" in error && error.status === 409; }
export function connectionTransitions(status: ConnectionStatus): ("pause" | "resume" | "revoke")[] { return status === "revoked" ? [] : status === "paused" ? ["resume", "revoke"] : ["pause", "revoke"]; }
export function canSync(status: ConnectionStatus) { return status === "active" || status === "failing"; }
export function canAcknowledge(status: NotificationStatus) { return status === "sent" || status === "uncertain"; }
export function connectionWarning(status: ConnectionStatus) { return status === "needs_authorization" || status === "failing"; }
