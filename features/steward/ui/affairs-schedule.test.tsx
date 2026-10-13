import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@chrona/i18n/react";
import en from "@chrona/i18n/messages/en.json";
import { affairSchema, inboundEventSchema, managedToolSchema, TOOL_STATES, SCHEDULE_ITEM_KINDS, type AffairDetail } from "@chrona/contracts";
import { decisionItem } from "../model/fixtures";
import { AffairsPage } from "./affairs-page";
import { AffairDetailPage } from "./affair-detail-page";
import { StewardSchedulePanel } from "./steward-schedule-panel";
const mocks = vi.hoisted(() => ({ affairs: vi.fn(), affair: vi.fn(), createAffair: vi.fn(), updateAffair: vi.fn(), linkEvent: vi.fn(), decideAttention: vi.fn(), schedule: vi.fn(), completeFollowUp: vi.fn(), cancelFollowUp: vi.fn(), generateTool: vi.fn(), runTool: vi.fn(), transitionTool: vi.fn() }));
vi.mock("../model/client", () => ({ createStewardClient: () => mocks }));
const now = "2026-10-13T00:00:00.000Z";
const affair = affairSchema.parse({ id: "a1", title: "Travel plans", summary: "Family trip", goal: "Arrive safely", status: "active", keywords: [], taskId: null, openAttentionCount: 2, createdAt: now, updatedAt: now });
const event = inboundEventSchema.parse({ id: "e1", connectionId: "c1", externalId: "external1", status: "assessed", title: "Trip update", body: "New dates", author: "Sam", url: "https://example.com/message", occurredAt: now, receivedAt: now, affairId: "a1", linkStatus: "suggested", attempts: 1, lastError: null, nextAttemptAt: null });
const detail: AffairDetail = { affair, attention: [], events: [], suggestedEvents: [event], delegations: [], followUps: [], tools: [] };
function show(children: ReactNode) { render(<MemoryRouter><I18nProvider locale="en" messages={en}>{children}</I18nProvider></MemoryRouter>); }
function showDetail() { show(<AffairDetailPage workspaceId="w1" affairId="a1" />); }
afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); mocks.affairs.mockResolvedValue({ items: [affair] }); mocks.affair.mockResolvedValue(detail); mocks.schedule.mockResolvedValue({ items: [] }); });
it("creates an affair with parsed keywords and refreshes", async () => {
  show(<AffairsPage workspaceId="w1" />);
  expect(await screen.findByRole("link", { name: "Travel plans" })).toHaveAttribute("href", "/en/affairs/a1");
  expect(screen.getByText("Open attention items: 2")).toBeVisible();
  await userEvent.type(screen.getByLabelText("Title"), "Research trip"); await userEvent.type(screen.getByLabelText("Summary"), "Background"); await userEvent.type(screen.getByLabelText("Goal"), "Choose route"); await userEvent.type(screen.getByLabelText("Keywords (comma-separated)"), " travel, trains, ,travel ");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(mocks.createAffair).toHaveBeenCalledWith({ title: "Research trip", summary: "Background", goal: "Choose route", keywords: ["travel", "trains"] });
  await waitFor(() => expect(mocks.affairs).toHaveBeenCalledTimes(2));
});
it.each([["Confirm", "confirm"], ["Not related", "reject"]])("%s sends the event decision and affair id", async (name, decision) => {
  showDetail(); const suggestions = await screen.findByRole("region", { name: en.steward.possiblyRelated });
  expect(within(suggestions).getByText(en.steward.unconfirmedMessages)).toBeVisible(); expect(within(suggestions).getByText("Author: Sam")).toBeVisible();
  expect(within(suggestions).getByRole("link", { name: "View source" })).toHaveAttribute("href", event.url);
  expect(within(screen.getByRole("region", { name: "Messages" })).queryByText("Trip update")).toBeNull();
  await userEvent.click(within(suggestions).getByRole("button", { name })); expect(mocks.linkEvent).toHaveBeenCalledWith("e1", { decision, affairId: "a1" }); await waitFor(() => expect(mocks.affair).toHaveBeenCalledTimes(2));
});
it.each(TOOL_STATES)("renders the distinct %s tool label and rationale", async state => {
  const tool = managedToolSchema.parse({ id: "tool1", affairId: "a1", kind: "script", name: "Travel watcher", purpose: "Check travel updates", handlingMode: "reuse_tool", selectionRationale: "Existing tool fits", dataScopes: [], version: 1, state, validationSummary: null, validatedVersion: null, authorizedAt: null, enabledAt: null, lastRunAt: null, lastSuccessAt: null, lastFailureAt: null, createdAt: now, updatedAt: now });
  mocks.affair.mockResolvedValue({ ...detail, tools: [tool] }); showDetail();
  const tools = await screen.findByRole("region", { name: "Tools" }); expect(within(tools).getByText(en.steward.toolStates[state])).toBeVisible(); expect(within(tools).getByText("Handling mode: Reuse tool")).toBeVisible(); expect(within(tools).getByText("Why this tool: Existing tool fits")).toBeVisible();
});
it("keeps the no-tool answer visible after the affair refetch", async () => {
  mocks.generateTool.mockResolvedValue({ created: false, choice: { mode: "direct_answer", rationale: "One answer is enough" } });
  showDetail(); await userEvent.click(await screen.findByText(en.steward.controls.needTool));
  await userEvent.type(screen.getByLabelText("Name"), "Question"); await userEvent.type(screen.getByLabelText("Purpose"), "Answer");
  await userEvent.click(screen.getByRole("combobox", { name: "Specification" })); await userEvent.click(screen.getByRole("option", { name: "Table panel" }));
  await userEvent.click(screen.getByRole("button", { name: "Choose handling" }));
  await waitFor(() => expect(mocks.affair).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Direct answer — No tool needed: One answer is enough")).toBeVisible();
});
it.each([["Done", "completeFollowUp"], ["Cancel", "cancelFollowUp"]] as const)("%s completes only pending follow-ups", async (label, method) => {
  mocks.affair.mockResolvedValue({ ...detail, followUps: ["pending", "done", "cancelled"].map(status => ({ id: status, affairId: "a1", attentionItemId: null, note: `Follow ${status}`, dueAt: now, status, createdAt: now })) });
  showDetail(); const section = await screen.findByRole("region", { name: "Follow-ups" });
  expect(within(section).getAllByRole("button")).toHaveLength(2);
  await userEvent.click(within(section).getByRole("button", { name: label })); expect(mocks[method]).toHaveBeenCalledWith("pending");
  await waitFor(() => expect(mocks.affair).toHaveBeenCalledTimes(2));
});
it("shows not-found separately from errors", async () => { mocks.affair.mockRejectedValue({ status: 404 }); showDetail(); expect(await screen.findByRole("heading", { name: en.steward.affairNotFound })).toBeVisible(); expect(screen.queryByRole("alert")).toBeNull(); });
it("shows loading, error and successful retry", async () => { mocks.affair.mockRejectedValueOnce({ status: 500 }).mockResolvedValue(detail); showDetail(); expect(screen.getByRole("status")).toHaveTextContent(en.steward.loading); expect(await screen.findByRole("alert")).toHaveTextContent(en.steward.error); await userEvent.click(screen.getByRole("button", { name: "Reload" })); expect(await screen.findByRole("heading", { name: "Travel plans" })).toBeVisible(); });
it("updates status through the affair endpoint", async () => {
  showDetail(); await userEvent.click(await screen.findByRole("combobox", { name: "Status" }));
  await userEvent.click(await screen.findByRole("option", { name: "Paused" }));
  expect(mocks.updateAffair).toHaveBeenCalledWith("a1", { status: "paused" });
});
it("reuses attention decisions and excludes resolved items", async () => {
  mocks.affair.mockResolvedValue({ ...detail, attention: [decisionItem(), { ...decisionItem(), id: "resolved", status: "resolved", title: "Already settled" }] }); showDetail();
  const section = await screen.findByRole("region", { name: "Needs you" }); expect(within(section).queryByText("Already settled")).toBeNull();
  await userEvent.click(within(section).getByRole("button", { name: "Approve" })); expect(mocks.decideAttention).toHaveBeenCalledWith("attention-1", { decision: "approve" });
});
it("renders confirmed messages, completed follow-ups and empty detail sections", async () => {
  mocks.affair.mockResolvedValue({ ...detail, suggestedEvents: [], events: [{ ...event, linkStatus: "confirmed" }], followUps: [{ id: "f1", affairId: "a1", attentionItemId: null, note: "Book tickets", dueAt: now, status: "done", createdAt: now }] }); showDetail();
  const messages = await screen.findByRole("region", { name: "Messages" }); expect(within(messages).getByText("Trip update")).toBeVisible(); expect(within(messages).getByText(now)).toHaveAttribute("datetime", now);
  expect(screen.queryByRole("region", { name: en.steward.possiblyRelated })).toBeNull(); expect(within(screen.getByRole("region", { name: "Follow-ups" })).getByText("Done")).toBeVisible(); expect(within(screen.getByRole("region", { name: "Tools" })).getByText(en.steward.empty)).toBeVisible();
});
it("blocks uncertain mutations until reload", async () => { mocks.linkEvent.mockRejectedValue(new Error("offline")); showDetail(); await userEvent.click(await screen.findByRole("button", { name: "Confirm" })); expect(await screen.findByRole("alert")).toHaveTextContent(en.steward.mutationError); expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled(); });
it("renders all schedule kinds and an explicit not-confirmed warning", async () => {
  mocks.schedule.mockResolvedValue({ items: SCHEDULE_ITEM_KINDS.map(kind => ({ id: kind, kind, title: `Item ${kind}`, startsAt: now, endsAt: null, affairId: null, sourceRef: null, confirmed: kind !== "unconfirmed_suggestion" })) });
  show(<StewardSchedulePanel workspaceId="w1" />);
  for (const kind of SCHEDULE_ITEM_KINDS) expect(await screen.findByText(en.steward.scheduleKinds[kind])).toBeVisible();
  const row = screen.getByText("Item unconfirmed_suggestion").closest("li")!; expect(within(row).getByText(en.steward.notConfirmed)).toBeVisible();
  expect(mocks.schedule).toHaveBeenCalledWith({ from: expect.any(String), to: expect.any(String) }, expect.any(AbortSignal));
});
it("schedule error retries into empty state", async () => { mocks.schedule.mockRejectedValueOnce(new Error("offline")); show(<StewardSchedulePanel workspaceId="w1" />); expect(screen.getByRole("status")).toHaveTextContent(en.steward.loading); await screen.findByRole("alert"); await userEvent.click(screen.getByRole("button", { name: "Reload" })); expect(await screen.findByText(en.steward.empty)).toBeVisible(); });
