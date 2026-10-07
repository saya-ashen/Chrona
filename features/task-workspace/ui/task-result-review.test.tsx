import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "@chrona/i18n/messages/en.json";
import { TaskResultPublicationNotice } from "./task-result-publication-notice";
import { ResultDeliverable } from "./catalog/workspace-deliverable";
import { TaskHistoryPanel } from "./task-history-panel";
import { resultFileShortcuts } from "../model/result-file-shortcuts";
import { loadWorkspaceActivityPage } from "../model/task-workspace-actions";

vi.mock("@chrona/i18n", async original => ({
  ...await original<typeof import("@chrona/i18n")>(),
  useI18n: () => ({ locale: "en", messages: en }),
}));
vi.mock("../model/task-workspace-actions", () => ({ loadWorkspaceActivityPage: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("result review presentation", () => {
  it.each([
    [undefined, "No review record (historical result)"],
    [{ status: "completed" } as const, "AI layout review completed"],
    [{ status: "fallback", reason: "timeout" } as const, "Published validated draft"],
  ])("does not confuse structural validation, editorial review, and human acceptance", (review, label) => {
    render(<TaskResultPublicationNotice review={review} />);
    expect(screen.getByRole("note")).toHaveTextContent(label);
    if (review?.status === "fallback") expect(screen.getByRole("note")).toHaveTextContent("timed out");
    else expect(screen.getByRole("note")).toHaveTextContent("do not verify facts");
  });

  it("renders a Markdown deliverable as a table, without duplicating its heading or executing HTML", async () => {
    render(<ResultDeliverable props={{ title: "Report", role: "primary", kind: "document", contentKind: "markdown",
      contentPreview: "# Trending\n\n| Repository | Stars |\n| --- | --- |\n| Chrona | 12 |\n\n<script>window.bad=true</script>" }} />);
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("table")).toHaveTextContent("Chrona");
    expect(screen.getAllByRole("heading", { name: "Trending" })).toHaveLength(1);
    expect(document.querySelector("script")).toBeNull();
  });

  it("only shortcuts files reachable in the current result, primary first", () => {
    expect(resultFileShortcuts({ root: "root", elements: {
      root: { type: "Stack", props: {}, children: ["support", "section"] },
      section: { type: "ResultSection", props: {}, children: ["primary"] },
      support: { type: "ResultDeliverable", props: { title: "Data", downloadHref: "/api/data", role: "supporting" } },
      primary: { type: "ResultDeliverable", props: { title: "Report", downloadHref: "/api/report", role: "primary" } },
      old: { type: "ResultDeliverable", props: { title: "Old run", downloadHref: "/api/old" } },
    } }).map(file => file.title)).toEqual(["Report", "Data"]);
  });
});

function renderHistory(taskId = "task-1") {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TaskHistoryPanel taskId={taskId} /></QueryClientProvider>);
}
describe("durable task history", () => {
  it("loads history without live SSE and paginates older records", async () => {
    vi.mocked(loadWorkspaceActivityPage).mockResolvedValueOnce({ items: [{ id: "event-1", kind: "task", title: "Result published", summary: "", description: "", tone: "success" }], nextCursor: "older", scope: { type: "task", taskId: "task-1", limit: 30 } })
      .mockResolvedValueOnce({ items: [{ id: "event-2", kind: "task", title: "Previous run", summary: "", description: "", tone: "neutral" }], scope: { type: "task", taskId: "task-1", limit: 30 } });
    renderHistory();
    expect(await screen.findByText("Result published")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load older activity" }));
    expect(await screen.findByText("Previous run")).toBeInTheDocument();
    expect(loadWorkspaceActivityPage).toHaveBeenLastCalledWith({ taskId: "task-1", cursor: "older", limit: 30 });
  });
  it("shows loading, a safe error and a retryable empty state", async () => {
    vi.mocked(loadWorkspaceActivityPage).mockRejectedValueOnce(new Error("private diagnostic"))
      .mockResolvedValueOnce({ items: [], scope: { type: "task", taskId: "task-1", limit: 30 } });
    renderHistory();
    expect(screen.getByRole("status")).toHaveTextContent("Loading history");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load history");
    expect(screen.queryByText("private diagnostic")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("No recorded activity yet.")).toBeInTheDocument());
  });
});
