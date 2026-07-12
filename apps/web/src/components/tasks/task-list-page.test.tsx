import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import en from "../../../../../packages/i18n/src/messages/en.json";

import { TaskListPage } from "./task-list-page";

vi.mock("@/components/i18n/localized-link", () => ({
  LocalizedLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
const copy = en as never;

function task(id: string, title: string, state: "result_ready" | "done", executedAt: string) {
  return {
    id,
    workspaceId: "workspace-1",
    title,
    description: null,
    status: state === "done" ? "Done" : "Completed",
    priority: "Medium",
    kind: "task",
    recurrenceRule: "FREQ=DAILY",
    dueAt: null,
    updatedAt: executedAt,
    autoPlanGeneration: true,
    autoExecute: true,
    projection: null,
    result: {
      runId: `run-${id}`,
      runStatus: "Completed",
      provider: "debug",
      occurrenceId: `occurrence-${id}`,
      executedAt,
      artifact: { id: `artifact-${id}`, title: `${title} report`, type: "markdown", uri: `file://${id}.md`, runId: `run-${id}`, createdAt: executedAt },
    },
    stateView: { state, label: state === "done" ? "Done" : "Result ready" },
    source: null,
  } as never;
}

function renderResults() {
  render(
    <MemoryRouter initialEntries={["/en/tasks?view=results"]}>
      <TaskListPage
        tasks={[
          task("older", "Weekly report", "done", "2026-06-24T10:00:00.000Z"),
          task("newer", "Daily report", "result_ready", new Date().toISOString()),
        ]}
        workspaceId="workspace-1"
        copy={copy}
        total={2}
        page={1}
        pageSize={20}
        pageCount={1}
        counts={{ all: 2, needsMe: 1, ready: 0, running: 0, completed: 2, failed: 0 }}
      />
    </MemoryRouter>,
  );
}

describe("TaskListPage results filters", () => {
  it("filters historical results by status and source occurrence", async () => {
    const user = userEvent.setup();
    renderResults();

    const resultFilters = screen.getByRole("group", { name: "Result filters" });
    expect(within(resultFilters).getAllByRole("combobox")).toHaveLength(3);
    expect(within(resultFilters).getByRole("combobox", { name: "Result date" })).toBeInTheDocument();
    expect(within(resultFilters).getByRole("combobox", { name: "Result status" })).toBeInTheDocument();
    expect(within(resultFilters).getByRole("combobox", { name: "Source task" })).toBeInTheDocument();

    expect(screen.getByText("Weekly report report")).toBeInTheDocument();
    expect(screen.getByText("Daily report report")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Result status" }));
    await user.click(screen.getByRole("option", { name: "Needs review" }));
    expect(screen.queryByText("Weekly report report")).not.toBeInTheDocument();
    expect(screen.getByText("Daily report report")).toBeInTheDocument();
    expect(screen.getByText("Occurrence occurrence-newer")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Result status" }));
    await user.click(screen.getByRole("option", { name: "Any status" }));
    await user.click(screen.getByRole("combobox", { name: "Source task" }));
    await user.click(screen.getByRole("option", { name: "Weekly report" }));

    const resultLink = screen.getByRole("link", { name: "Open result" });
    expect(resultLink).toHaveAttribute("href", "/tasks/older");
    expect(within(resultLink.parentElement!.parentElement!).getByText("Occurrence occurrence-older")).toBeInTheDocument();
    expect(screen.queryByText("Daily report report")).not.toBeInTheDocument();
  });
});
