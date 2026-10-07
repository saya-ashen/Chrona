import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "@chrona/i18n/react";
import en from "@chrona/i18n/messages/en.json";
import { exampleWorkPage } from "@chrona/ui-protocol/work-pages/example";
import { WorkPageRenderer } from "./work-page-renderer";
const scope = { taskId: "task", occurrenceId: null };
afterEach(cleanup);
function show(page: unknown = exampleWorkPage, loaded = true, canRespond = false) {
  return render(<I18nProvider locale="en" messages={en}><WorkPageRenderer page={page} scope={scope} versionId="v1" inputs={loaded ? { revision: "page-input-v1:result:0", headVersionId: "v1", canRespond, entries: [], total: 0, nextOffset: null, view: "current" } : null} /></I18nProvider>);
}
describe("restricted work-page renderer", () => {
  it("renders sections, calculations and references with host-owned save semantics", () => {
    show(); expect(screen.getByText("9,260")).toHaveTextContent("9,260元");
    expect(screen.getByRole("button", { name: "Save answers" })).toBeDisabled();
    expect(screen.getByText("This page is currently read-only. Saved content is still available.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "示例来源（非商家链接） ↗", hidden: true })).toHaveAttribute("rel", "noopener noreferrer");
  });
  it("loading cannot fabricate empty saved answers; failed validation renders safe fallback", () => {
    const result = show(exampleWorkPage, false); expect(screen.getByText("Loading saved answers…")).toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Save answers" })).toBeNull(); result.unmount();
    show({ ...exampleWorkPage, actions: { execute: true } }); expect(screen.getByRole("alert")).toHaveTextContent("cannot be displayed");
  });
  it("filters without mutating source data and escapes HTML-looking text", () => {
    const page = structuredClone(exampleWorkPage); page.elements.summary = { type: "Text", props: { text: "<img src=x onerror=alert(1)>", tone: "normal" } };
    const { container } = show(page); expect(container.querySelector("img")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Filter table…" }), { target: { value: "GPU" } }); expect(screen.queryByText("示例 CPU")).toBeNull(); expect(screen.getByText("示例 GPU")).toBeInTheDocument(); expect(page.datasets.parts.rows).toHaveLength(3);
  });
});
