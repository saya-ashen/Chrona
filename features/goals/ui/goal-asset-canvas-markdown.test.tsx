import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownAssetCanvas } from "./goal-asset-canvas-markdown";

describe("MarkdownAssetCanvas", () => {
  it("opens directly in the MDXEditor rich-text mode", () => {
    render(
      <MarkdownAssetCanvas
        value="# Research brief\n\nReadable body."
        ariaLabel="Document content"
        onChange={vi.fn()}
      />,
    );

    const canvas = screen.getByLabelText("Document content");
    expect(canvas).toHaveAttribute("data-asset-canvas-mode", "edit");
    expect(canvas).toHaveClass("flex-1", "overflow-hidden");
    expect(document.querySelector(".mdxeditor")).toBeInTheDocument();
    expect(document.querySelector(".cm-editor")).not.toBeInTheDocument();
    expect(canvas).toHaveTextContent("Research brief");
  });

  it("uses MDXEditor for rich-text, source, and diff modes", () => {
    render(
      <MarkdownAssetCanvas
        value="# Draft"
        diffValue="# Published"
        ariaLabel="Document content"
        onChange={vi.fn()}
      />,
    );

    expect(document.querySelectorAll(".mdxeditor")).toHaveLength(2);
    expect(document.querySelector(".cm-editor")).not.toBeInTheDocument();
    expect(screen.getAllByRole("toolbar")).toHaveLength(2);
    expect(screen.getAllByRole("textbox", { name: /editable markdown/i })).toHaveLength(2);
  });
});
