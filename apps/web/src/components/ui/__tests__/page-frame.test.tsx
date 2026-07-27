import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PageFrame, type PageFrameMode } from "@shared/ui"
afterEach(cleanup);

const expectedWidth: Record<PageFrameMode, string> = {
  main: "max-w-[1440px]",
  workspace: "max-w-[1600px]",
};

describe("PageFrame", () => {
  it.each(Object.entries(expectedWidth) as Array<[PageFrameMode, string]>)(
    "applies the %s page-width contract",
    (mode, widthClass) => {
      render(<PageFrame mode={mode}>Content</PageFrame>);

      const frame = screen.getByText("Content");
      expect(frame).toHaveAttribute("data-mode", mode);
      expect(frame).toHaveClass("w-full", widthClass);
    },
  );

  it("provides one shared transparent scroll contract", () => {
    render(<PageFrame mode="main">Content</PageFrame>);

    const frame = screen.getByText("Content");
    expect(frame).toHaveClass(
      "mx-auto",
      "h-full",
      "overflow-x-hidden",
      "overflow-y-auto",
    );
    expect(frame).not.toHaveClass("bg-background", "bg-card", "bg-canvas");
  });
});
