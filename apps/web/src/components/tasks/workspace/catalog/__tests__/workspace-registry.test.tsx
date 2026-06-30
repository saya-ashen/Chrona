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
});
