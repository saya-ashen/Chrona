import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@chrona/i18n/react";
import en from "@chrona/i18n/messages/en.json";
import zh from "@chrona/i18n/messages/zh.json";
import { WORK_STATUSES, type Work } from "@chrona/contracts";
import type { StewardClient } from "../model/client";
import { workFixture, workTime } from "../model/work-fixtures";
import { WorkSection } from "./work-section";
const client = { respondWork: vi.fn().mockResolvedValue({}), acceptWork: vi.fn().mockResolvedValue({}) } as unknown as StewardClient;
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function show(work: Work, locale: "en" | "zh" = "en", refresh = vi.fn()) { render(<MemoryRouter><I18nProvider locale={locale} messages={locale === "en" ? en : zh}><WorkSection works={[work]} client={client} refresh={refresh} /></I18nProvider></MemoryRouter>); return refresh; }
it.each(WORK_STATUSES)("renders %s distinctly; only ready results offer acceptance", status => {
  show(workFixture(status), "zh"); expect(screen.getByText(zh.steward.work.statuses[status])).toBeVisible();
  expect(screen.queryByRole("button", { name: zh.steward.work.accept }) !== null).toBe(status === "result_ready");
  expect(screen.queryByLabelText(zh.steward.work.feedback) !== null).toBe(["result_ready", "accepted"].includes(status));
  expect(document.querySelector("b")).toBeNull();
});
it("posts an answer and refreshes without interpreting text as permission", async () => {
  const work = workFixture("waiting_input"); work.question = { askedAt: workTime, questions: [{ question: "Which city?", why: "Needed for search" }] }; const refresh = show(work);
  expect(screen.getByText("Why it matters: Needed for search")).toBeVisible();
  await userEvent.type(screen.getByLabelText("Answer"), "Shanghai"); await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(client.respondWork).toHaveBeenCalledWith("w1", { kind: "answer", text: "Shanghai" }); await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
});
it("accepts a published result through the owner command", async () => { const refresh = show(workFixture("result_ready")); await userEvent.click(screen.getByRole("button", { name: "Accept result" })); expect(client.acceptWork).toHaveBeenCalledWith("w1"); await waitFor(() => expect(refresh).toHaveBeenCalledOnce()); });
it("shows authorization, progress, handling, attempts and retry error honestly", () => {
  const w = workFixture("waiting_authorization"); w.authorization = { missing: "permission", capability: "Read inbox", why: "Need messages", howToGrant: "Review the proposed delegation", askedAt: workTime }; w.progress = [{ at: workTime, summary: "Read context", findings: ["Missing access"], nextSteps: ["Ask owner"] }]; w.handling = { mode: "agent_iteration", rationale: "Needs research" }; w.attempts = [{ id: "attempt", number: 1, status: "requested_authorization", wakeReason: "new_request", toolCalls: [], error: "No access", startedAt: workTime, endedAt: workTime }]; w.nextRunAt = workTime; w.lastError = "Unavailable";
  show(w); for (const text of ["Permission: Read inbox", "Review the proposed delegation", "Read context", "Last error: Unavailable"]) expect(screen.getByText(text)).toBeVisible();
});
it("has matching nonempty work translations in both locales", () => { function keys(value: object): string[] { return Object.entries(value).flatMap(([k,v]) => typeof v === "object" ? keys(v).map(x => `${k}.${x}`) : (expect(v).not.toBe(""), [k])); } expect(keys(en.steward.work)).toEqual(keys(zh.steward.work)); for (const s of WORK_STATUSES) expect(en.steward.work.statuses[s]).toBeTruthy(); });
