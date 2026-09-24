import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "@chrona/i18n/react";
import en from "@chrona/i18n/messages/en.json";
import zh from "@chrona/i18n/messages/zh.json";
import { PageTaskDescription } from "./page-task-description";

afterEach(cleanup);
describe("task context without an authored result", () => {
  it.each([undefined, null, "", " \n\t "])("shows blank guidance only for empty description %j", (description) => {
    render(<I18nProvider locale="en" messages={en}><PageTaskDescription description={description} /></I18nProvider>);
    expect(screen.getByText(en.workPages.blank)).toBeVisible();
    expect(screen.queryByRole("region")).toBeNull();
  });
  it("preserves multiline context as escaped text, distinctly labeled and without authority controls", () => {
    const description = "Next: check the application\n<img src=x onerror=alert(1)>";
    const { container } = render(<I18nProvider locale="en" messages={en}><PageTaskDescription description={description} /></I18nProvider>);
    expect(screen.getByRole("region", { name: "Task description" })).toBeVisible();
    expect(container.querySelector("section p")?.textContent).toBe(description);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByText(en.workPages.blank)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("labels existing context in Chinese", () => {
    render(<I18nProvider locale="zh" messages={zh}><PageTaskDescription description="下一步：确认材料" /></I18nProvider>);
    expect(screen.getByRole("heading", { name: "事项说明" })).toBeVisible();
  });
});
