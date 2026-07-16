import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskMarkdown } from "./task-markdown";

describe("TaskMarkdown", () => {
  it("renders GFM answers as semantic HTML", () => {
    const { container } = render(
      <TaskMarkdown>{[
        "## DeepTutor",
        "",
        "**DeepTutor** is a personalized tutoring project.",
        "",
        "- Python",
        "- [Project page](https://deeptutor.info/)",
        "",
        "| Metric | Value |",
        "| --- | --- |",
        "| Rank | 8 |",
      ].join("\n")}</TaskMarkdown>,
    );

    expect(screen.getByRole("heading", { name: "DeepTutor", level: 2 })).toBeVisible();
    expect(screen.getByText("DeepTutor", { selector: "strong" })).toBeVisible();
    expect(screen.getByRole("list")).toBeVisible();
    expect(screen.getByRole("link", { name: "Project page" })).toHaveAttribute(
      "href",
      "https://deeptutor.info/",
    );
    expect(container.querySelector("table")).not.toBeNull();
  });
});
