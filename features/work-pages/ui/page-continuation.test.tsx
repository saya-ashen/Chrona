import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@chrona/i18n/react";
import en from "@chrona/i18n/messages/en.json";
import { PageContinuationPanel, PageUpdateSummary } from "./page-continuation";
import { pageRequest } from "../model/client";
vi.mock("../model/client", () => ({ pageRequest: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const scope = { taskId: "task", occurrenceId: null };
function panel() { return render(<I18nProvider locale="en" messages={en}><PageContinuationPanel scope={scope} versionId="v1" refreshKey={0} onSaved={() => {}} /></I18nProvider>); }
it("loading and read failure do not pretend that there is no pending request", async () => {
  vi.mocked(pageRequest).mockReturnValueOnce(new Promise(() => {})); const first = panel();
  expect(screen.getByRole("status")).toHaveTextContent("Opening"); expect(screen.queryByRole("button", { name: "Ask your Agent to continue" })).toBeNull(); first.unmount();
  vi.mocked(pageRequest).mockRejectedValueOnce(new Error("offline")); panel();
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not load"));
});
it("closed work stays readable without a new-request action", async () => {
  vi.mocked(pageRequest).mockResolvedValueOnce({ revision: "page-input-v1:r:0", headVersionId: "v1", canRespond: false, entries: [], total: 0, nextOffset: null, view: "handoff", handoff: null }); panel();
  await screen.findByText("This page is currently read-only. Saved content is still available.");
  expect(screen.queryByRole("button", { name: "Ask your Agent to continue" })).toBeNull();
});
it("reporting remains separate from acceptance; displays deferred and unclear feedback and escapes author text", () => {
  const { container } = render(<I18nProvider locale="en" messages={en}><PageUpdateSummary report={{ requestId: "r", baseVersionId: "v1", summary: "<script>run()</script>", changes: ["Adjusted budget"], feedback: [
    { entryId: "one", disposition: "deferred", explanation: "Need current prices" },
    { entryId: "two", disposition: "needs_clarification", explanation: "Include monitor?" },
  ] }} /></I18nProvider>);
  expect(container.querySelector("script")).toBeNull(); expect(screen.getByText("<script>run()</script>")).toBeInTheDocument();
  expect(screen.getByText("Deferred")).toBeInTheDocument(); expect(screen.getByText("Needs clarification")).toBeInTheDocument();
  expect(screen.getByText("An update report from the page author, not your confirmation or acceptance.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /accept/i })).toBeNull();
});
