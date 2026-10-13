import { expect, it } from "vitest";
import { STEWARD_ACTIONS, NOTIFICATION_STATUSES } from "@chrona/contracts";
import { delegationTransitions, pilotDenied, canAcknowledge, staleResponse, canSync, connectionTransitions } from "./management";
it.each([ ["proposed", ["grant", "revoke"]], ["active", ["pause", "revoke"]], ["paused", ["resume", "revoke"]], ["revoked", []], ["expired", []] ] as const)("delegation %s transitions", (status, expected) => expect(delegationTransitions(status)).toEqual(expected));
it.each(STEWARD_ACTIONS)("pilot permission for %s", action => expect(pilotDenied(action)).toBe(["reply_external", "mark_read_external", "delete_external"].includes(action)));
it.each(NOTIFICATION_STATUSES)("acknowledgment for %s", status => expect(canAcknowledge(status)).toBe(status === "sent" || status === "uncertain"));
it.each([ ["active", true, ["pause", "revoke"]], ["failing", true, ["pause", "revoke"]], ["needs_authorization", false, ["pause", "revoke"]], ["paused", false, ["resume", "revoke"]], ["revoked", false, []] ] as const)("connection %s actions", (status, sync, transitions) => { expect(canSync(status)).toBe(sync); expect(connectionTransitions(status)).toEqual(transitions); });
it.each([[{ status: 409 }, true], [{ status: 500 }, false], [null, false], [new Error("offline"), false]])("recognizes stale responses", (error, expected) => expect(staleResponse(error)).toBe(expected));
