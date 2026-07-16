import "@testing-library/jest-dom/vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UiDocument } from "@chrona/ui-protocol";
import { SpecRenderer } from "./spec-renderer";

const requestResultFileAccessMock = vi.fn();
const approveResultFileAccessMock = vi.fn();

vi.mock("../../model/task-actions-client", () => ({
  requestResultFileAccess: (...args: unknown[]) =>
    requestResultFileAccessMock(...args),
  approveResultFileAccess: (...args: unknown[]) =>
    approveResultFileAccessMock(...args),
}));

beforeEach(() => {
  requestResultFileAccessMock.mockReset();
  approveResultFileAccessMock.mockReset();
});

it("requests and approves external file access inside FileRef", async () => {
  requestResultFileAccessMock.mockResolvedValueOnce({
    status: "permission_required",
    requestId: "request-1",
    requestedPath: "/tmp/report.md",
    canonicalPath: "/tmp/report.md",
    filename: "report.md",
    extension: ".md",
    size: 14,
  });
  approveResultFileAccessMock.mockResolvedValueOnce({
    requestedPath: "/tmp/report.md",
    canonicalPath: "/tmp/report.md",
    preview: {
      displayPath: "/tmp/report.md",
      contentKind: "markdown",
      contentPreview: "# Approved report",
      contentBytes: 17,
    },
  });
  const spec: UiDocument = {
    root: "file",
    elements: {
      file: {
        type: "FileRef",
        props: {
          path: "/tmp/report.md",
          displayPath: "/tmp/report.md",
          previewError: "permission_required",
          accessTaskId: "task-1",
          accessRequestedPath: "/tmp/report.md",
        },
      },
    },
  };

  render(<SpecRenderer spec={spec} />);
  expect(
    screen.getByText(/outside Chrona's generated-file directory/i),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Request access" }));
  expect(
    await screen.findByRole("group", { name: "File access review" }),
  ).toHaveTextContent("/tmp/report.md");
  expect(requestResultFileAccessMock).toHaveBeenCalledWith({
    taskId: "task-1",
    path: "/tmp/report.md",
  });

  fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
  await waitFor(() =>
    expect(approveResultFileAccessMock).toHaveBeenCalledWith({
      taskId: "task-1",
      requestId: "request-1",
    }),
  );
  expect(
    await screen.findByRole("heading", { name: "Approved report" }),
  ).toBeInTheDocument();
});
it("renders generated FileRef downloads through the task-scoped API", () => {
  const downloadHref =
    "/api/tasks/task-1/result-files/download?path=generated%3A%2F%2Fscope%2Freport.md";
  const spec: UiDocument = {
    root: "file",
    elements: {
      file: {
        type: "FileRef",
        props: {
          title: "中文功能分析报告",
          path: "generated://scope/report.md",
          downloadHref,
        },
      },
    },
  };

  render(<SpecRenderer spec={spec} />);

  expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
    "href",
    downloadHref,
  );
  expect(screen.getByRole("link", { name: "Download" })).not.toHaveAttribute(
    "href",
    "generated://scope/report.md",
  );
});

describe("workspace result registry", () => {
  it("renders JsonView as flat result content", () => {
    const spec: UiDocument = {
      root: "root",
      elements: {
        root: {
          type: "JsonView",
          props: { title: "Report evidence", value: { status: "ok" } },
          children: [],
        },
      },
    };

    render(<SpecRenderer spec={spec} />);

    expect(screen.getByText("Report evidence")).toBeInTheDocument();
    const surface = screen.getByText("Report evidence").closest("section");
    expect(surface).not.toHaveClass("bg-card");
    expect(screen.getByText(/"status": "ok"/)).toBeInTheDocument();
  });

  it("renders ResultSummary as a labeled summary surface with copy affordance", () => {
    const spec: UiDocument = {
      root: "root",
      elements: {
        root: {
          type: "ResultSummary",
          props: {
            text: "Trending report ready.",
            copyText: "Copyable report summary.",
          },
          children: [],
        },
      },
    };

    render(<SpecRenderer spec={spec} />);

    const summary = screen.getByRole("region", { name: "Result summary" });
    expect(summary).toHaveClass("border-b");
    expect(screen.getByText("Result summary")).toBeInTheDocument();
    expect(screen.getByText("Trending report ready.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /copy summary/i }),
    ).toBeInTheDocument();
  });

  it("renders generated Card outputs at result region width", () => {
    const spec: UiDocument = {
      root: "root",
      elements: {
        root: {
          type: "Card",
          props: { title: "Generated result", maxWidth: "md" },
          children: ["body"],
        },
        body: {
          type: "Text",
          props: { text: "Fluid content" },
          children: [],
        },
      },
    };

    render(<SpecRenderer spec={spec} />);

    const card = screen
      .getByText("Generated result")
      .closest("[data-slot='card']");
    expect(card).toHaveClass("w-full");
    expect(card).toHaveClass("max-w-none");
    expect(card).not.toHaveClass("max-w-sm");
  });

  it("renders file-backed JSON tables with links, sorting, and pagination", () => {
    const spec: UiDocument = {
      root: "root",
      elements: {
        root: {
          type: "Table",
          props: {
            title: "Trending repos",
            path: ".chrona/outputs/N20260706-01/trending.json",
            contentKind: "json",
            contentPreview: JSON.stringify({
              rows: [
                {
                  repo: "zeta/project",
                  description: "Later row",
                  url: "https://github.com/zeta/project",
                  starsToday: 20,
                },
                {
                  repo: "alpha/project",
                  description: "Earlier row",
                  url: "https://github.com/alpha/project",
                  starsToday: 10,
                },
              ],
            }),
            columns: [
              { key: "repo", label: "Repository" },
              { key: "description", label: "Description" },
              { key: "starsToday", label: "Stars", type: "number" },
              { key: "repo", label: "Source", type: "link", hrefKey: "url" },
            ],
            pageSize: 1,
          },
          children: [],
        },
      },
    };

    render(<SpecRenderer spec={spec} />);

    const table = screen.getByRole("table");
    expect(table).toHaveClass("w-full");
    expect(table).toHaveClass("table-fixed");
    expect(table.parentElement).toHaveClass("w-full");
    expect(table.parentElement).not.toHaveClass("overflow-x-auto");
    expect(table.parentElement).toHaveClass("bg-background");
    expect(table.closest("section")).not.toHaveClass("bg-card");
    expect(screen.getByText("Trending repos")).toBeInTheDocument();
    expect(
      screen.getByText(".chrona/outputs/N20260706-01/trending.json"),
    ).toBeInTheDocument();
    const repositoryHeader = screen.getByRole("button", {
      name: "Sort by Repository",
    });
    expect(repositoryHeader).toHaveTextContent("Repository↕");
    expect(repositoryHeader.closest("th")).toHaveAttribute("aria-sort", "none");
    const starsHeader = screen.getByRole("button", { name: "Sort by Stars" });
    expect(starsHeader).toHaveTextContent("Stars↕");
    expect(starsHeader).toHaveClass("justify-end");
    expect(starsHeader.closest("th")).toHaveAttribute("aria-sort", "none");
    expect(screen.getByText("Later row")).toHaveClass("whitespace-normal");
    expect(screen.getByText("Later row")).toHaveClass("break-words");
    expect(screen.getByText("Later row")).toHaveClass(
      "[overflow-wrap:anywhere]",
    );
    expect(screen.getByRole("link", { name: "zeta/project" })).toHaveAttribute(
      "href",
      "https://github.com/zeta/project",
    );
    expect(screen.getByText("2 rows · page 1 of 2")).toBeInTheDocument();
    fireEvent.click(repositoryHeader);
    expect(repositoryHeader).toHaveTextContent("Repository↑");
    expect(repositoryHeader.closest("th")).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(
      within(screen.getAllByRole("row")[1]!).getAllByText("alpha/project"),
    ).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });
});
