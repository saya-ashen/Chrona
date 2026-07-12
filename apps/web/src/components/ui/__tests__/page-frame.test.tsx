import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PageFrame, type PageFrameMode } from "shared/ui/page-frame";
afterEach(cleanup);

const expectedWidth: Record<PageFrameMode, string> = {
  workspace: "max-w-[1600px]",
  overview: "max-w-[1280px]",
  focused: "max-w-[1120px]",
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
    render(<PageFrame mode="overview">Content</PageFrame>);

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
