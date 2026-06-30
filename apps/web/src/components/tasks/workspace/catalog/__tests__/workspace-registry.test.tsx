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

  it("renders ResultSummary as a visible card surface", () => {
    const spec: UiDocument = {
      root: "root",
      elements: {
        root: {
          type: "ResultSummary",
          props: { text: "Trending report ready." },
          children: [],
        },
      },
    };

    render(<SpecRenderer spec={spec} />);

    const summary = screen.getByText("Trending report ready.");
    expect(summary.closest("section")).toHaveClass("bg-primary-soft/45");
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

  it("wraps table cells inside the result card width", () => {
    const spec: UiDocument = {
      root: "root",
      elements: {
        root: {
          type: "Table",
          props: {
            columns: ["Repository", "Description", "URL"],
            rows: [[
              "msitarzewski/agency-agents",
              "A complete AI agency at your fingertips - From frontend wizards to Reddit community ninjas, from whimsy injectors to reality checkers.",
              "https://github.com/msitarzewski/agency-agents",
            ]],
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
    expect(screen.getByText(/complete AI agency/)).toHaveClass("whitespace-normal");
    expect(screen.getByText(/complete AI agency/)).toHaveClass("break-words");
    expect(screen.getByText(/complete AI agency/)).toHaveClass("[overflow-wrap:anywhere]");
  });
});
