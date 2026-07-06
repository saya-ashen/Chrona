import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { UiDocument } from "@chrona/ui-protocol";
import { SpecRenderer } from "../spec-renderer";

describe("workspace result registry", () => {
  it("renders JsonView with title and card surface", () => {
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
    expect(surface).toHaveClass("bg-background/95");
    expect(screen.getByText(/"status": "ok"/)).toBeInTheDocument();
  });

  it("renders ResultSummary as a labeled summary surface with copy affordance", () => {
    const spec: UiDocument = {
      root: "root",
      elements: {
        root: {
          type: "ResultSummary",
          props: { text: "Trending report ready.", copyText: "Copyable report summary." },
          children: [],
        },
      },
    };

    render(<SpecRenderer spec={spec} />);

    const summary = screen.getByRole("region", { name: "Result summary" });
    expect(summary).toHaveClass("border-b");
    expect(screen.getByText("Result summary")).toBeInTheDocument();
    expect(screen.getByText("Trending report ready.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy summary/i })).toBeInTheDocument();
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

    const card = screen.getByText("Generated result").closest("[data-slot='card']");
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
            contentPreview: JSON.stringify({ rows: [
              { repo: "zeta/project", description: "Later row", url: "https://github.com/zeta/project" },
              { repo: "alpha/project", description: "Earlier row", url: "https://github.com/alpha/project" },
            ] }),
            columns: [
              { key: "repo", label: "Repository" },
              { key: "description", label: "Description" },
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
    expect(screen.getByText("Trending repos")).toBeInTheDocument();
    expect(screen.getByText(".chrona/outputs/N20260706-01/trending.json")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repository" })).toBeInTheDocument();
    expect(screen.getByText("Later row")).toHaveClass("whitespace-normal");
    expect(screen.getByText("Later row")).toHaveClass("break-words");
    expect(screen.getByText("Later row")).toHaveClass("[overflow-wrap:anywhere]");
    expect(screen.getByRole("link", { name: "zeta/project" })).toHaveAttribute("href", "https://github.com/zeta/project");
    expect(screen.getByText("2 rows · page 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });
});
