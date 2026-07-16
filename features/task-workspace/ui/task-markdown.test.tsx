import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { normalizeCjkStrongBoundaries, TaskMarkdownContent } from "./task-markdown";

describe("TaskMarkdownContent", () => {
  it("inserts a boundary after strong CJK text followed by CJK prose", () => {
    expect(normalizeCjkStrongBoundaries("**值得试用：**愿意配置")).toBe(
      "**值得试用：** 愿意配置",
    );
  });

  it("renders GFM answers as semantic HTML", () => {
    const { container } = render(
      <TaskMarkdownContent>{[
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
      ].join("\n")}</TaskMarkdownContent>,
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
