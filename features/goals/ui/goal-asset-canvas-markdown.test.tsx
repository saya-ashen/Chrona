import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MarkdownAssetCanvas } from "./goal-asset-canvas-markdown";

describe("MarkdownAssetCanvas", () => {
  it("renders preview content inside the full-height document canvas", () => {
    render(
      <MarkdownAssetCanvas
        mode="read"
        value="# Research brief\n\nReadable body."
        ariaLabel="Document content"
        previewModeLabel="Preview"
        onChange={vi.fn()}
      />,
    );

    const canvas = screen.getByLabelText("Document content · Preview");
    expect(canvas).toHaveAttribute("data-asset-canvas-mode", "read");
    expect(canvas).toHaveClass("flex-1", "overflow-hidden");
    expect(canvas.firstElementChild).toHaveClass("overflow-y-auto");
    expect(canvas).toHaveTextContent("Research brief");
  });

  it("defaults to the authoritative Markdown source editor and switches editor type", async () => {
    const onChange = vi.fn();
    render(
      <MarkdownAssetCanvas
        mode="edit"
        value="# Draft"
        ariaLabel="Document content"
        sourceModeLabel="Markdown source"
        richModeLabel="Rich text"
        onChange={onChange}
      />,
    );

    const canvas = document.querySelector('[data-asset-canvas-mode="edit"]');
    expect(canvas).toHaveAttribute("data-asset-canvas-mode", "edit");
    expect(canvas).toHaveClass("flex-1", "overflow-hidden");
    expect(screen.getByRole("combobox", { name: "Document content" })).toHaveTextContent("Markdown source");
    expect(document.querySelector(".cm-editor")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Document content" }));
    await userEvent.click(screen.getByRole("option", { name: "Rich text" }));

    const richEditor = document.querySelector(".mdxeditor");
    expect(richEditor).toBeInTheDocument();
    expect(richEditor).toHaveClass("overflow-hidden");
    expect(screen.queryByText("Source")).not.toBeInTheDocument();

    const editable = screen.getByRole("textbox", { name: /editable markdown/i });
    fireEvent.input(editable, { target: { textContent: "Updated" } });
  });
});
