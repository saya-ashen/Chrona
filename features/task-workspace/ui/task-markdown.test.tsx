import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { normalizeCjkStrongBoundaries, MarkdownContent } from "../../../shared/ui/markdown-content";

describe("MarkdownContent", () => {
  it("inserts a boundary after strong CJK text followed by CJK prose", () => {
    expect(normalizeCjkStrongBoundaries("**值得试用：**愿意配置")).toBe(
      "**值得试用：** 愿意配置",
    );
  });

  it("renders hostile markup and URLs as inert text", () => {
    const longText = "x".repeat(10_000);
    const { container } = render(
      <MarkdownContent>{[
        '<script data-secret="run-token">alert(1)</script>',
        '<img src=x onerror="alert(2)">',
        "[unsafe](javascript:alert(3))",
        longText,
      ].join("\n\n")}</MarkdownContent>,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("link", { name: "unsafe" })).not.toBeInTheDocument();
    expect(screen.getByText(/script data-secret/)).toBeVisible();
    expect(screen.getByText(longText)).toBeVisible();
  });

  it("renders GFM answers as semantic HTML", () => {
    const { container } = render(
      <MarkdownContent>{[
        "## DeepTutor",
        "",
        "**值得试用：**愿意配置模型/API。",
        "",
        "- Python",
        "- [Project page](https://deeptutor.info/)",
        "",
        "- [生成报告](generated://20260716/N20260716-01/report.md)",

        "",
        "| Metric | Value |",
        "| --- | --- |",
        "| Rank | 8 |",
      ].join("\n")}</MarkdownContent>,
    );

    expect(screen.getByRole("heading", { name: "DeepTutor", level: 2 })).toBeVisible();
    expect(screen.getByText("值得试用：", { selector: "strong" })).toHaveClass("font-bold");
    expect(screen.getByRole("list")).toBeVisible();
    expect(screen.getByRole("link", { name: "Project page" })).toHaveAttribute(
      "href",
      "https://deeptutor.info/",
    );
    expect(screen.getByRole("link", { name: "Project page" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.getByText("生成报告", { selector: "span" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "生成报告" })).not.toBeInTheDocument();
    expect(container.querySelector("table")).not.toBeNull();
  });
});
