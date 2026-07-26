import "@testing-library/jest-dom/vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildCommandCenterCheckpointSpec, type UiDocument } from "@chrona/ui-protocol";
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

it("renders collapsible FileRef title once", () => {
  const spec: UiDocument = {
    root: "file",
    elements: {
      file: {
        type: "FileRef",
        props: {
          title: "Readable change report",
          path: "generated://scope/report.md",
          collapsible: true,
          defaultCollapsed: false,
        },
      },
    },
  };

  render(<SpecRenderer spec={spec} />);

  expect(screen.getAllByText("Readable change report")).toHaveLength(1);
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

  it("renders the operational result hierarchy with semantic surfaces", () => {
    const spec: UiDocument = {
      root: "root",
      elements: {
        root: { type: "Stack", props: { gap: "lg" }, children: ["hero", "deliverables", "insights", "actions", "caveats", "evidence"] },
        hero: {
          type: "ResultHero",
          props: {
            title: "Research package ready",
            summary: "Verified sources and an operating guide are assembled.",
            readiness: "ready_with_caveats",
            readinessSummary: "Confirm one access-limited source.",
            metrics: [{ label: "Deliverables", value: "2" }, { label: "Verified sources", value: "37" }],
          },
        },
        deliverables: { type: "Stack", props: { direction: "horizontal", gap: "md" }, children: ["primary", "support"] },
        primary: {
          type: "ResultDeliverable",
          props: {
            title: "Operating guide",
            summary: "Primary workflow",
            artifactRef: "AF111111111111",
            role: "primary",
            kind: "document",
            formatLabel: "Markdown",
            contentKind: "markdown",
            contentPreview: "# Guide\n\nStart here.",
            downloadHref: "/api/tasks/task-1/result-files/download?path=guide",
          },
        },
        support: {
          type: "ResultDeliverable",
          props: { title: "Source table", artifactRef: "AF222222222222", role: "supporting", kind: "table" },
        },
        insights: {
          type: "ResultInsight",
          props: { title: "Confirm on official sources", summary: "Discovery networks provide early signals.", emphasis: "lead", points: ["Discover", "Verify"] },
        },
        actions: {
          type: "ResultActionPlan",
          props: { title: "Recommended route", phases: [{ timeframe: "now", title: "Confirm constraints", actions: ["Choose target regions"] }] },
        },
        caveats: { type: "ResultCaveats", props: { title: "Before accepting", items: ["One source requires manual verification"] } },
        evidence: { type: "ResultEvidence", props: { title: "Evidence and source boundaries", summary: "2 records", items: ["Official source checked"], defaultCollapsed: true } },
      },
    };

    render(<SpecRenderer spec={spec} />);

    expect(screen.getByRole("region", { name: "Result overview" })).toHaveTextContent("Ready with caveats");
    const heroTitle = screen.getByText("Research package ready");
    expect(heroTitle).toHaveClass("w-full");
    expect(heroTitle).not.toHaveClass("max-w-3xl");
    const heroSummary = screen.getByText("Verified sources and an operating guide are assembled.");
    expect(heroSummary).toHaveClass("w-full");
    expect(heroSummary).not.toHaveClass("max-w-3xl");
    expect(screen.getByText("37")).toBeInTheDocument();
    const resultOverview = screen.getByRole("region", { name: "Result overview" });
    expect(resultOverview).not.toHaveClass("grid");
    expect(within(resultOverview).getByText("Readiness")).toBeInTheDocument();
    expect(within(resultOverview).getByText("Confirm one access-limited source.")).toBeInTheDocument();
    const readinessBadge = within(resultOverview).getByText("Ready with caveats");
    expect(readinessBadge).toHaveClass("text-warning");
    expect(readinessBadge).not.toHaveClass("text-warning-foreground");
    const primaryDeliverable = screen.getByText("Operating guide").closest("article");
    expect(primaryDeliverable).toHaveAttribute("data-result-deliverable-role", "primary");
    expect(screen.getByText("Source table").closest("article")).toHaveAttribute("data-result-deliverable-role", "supporting");
    const deliverables = primaryDeliverable?.parentElement;
    expect(deliverables).toHaveClass("flex-row");
    expect(deliverables).toHaveClass("flex-wrap");
    expect(deliverables).toHaveClass("[&>*]:flex-[1_1_18rem]");
    expect(within(primaryDeliverable as HTMLElement).getByRole("link", { name: /download/i })).toHaveAttribute("href", "/api/tasks/task-1/result-files/download?path=guide");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const preview = screen.getByRole("dialog");
    expect(preview).toHaveAttribute("data-result-content-preview");
    expect(within(preview).getByRole("heading", { name: "Operating guide" })).toBeInTheDocument();
    expect(within(preview).getByText("Content preview")).toBeInTheDocument();
    expect(within(preview).getByRole("heading", { name: "Guide" })).toBeInTheDocument();
    fireEvent.click(within(preview).getByRole("button", { name: "Close preview" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.getByText("One source requires manual verification")).toBeInTheDocument();
    const caveat = screen.getByText("One source requires manual verification");
    expect(caveat.parentElement).toHaveClass("text-foreground/80");
    expect(caveat.parentElement).not.toHaveClass("text-warning-foreground");
    const keyStrategy = screen.getByText("Key strategy").closest("article");
    expect(keyStrategy).toHaveAttribute("data-result-insight-emphasis", "lead");
    expect(within(keyStrategy as HTMLElement).getByText("Discover")).toBeInTheDocument();
    const evidenceFootnote = screen.getByText("Result notes").parentElement;
    expect(evidenceFootnote).toHaveAttribute("data-result-evidence-footnote");
    expect(screen.queryByText("Official source checked")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /evidence and source boundaries/i }));
    expect(screen.getByText("Official source checked")).toBeInTheDocument();
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
  it("renders collapsible Table title once", () => {
    const spec: UiDocument = {
      root: "table",
      elements: {
        table: {
          type: "Table",
          props: {
            title: "GitHub Trending full list",
            contentKind: "json",
            contentPreview: JSON.stringify([{ repository: "chrona" }]),
            columns: [{ key: "repository", label: "Repository" }],
            collapsible: true,
            defaultCollapsed: false,
          },
          children: [],
        },
      },
    };

    render(<SpecRenderer spec={spec} />);

    expect(screen.getAllByText("GitHub Trending full list")).toHaveLength(1);
    expect(screen.getAllByRole("table").length).toBeGreaterThan(0);
  });

  it("submits text, multiple-choice, and boolean checkpoint values without string coercion", async () => {
    const spec = buildCommandCenterCheckpointSpec({
      checkpoint: {
        id: "checkpoint-typed",
        nodeId: "node-typed",
        title: "Application details needed",
        message: "Provide the approved values.",
        form: {
          instructions: "Complete every field",
          inputFields: [
            { kind: "text", name: "approvedStatement", label: "Approved statement", required: true },
            {
              kind: "choice",
              name: "channels",
              label: "Channels",
              selection: "multiple",
              options: [
                { value: "official", label: "Official" },
                { value: "euraxess", label: "EURAXESS" },
              ],
              required: true,
            },
            { kind: "boolean", name: "confirmed", label: "Confirmed", defaultValue: false },
          ],
        },
        availableActions: [{ id: "submit_input", label: "Submit input", style: "primary" }],
      },
    });
    const submit = vi.fn(async (_payload: unknown) => undefined);

    render(<SpecRenderer spec={spec} handlers={{ "submit-checkpoint": submit }} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Approved statement" }), {
      target: { value: "Approved statement text" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Official" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "EURAXESS" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Confirmed" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit input" }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      checkpointId: "checkpoint-typed",
      actionId: "submit_input",
      values: {
        approvedStatement: "Approved statement text",
        channels: ["official", "euraxess"],
        confirmed: true,
      },
    });
  });

});
