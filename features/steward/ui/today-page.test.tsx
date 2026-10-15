import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import zh from "@chrona/i18n/messages/zh.json";
import { workFixture } from "../model/work-fixtures";
import { TodayPage } from "./today-page";
import { decisionItem, emptyToday, publishedResult, timestamp } from "../model/fixtures";
import { I18nProvider } from "@chrona/i18n/react";
import en from "@chrona/i18n/messages/en.json";
const mocks = vi.hoisted(() => ({ today: vi.fn(), decideAttention: vi.fn(), openWorks: vi.fn(), createWork: vi.fn() }));
vi.mock("../model/client", () => ({ createStewardClient: () => mocks }));
function show(locale: "en" | "zh" = "en") { render(<MemoryRouter><I18nProvider locale={locale} messages={locale === "en" ? en : zh}><TodayPage workspaceId="workspace-test" /></I18nProvider></MemoryRouter>); }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(Date, "now").mockReturnValue(Date.parse(timestamp)); mocks.today.mockResolvedValue(emptyToday()); mocks.openWorks.mockResolvedValue([]); mocks.decideAttention.mockResolvedValue(decisionItem()); });
describe("Today page", () => {
  it("shows in-progress work linked to its affair and creates a request", async () => {
    mocks.openWorks.mockResolvedValue([workFixture("running")]); show();
    expect(await screen.findByRole("link", { name: "Research <b>plain text</b>" })).toHaveAttribute("href", "/en/affairs/a1");
    expect(screen.getByText(en.steward.work.statuses.running)).toBeVisible();
    await userEvent.type(screen.getByLabelText(en.steward.work.ask), "Compare trains"); await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(mocks.createWork).toHaveBeenCalledWith("Compare trains"); await waitFor(() => expect(mocks.openWorks).toHaveBeenCalledTimes(2));
  });
  it("shows the chat reply code and user feedback as plain text", async () => {
    const view = emptyToday(); view.decisions = [{ ...decisionItem(), replyRef: "K7QM", userNote: "**保留** <script>example</script>" }]; mocks.today.mockResolvedValue(view); show("zh");
    expect(await screen.findByText("回复码 K7QM")).toBeVisible(); expect(screen.getByText("你的反馈")).toBeVisible(); expect(screen.getByText("**保留** <script>example</script>")).toBeVisible(); expect(document.querySelector("script")).toBeNull();
  });
  it("announces loading", () => { mocks.today.mockReturnValue(new Promise(() => {})); show(); expect(screen.getByRole("status")).toHaveTextContent("Loading"); });
  it("shows read errors and reload action", async () => { mocks.today.mockRejectedValue(new Error("offline")); show(); expect(await screen.findByRole("alert")).toHaveTextContent(en.steward.error); expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled(); });
  it("shows a healthy empty state", async () => { show(); expect(await screen.findByText(en.steward.allClear)).toBeVisible(); });
  it("renders evidence, status and next action; approves then refreshes", async () => {
    const view = emptyToday(); view.decisions = [decisionItem()]; mocks.today.mockResolvedValueOnce(view).mockResolvedValue(emptyToday()); show();
    expect(await screen.findByRole("heading", { name: "Confirm follow-up" })).toBeVisible();
    expect(screen.getByText("Your response is due sooner")).toBeVisible();
    expect(screen.getByText("Approve the follow-up")).toBeVisible(); expect(screen.getByText("Open")).toBeVisible();
    expect(screen.getByRole("link", { name: "Source message" })).toHaveAttribute("href", "https://example.com/evidence");
    expect(screen.getByText("Please reply tomorrow")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(mocks.decideAttention).toHaveBeenCalledWith("attention-1", { decision: "approve" });
    await waitFor(() => expect(mocks.today).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(en.steward.allClear)).toBeVisible();
  });
  it("shows unavailable assessor and pending age without claiming all-clear", async () => {
    const view = emptyToday(); view.health.assessor.available = false; view.health.pendingEvents = 3; view.health.oldestPendingAt = timestamp; mocks.today.mockResolvedValue(view); show();
    expect(await screen.findByRole("alert")).toHaveTextContent(en.steward.assessor);
    expect(screen.getByText(timestamp)).toBeVisible(); expect(screen.queryByText(en.steward.allClear)).not.toBeInTheDocument();
  });
  it.each(["en", "zh"] as const)("renders published versions beside result attention in %s", async locale => {
    const view = emptyToday(), copy = (locale === "en" ? en : zh).steward;
    view.recentResults = [publishedResult()]; view.results = [{ ...decisionItem(), kind: "result", title: "Result attention" }];
    mocks.today.mockResolvedValue(view); show(locale);
    const link = await screen.findByRole("link", { name: "Published report" });
    expect(link).toHaveAttribute("href", `/${locale}/tasks/task-1/results`);
    expect(screen.getByRole("heading", { name: "Result attention" })).toBeVisible();
    expect(screen.getByText(`${copy.resultTask}: Research task`)).toBeVisible();
    expect(screen.getByText(`${copy.resultVersion}: 2`)).toBeVisible();
    expect(screen.getByText(copy.resultReviews.unreviewed)).toBeVisible();
    expect(screen.getByText(timestamp)).toHaveAttribute("datetime", timestamp);
    expect(screen.queryByText(copy.allClear)).toBeNull();
  });
  it.each(["accept", "request_changes", "reject"] as const)("preserves the %s review label", async reviewState => {
    const view = emptyToday(); view.recentResults = [{ ...publishedResult(), reviewState }]; mocks.today.mockResolvedValue(view); show();
    expect(await screen.findByText(en.steward.resultReviews[reviewState])).toBeVisible();
  });
  it.each((["en", "zh"] as const).flatMap(locale => (["rule-assessor-v1", "pi-assessor-v1", "external-agent"] as const).map(name => ({ locale, name }))))("labels $name honestly in $locale with unavailable and last error", async ({ locale, name }) => {
    const view = emptyToday(), copy = (locale === "en" ? en : zh).steward;
    view.health.assessor = { name, available: false, lastError: "Assessment unavailable" }; mocks.today.mockResolvedValue(view); show(locale);
    expect(await screen.findByText(`${copy.lastError}: Assessment unavailable`)).toBeVisible();
    expect(screen.getByRole("region", { name: copy.controls.stewardStatus })).toHaveTextContent(`${copy.assessors[name]} (${copy.controls.unavailable})`);
  });
  it("keeps an unconfirmed decision visible and offers reload", async () => {
    const view = emptyToday(); view.decisions = [decisionItem()]; mocks.today.mockResolvedValue(view); mocks.decideAttention.mockRejectedValue(new Error("offline")); show();
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(en.steward.decisionError);
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(await screen.findByRole("button", { name: "Approve" })).toBeEnabled();
  });
  it.each(["resolved", "snoozed"] as const)("shows %s status without decision buttons", async status => {
    const view = emptyToday(); view.decisions = [{ ...decisionItem(), status }]; mocks.today.mockResolvedValue(view); show();
    expect(await screen.findByText(en.steward.statuses[status])).toBeVisible(); expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});
