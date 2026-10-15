import { ACTIONS, DEFAULT_POLICY, type Grant, type GrantMode } from "@chrona/contracts";
const strictness: Record<GrantMode, number> = { auto: 0, notify_after: 1, preapproved: 2, ask: 3, never: 4 };
export function activeGrants(grants: Grant[], now: number) {
  return grants.filter(g => !g.revokedAt && !(g.once && g.consumedAt) && (!g.expiresAt || Date.parse(g.expiresAt) > now));
}
export function policyRows(grants: Grant[], now: number) {
  const active = activeGrants(grants, now);
  return ACTIONS.map(action => {
    const editable = DEFAULT_POLICY[action] !== "never";
    const grant = editable ? active.filter(g => g.action === action && g.scope.kind === "global").sort((a, b) => strictness[b.mode] - strictness[a.mode])[0] : undefined;
    return { action, editable, mode: grant?.mode ?? DEFAULT_POLICY[action], grant };
  });
}
export function parseNotificationForm(cap: string, start: string, end: string, digestAt: string, quiet: boolean) {
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!/^\d+$/.test(cap) || Number(cap) > 50 || !time.test(digestAt) || (quiet && (!time.test(start) || !time.test(end) || start === end))) return null;
  return { dailyCap: Number(cap), quietHours: quiet ? { start, end } : null, digestAt };
}
