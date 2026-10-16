import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import en from "../../../packages/i18n/src/messages/en.json";
import { StewardClientError, type StewardClient } from "../model/client";
import { GeneratedPage } from "./generated-page";

afterEach(cleanup);
const spec = (on: unknown, extra: Record<string, unknown> = {}) => ({
  root: "main",
  elements: {
    main: { type: "Stack", props: { direction: "vertical", gap: "md" }, children: ["answer", "send"] },
    answer: { type: "Input", props: { label: "Answer", name: "answer", value: { $bindState: "/answer" } }, children: [] },
    send: { type: "Button", props: { label: "Send", variant: "primary" }, on, children: [] },
  },
  state: { answer: "" },
  ...extra,
});
function setup(page: unknown, readOnly = false) {
  const chat = vi.fn(async () => ({ runId: null, messages: [] }));
  const client = { chat, uiEvent: vi.fn().mockResolvedValue({ ok: true }) } as unknown as StewardClient;
  render(<MemoryRouter><I18nProvider locale="en" messages={en}><GeneratedPage spec={page} client={client} affairId="a1" readOnly={readOnly} refresh={() => {}} /></I18nProvider></MemoryRouter>);
  return chat;
}
it("sends the say action with state interpolated, linked to the affair", async () => {
  const chat = setup(spec({ press: { action: "say", params: { text: { $template: "Result: ${/answer}" } } } }));
  await userEvent.type(screen.getByLabelText("Answer"), "16/20");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(chat).toHaveBeenCalledWith({ affairId: "a1", text: "Result: 16/20" }));
});
it("records open once even in StrictMode and records a say action without surfacing usage failures", async () => {
  const uiEvent = vi.fn().mockRejectedValue(new Error("offline"));
  const chat = vi.fn().mockResolvedValue({ runId: null, messages: [] });
  const client = { uiEvent, chat } as unknown as StewardClient;
  render(<StrictMode><MemoryRouter><I18nProvider locale="en" messages={en}><GeneratedPage spec={spec({ press: { action: "say", params: { text: "done" } } })} path="home.ui.json" client={client} affairId="a1" readOnly={false} refresh={() => {}} /></I18nProvider></MemoryRouter></StrictMode>);
  await waitFor(() => expect(uiEvent).toHaveBeenCalledTimes(1));
  expect(uiEvent).toHaveBeenCalledWith("a1", { kind: "open", path: "home.ui.json" });
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(uiEvent).toHaveBeenCalledWith("a1", { kind: "action", path: "home.ui.json", name: "say" }));
  expect(chat).toHaveBeenCalledWith({ affairId: "a1", text: "done" });
});
it("toggles TaskList source lines and records the task path", async () => {
  const file = vi.fn().mockResolvedValue({ content: "# Day\n- [ ] Practice", revision: "r1" });
  const toggleCheckbox = vi.fn().mockResolvedValue({});
  const uiEvent = vi.fn().mockResolvedValue({ ok: true });
  const client = { file, toggleCheckbox, uiEvent } as unknown as StewardClient;
  const page = { root: "tasks", elements: { tasks: { type: "TaskList", props: { path: "day-1.md", section: null, title: "Today", showProgress: true }, children: [] } } };
  render(<MemoryRouter><I18nProvider locale="en" messages={en}><GeneratedPage spec={page} client={client} affairId="a1" readOnly={false} refresh={() => {}} /></I18nProvider></MemoryRouter>);
  await userEvent.click(await screen.findByRole("checkbox", { name: "Practice" }));
  expect(toggleCheckbox).toHaveBeenCalledWith("a1", { path: "day-1.md", line: 2, checked: true, baseRevision: "r1" });
  await waitFor(() => expect(uiEvent).toHaveBeenCalledWith("a1", { path: "day-1.md", kind: "toggle" }));
});
it.each([[false, "existing"], [true, "existing"], [false, "missing"]] as const)("renders a deterministic Panel (readOnly=%s, data file %s)", async (readOnly, data) => {
  const file = data === "existing" ? vi.fn().mockResolvedValue({ content: "weight\n", revision: "r1" }) : vi.fn().mockRejectedValue(new StewardClientError("requestError", 404));
  const addPanelEntry = vi.fn().mockResolvedValue({});
  const uiEvent = vi.fn().mockResolvedValue({ ok: true });
  const client = { file, addPanelEntry, uiEvent } as unknown as StewardClient;
  const props = { title: "Daily weight", data: "records.csv", fields: [{ key: "weight", label: "Weight", type: "number", required: true }], views: [{ kind: "table", columns: ["weight"] }] };
  const page = { root: "panel", elements: { panel: { type: "Panel", props, children: [] } } };
  render(<MemoryRouter><I18nProvider locale="en" messages={en}><GeneratedPage spec={page} path="home.ui.json" client={client} affairId="a1" readOnly={readOnly} refresh={() => {}} /></I18nProvider></MemoryRouter>);
  const input = await screen.findByLabelText("Weight");
  if (readOnly) { expect(input).toBeDisabled(); expect(addPanelEntry).not.toHaveBeenCalled(); return; }
  await userEvent.type(input, "70");
  await userEvent.click(screen.getByRole("button", { name: en.steward.panel.add }));
  await waitFor(() => expect(addPanelEntry).toHaveBeenCalledWith("a1", { dataPath: "records.csv", values: { weight: 70 } }));
  expect(uiEvent).toHaveBeenCalledWith("a1", { kind: "action", name: "panel", path: "home.ui.json" });
});
function Location() { const location = useLocation(); return <output aria-label="location">{location.pathname}{location.search}</output>; }
it("renders TaskList Markdown links and bold", async () => {
  const client = { file: vi.fn().mockResolvedValue({ content: "- [ ] 按[诊断材料](01-口语诊断材料.md)完成 **练习** [source](https://example.com)", revision: "r1" }) } as unknown as StewardClient;
  const page = { root: "tasks", elements: { tasks: { type: "TaskList", props: { path: "day.md", section: null, title: null, showProgress: false }, children: [] } } };
  render(<MemoryRouter><I18nProvider locale="en" messages={en}><GeneratedPage spec={page} client={client} affairId="a1" readOnly={false} refresh={() => {}} /><Location /></I18nProvider></MemoryRouter>);
  const link = await screen.findByRole("link", { name: "诊断材料" });
  await userEvent.click(link);
  expect(screen.getByLabelText("location")).toHaveTextContent(`/en/affairs/a1?${new URLSearchParams({ path: "01-口语诊断材料.md" })}`);
  expect(screen.getByRole("link", { name: "source" })).toHaveAttribute("href", "https://example.com");
  expect(screen.getByText("练习").tagName).toBe("STRONG");
});
it("does not act on an ended affair and rejects specs outside the catalog", async () => {
  const chat = setup(spec({ press: { action: "say", params: { text: "done" } } }), true);
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(chat).not.toHaveBeenCalled();
  cleanup();
  setup({ root: "x", elements: { x: { type: "Script", props: {}, children: [] } } });
  expect(screen.getByRole("alert")).toBeInTheDocument();
});
it("renders Markdown links in text and table cells, keeps line breaks, and labels cells for phones", () => {
  setup({
    root: "main",
    elements: {
      main: { type: "Stack", props: { direction: "vertical" }, children: ["text", "table"] },
      text: { type: "Text", props: { text: "first line\nsecond [line](https://example.com/a)" }, children: [] },
      table: { type: "Table", props: { columns: ["Repo", "Link"], rows: [["owner/repo", "[open](https://github.com/owner/repo)"]] }, children: [] },
    },
  });
  expect(screen.getByRole("link", { name: "line" })).toHaveAttribute("href", "https://example.com/a");
  expect(screen.getByRole("link", { name: "open" })).toHaveAttribute("href", "https://github.com/owner/repo");
  expect(screen.getByText(/first line/).innerHTML).toContain("<br");
  expect(screen.getByRole("columnheader", { name: "Repo" })).toBeInTheDocument();
});
