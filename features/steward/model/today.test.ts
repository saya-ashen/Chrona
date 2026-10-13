import { describe, expect, it } from "vitest";
import { attentionDecisions, decisionInput, deriveToday, evidenceHref, TODAY_SECTIONS } from "./today";
import { decisionItem, emptyToday, timestamp } from "./fixtures";
import type { AttentionKind, AttentionStatus, StewardHealth } from "@chrona/contracts/steward";

describe("Today projection", () => {
  it("orders sections and distinguishes all-clear from no items", () => {
    expect(deriveToday(emptyToday())).toMatchObject({ empty: true, allClear: true });
    const view = emptyToday(); view.decisions.push(decisionItem());
    const model = deriveToday(view);
    expect(model.sections.map(section => section.key)).toEqual(TODAY_SECTIONS);
    expect(model.empty).toBe(false); expect(model.allClear).toBe(false);
  });
  it.each<[string, Partial<StewardHealth>]>([
    ["assessor", { assessor: { available: false, name: "test", lastError: null } }],
    ["pendingEvents", { pendingEvents: 2, oldestPendingAt: timestamp }],
    ["failedEvents", { failedEvents: 1 }], ["failedNotifications", { failedNotifications: 1 }], ["failingConnections", { failingConnections: 1 }],
  ])("shows %s health even with no attention items", (kind, patch) => {
    const view = emptyToday(); Object.assign(view.health, patch);
    const model = deriveToday(view);
    expect(model.empty).toBe(true); expect(model.allClear).toBe(false);
    expect(model.issues[0].kind).toBe(kind);
    if (kind === "pendingEvents") expect(model.issues[0]).toMatchObject({ count: 2, since: timestamp });
  });
  it.each<[AttentionKind, string[]]>([
    ["decision", ["approve", "decline", "snooze"]], ["suggestion", ["approve", "dismiss", "less_often", "snooze"]],
    ["commitment", ["done", "snooze"]], ["change", ["dismiss", "done"]], ["result", ["dismiss", "done"]], ["failure", ["dismiss", "done"]],
  ])("offers appropriate %s decisions", (kind, expected) => expect(attentionDecisions({ kind, status: "open" })).toEqual(expected));
  it.each<AttentionStatus>(["resolved", "dismissed", "snoozed"])("does not offer actions for %s items", status => expect(attentionDecisions({ kind: "decision", status })).toEqual([]));
  it("snoozes for an explicit 24 hours", () => expect(decisionInput("snooze", new Date(timestamp))).toEqual({ decision: "snooze", snoozeUntil: "2026-10-14T12:00:00.000Z" }));
  it.each(["javascript:alert(1)", "data:text/html,unsafe", "not a url"])("rejects unsafe evidence %s", url => expect(evidenceHref(url)).toBeUndefined());
});
