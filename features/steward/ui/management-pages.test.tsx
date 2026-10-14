import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@chrona/i18n/react";
import en from "@chrona/i18n/messages/en.json";
import zh from "@chrona/i18n/messages/zh.json";
import { delegationSchema, connectionSchema, notificationSchema, NOTIFICATION_STATUSES, PILOT_DENIED_ACTIONS } from "@chrona/contracts";
import { DelegationsPage } from "./delegations-page";
import { ConnectionsPage } from "./connections-page";
const mocks = vi.hoisted(() => ({ delegations: vi.fn(), connections: vi.fn(), events: vi.fn(), notifications: vi.fn(), transitionDelegation: vi.fn(), proposeDelegation: vi.fn(), transitionConnection: vi.fn(), syncConnection: vi.fn(), createConnection: vi.fn(), acknowledgeNotification: vi.fn(), retryNotification: vi.fn() }));
vi.mock("../model/client", () => ({ createStewardClient: () => mocks }));
const now = "2026-10-13T00:00:00.000Z";
const delegation = delegationSchema.parse({ id: "d1", revision: 7, status: "proposed", affairId: null, connectionId: "c1", purpose: "Watch updates", originalWording: "Tell me when this changes", cadenceSeconds: 300, allowedActions: ["read_source"], askFirstActions: ["run_tool"], notification: {}, limits: {}, grantedAt: null, expiresAt: null, lastCheckAt: now, lastSuccessAt: now, lastFailureAt: null, lastError: null, createdAt: now, updatedAt: now });
const connection = connectionSchema.parse({ id: "c1", kind: "local_test", label: "Test source", mode: "poll", status: "active", readScopes: ["inbox"], writeScopes: [], pollIntervalSeconds: 300, baselineAt: now, lastSuccessAt: now, lastFailureAt: null, lastError: null, nextCheckAt: now, coverageNote: "Polling only; older items are not processed.", pendingEvents: 2, failedEvents: 1 });
function show(page: "delegations" | "connections", locale: "en" | "zh" = "en") { render(<I18nProvider locale={locale} messages={locale === "en" ? en : zh}>{page === "delegations" ? <DelegationsPage workspaceId="w1" /> : <ConnectionsPage workspaceId="w1" />}</I18nProvider>); }
afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); mocks.delegations.mockResolvedValue({ items: [delegation] }); mocks.connections.mockResolvedValue({ items: [connection] }); mocks.events.mockResolvedValue({ items: [] }); mocks.notifications.mockResolvedValue({ items: [] }); });
it.each([ ["proposed", "Grant", "grant"], ["active", "Pause", "pause"], ["paused", "Resume", "resume"] ] as const)("%s sends revision-protected %s", async (status, label, action) => {
  mocks.delegations.mockResolvedValue({ items: [{ ...delegation, status }] }); show("delegations");
  expect(await screen.findByText("Tell me when this changes")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: label }));
  expect(mocks.transitionDelegation).toHaveBeenCalledWith("d1", { action, expectedRevision: 7 });
  await waitFor(() => expect(mocks.delegations).toHaveBeenCalledTimes(2));
});
it.each(["revoked", "expired"] as const)("%s offers no transitions", async status => { mocks.delegations.mockResolvedValue({ items: [{ ...delegation, status }] }); show("delegations"); expect(await screen.findByText(en.steward.statuses[status])).toBeVisible(); for (const name of ["Grant", "Pause", "Resume", "Revoke"]) expect(screen.queryByRole("button", { name })).toBeNull(); });
it("reloads a stale revision without retrying the grant", async () => { mocks.transitionDelegation.mockRejectedValue({ status: 409 }); show("delegations"); await userEvent.click(await screen.findByRole("button", { name: "Grant" })); expect(await screen.findByText(en.steward.stale)).toBeVisible(); await waitFor(() => expect(mocks.delegations).toHaveBeenCalledTimes(2)); expect(mocks.transitionDelegation).toHaveBeenCalledTimes(1); });
it("keeps pilot-denied actions disabled and proposes without granting", async () => {
  show("delegations"); await screen.findByText("Watch updates");
  for (const action of PILOT_DENIED_ACTIONS) for (const checkbox of screen.getAllByRole("checkbox", { name: en.steward.actionLabels[action] })) expect(checkbox).toBeDisabled();
  expect(screen.getByText(en.steward.pilotDenied)).toBeVisible(); expect(screen.getByText(en.steward.proposalHint)).toBeVisible();
  await userEvent.type(screen.getByLabelText("Purpose"), "Watch new messages"); await userEvent.type(screen.getByLabelText("Original wording"), "Keep me informed"); await userEvent.type(screen.getByLabelText("Cadence (seconds)"), "600");
  await userEvent.click(screen.getAllByRole("checkbox", { name: "Read source" })[0]); await userEvent.click(screen.getByRole("button", { name: "Propose delegation" }));
  expect(mocks.proposeDelegation).toHaveBeenCalledWith({ purpose: "Watch new messages", originalWording: "Keep me informed", cadenceSeconds: 600, allowedActions: ["read_source"], askFirstActions: [] }); expect(mocks.transitionDelegation).not.toHaveBeenCalled();
});
it.each(["proposed", "active", "paused"] as const)("revokes %s delegations with their revision", async status => { mocks.delegations.mockResolvedValue({ items: [{ ...delegation, status }] }); show("delegations"); await userEvent.click(await screen.findByRole("button", { name: "Revoke" })); expect(mocks.transitionDelegation).toHaveBeenCalledWith("d1", { action: "revoke", expectedRevision: 7 }); });
it.each([["active", "Pause", "pause"], ["paused", "Resume", "resume"], ["failing", "Revoke", "revoke"]] as const)("connection %s sends %s", async (status, label, action) => { mocks.connections.mockResolvedValue({ items: [{ ...connection, status }] }); show("connections"); await userEvent.click(await screen.findByRole("button", { name: label })); expect(mocks.transitionConnection).toHaveBeenCalledWith("c1", { action }); });
it.each(["en", "zh"] as const)("labels all source kinds in %s; only local_test is test data", async locale => {
  const copy = (locale === "en" ? en : zh).steward;
  mocks.connections.mockResolvedValue({ items: (["local_test", "reddit_inbox", "chino_service_health"] as const).map(kind => ({ ...connection, id: kind, kind, label: `Source ${kind}` })) });
  show("connections", locale); await screen.findByText("Source chino_service_health");
  for (const kind of ["local_test", "reddit_inbox", "chino_service_health"] as const) {
    const row = screen.getByText(`Source ${kind}`).closest("li")!;
    expect(within(row).getByText(copy[kind])).toBeVisible();
    expect(within(row).queryByText(copy.testData) !== null).toBe(kind === "local_test");
  }
});
it("creates a labelled test connection without claiming authorization", async () => { show("connections"); await screen.findByText("Test source"); await userEvent.type(screen.getByLabelText("Label"), "Pilot inbox"); await userEvent.click(screen.getByRole("button", { name: "Create" })); expect(mocks.createConnection).toHaveBeenCalledWith({ kind: "local_test", label: "Pilot inbox" }); });
it("keeps an unconfirmed mutation blocked until reload", async () => { mocks.transitionDelegation.mockRejectedValue(new Error("offline")); show("delegations"); await userEvent.click(await screen.findByRole("button", { name: "Grant" })); expect(await screen.findByRole("alert")).toHaveTextContent(en.steward.mutationError); expect(screen.getByRole("button", { name: "Grant" })).toBeDisabled(); await userEvent.click(screen.getByRole("button", { name: "Reload" })); expect(await screen.findByRole("button", { name: "Grant" })).toBeEnabled(); });
it("shows test coverage and sync outcomes", async () => { mocks.syncConnection.mockResolvedValue({ received: 3, duplicates: 2, baseline: true }); show("connections"); expect(await screen.findByText("Test data")).toBeVisible(); expect(screen.getByText(connection.coverageNote)).toBeVisible(); await userEvent.click(screen.getByRole("button", { name: "Sync now" })); expect(mocks.syncConnection).toHaveBeenCalledWith("c1"); expect(await screen.findByText("Received: 3; Duplicates: 2; Baseline: Yes")).toBeVisible(); });
it.each(["needs_authorization", "failing"] as const)("shows %s honestly", async status => { mocks.connections.mockResolvedValue({ items: [{ ...connection, status }] }); show("connections"); expect(await screen.findByText(en.steward.statuses[status])).toBeVisible(); if (status === "needs_authorization") expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull(); });
it("offers acknowledgment only for sent and uncertain, preserving distinct delivery labels", async () => {
  mocks.notifications.mockResolvedValue({ items: NOTIFICATION_STATUSES.map(status => notificationSchema.parse({ id: status, attentionItemId: null, channel: "local_test", status, title: `Notice ${status}`, body: "Test notice", link: null, attempts: 1, lastError: null, nextAttemptAt: null, generatedAt: now, sentAt: null, acknowledgedAt: null })) });
  show("connections"); await screen.findByText("Test source"); await userEvent.click(screen.getByText("Delivery log"));
  for (const status of NOTIFICATION_STATUSES) { const row = screen.getByText(`Notice ${status}`).closest("li")!; expect(within(row).getByText(en.steward.notificationStatuses[status])).toBeVisible(); expect(within(row).queryByRole("button", { name: "Acknowledge" }) !== null).toBe(status === "sent" || status === "uncertain"); expect(within(row).queryByRole("button", { name: "Retry" }) !== null).toBe(status === "failed"); expect(within(row).getByText("Channel: Test sink")).toBeVisible(); }
  expect(screen.getByText(en.steward.controls.sentMeaning)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Retry" })); expect(mocks.retryNotification).toHaveBeenCalledWith("failed");
  await userEvent.click(screen.getAllByRole("button", { name: "Acknowledge" })[0]); expect(mocks.acknowledgeNotification).toHaveBeenCalledWith("sent");
});
it.each(["delegations", "connections"] as const)("%s loading, error and retry", async page => { mocks[page].mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ items: [] }); show(page); expect(screen.getAllByRole("status")[0]).toHaveTextContent(en.steward.loading); await screen.findByRole("alert"); await userEvent.click(screen.getByRole("button", { name: "Reload" })); await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(en.steward.empty)); });
