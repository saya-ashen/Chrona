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
  render(<MemoryRouter><I18nProvider locale="en" messages={en}><GeneratedPage spec={page} client={client} appId="a1" readOnly={readOnly} refresh={() => {}} /></I18nProvider></MemoryRouter>);
  return client;
}
it("sends the say action with state interpolated, linked to the app", async () => {
  const client = setup(spec({ press: { action: "say", params: { text: { $template: "Result: ${/answer}" } } } }));
  await userEvent.type(screen.getByLabelText("Answer"), "16/20");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(client.uiEvent).toHaveBeenCalledWith("a1", { kind: "feedback", path: "README.md", name: "say", text: "Result: 16/20" }));
  expect(client.chat).not.toHaveBeenCalled();
});
it("records open once even in StrictMode and records a say action without surfacing usage failures", async () => {
  const uiEvent = vi.fn().mockImplementation(async (_appId, event) => {
    if (event.kind === "open") throw new Error("offline");
    return { ok: true };
  });
  const chat = vi.fn().mockResolvedValue({ runId: null, messages: [] });
  const client = { uiEvent, chat } as unknown as StewardClient;
  render(<StrictMode><MemoryRouter><I18nProvider locale="en" messages={en}><GeneratedPage spec={spec({ press: { action: "say", params: { text: "done" } } })} path="home.ui.json" client={client} appId="a1" readOnly={false} refresh={() => {}} /></I18nProvider></MemoryRouter></StrictMode>);
  await waitFor(() => expect(uiEvent).toHaveBeenCalledTimes(1));
  expect(uiEvent).toHaveBeenCalledWith("a1", { kind: "open", path: "home.ui.json" });
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(uiEvent).toHaveBeenCalledWith("a1", { kind: "feedback", path: "home.ui.json", name: "say", text: "done" }));
  expect(uiEvent).toHaveBeenCalledTimes(2);
  expect(chat).not.toHaveBeenCalled();
});
it("toggles TaskList source lines and records the task path", async () => {
  const file = vi.fn().mockResolvedValue({ content: "# Day\n- [ ] Practice", revision: "r1" });
  const toggleCheckbox = vi.fn().mockResolvedValue({});
  const uiEvent = vi.fn().mockResolvedValue({ ok: true });
  const client = { file, toggleCheckbox, uiEvent } as unknown as StewardClient;
  const page = { root: "tasks", elements: { tasks: { type: "TaskList", props: { path: "day-1.md", section: null, title: "Today", showProgress: true }, children: [] } } };
  render(<MemoryRouter><I18nProvider locale="en" messages={en}><GeneratedPage spec={page} client={client} appId="a1" readOnly={false} refresh={() => {}} /></I18nProvider></MemoryRouter>);
  await userEvent.click(await screen.findByRole("checkbox", { name: "Practice" }));
  expect(toggleCheckbox).toHaveBeenCalledWith("a1", { path: "day-1.md", line: 2, checked: true, baseRevision: "r1" });
  await waitFor(() => expect(uiEvent).toHaveBeenCalledWith("a1", { path: "day-1.md", kind: "toggle" }));
});
it("shows a failed task save, refreshes a conflict, and retries only when the user checks again", async () => {
  const file = vi.fn().mockResolvedValueOnce({ content: "# Day\n- [ ] Practice", revision: "old" }).mockResolvedValue({ content: "- [ ] Practice", revision: "latest" });
  const toggleCheckbox = vi.fn().mockRejectedValueOnce(new StewardClientError("requestError", 409)).mockResolvedValue({});
  const uiEvent = vi.fn().mockResolvedValue({ ok: true });
  const client = { file, toggleCheckbox, uiEvent } as unknown as StewardClient;
  const page = { root: "tasks", elements: { tasks: { type: "TaskList", props: { path: "day.md", title: "Today", showProgress: true }, children: [] } } };
  render(<MemoryRouter><I18nProvider locale="en" messages={en}><GeneratedPage spec={page} client={client} appId="a1" readOnly={false} refresh={() => {}} /></I18nProvider></MemoryRouter>);
  await userEvent.click(await screen.findByRole("checkbox", { name: "Practice" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(en.steward.appFile.conflict);
  await waitFor(() => expect(file).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(uiEvent).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("checkbox"));
  await waitFor(() => expect(toggleCheckbox).toHaveBeenLastCalledWith("a1", { path: "day.md", line: 1, checked: true, baseRevision: "latest" }));
});
it.each([[false, "existing"], [true, "existing"], [false, "missing"]] as const)("renders a deterministic Panel (readOnly=%s, data file %s)", async (readOnly, data) => {
  const file = data === "existing" ? vi.fn().mockResolvedValue({ content: "weight\n", revision: "r1" }) : vi.fn().mockRejectedValue(new StewardClientError("requestError", 404));
  const addPanelEntry = vi.fn().mockResolvedValue({});
  const uiEvent = vi.fn().mockResolvedValue({ ok: true });
  const client = { file, addPanelEntry, uiEvent } as unknown as StewardClient;
  const props = { title: "Daily weight", data: "records.csv", fields: [{ key: "weight", label: "Weight", type: "number", required: true }], views: [{ kind: "table", columns: ["weight"] }] };
  const page = { root: "panel", elements: { panel: { type: "Panel", props, children: [] } } };
  render(<MemoryRouter><I18nProvider locale="en" messages={en}><GeneratedPage spec={page} path="home.ui.json" client={client} appId="a1" readOnly={readOnly} refresh={() => {}} /></I18nProvider></MemoryRouter>);
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
  render(<MemoryRouter><I18nProvider locale="en" messages={en}><GeneratedPage spec={page} client={client} appId="a1" readOnly={false} refresh={() => {}} /><Location /></I18nProvider></MemoryRouter>);
  const link = await screen.findByRole("link", { name: "诊断材料" });
  await userEvent.click(link);
  expect(screen.getByLabelText("location")).toHaveTextContent(`/en/apps/a1?${new URLSearchParams({ path: "01-口语诊断材料.md" })}`);
  expect(screen.getByRole("link", { name: "source" })).toHaveAttribute("href", "https://example.com");
  expect(screen.getByText("练习").tagName).toBe("STRONG");
});
it("refreshes source tasks after background work without recording a user toggle", async () => {
  const file = vi.fn().mockResolvedValueOnce({ content: "- [ ] Practice", revision: "r1" }).mockResolvedValue({ content: "- [x] Practice", revision: "r2" });
  const uiEvent = vi.fn().mockResolvedValue({ ok: true });
  const client = { file, uiEvent } as unknown as StewardClient;
  const page = { root: "tasks", elements: { tasks: { type: "TaskList", props: { path: "day.md", title: "Today", showProgress: true }, children: [] } } };
  const content = (version: string) => <MemoryRouter><I18nProvider locale="en" messages={en}><GeneratedPage spec={page} client={client} appId="a1" readOnly={false} refreshVersion={version} refresh={() => {}} /></I18nProvider></MemoryRouter>;
  const view = render(content("first"));
  expect(await screen.findByRole("checkbox")).not.toBeChecked();
  view.rerender(content("second"));
  await waitFor(() => expect(screen.getByRole("checkbox")).toBeChecked());
  expect(file).toHaveBeenCalledTimes(2);
  expect(uiEvent).not.toHaveBeenCalled();
});
it("keeps an unsent form answer when a refreshed spec changes its initial state", async () => {
  const client = { chat: vi.fn() } as unknown as StewardClient;
  const page = spec({ press: { action: "say", params: { text: "answer" } } });
  const content = (value: unknown, version: string) => <MemoryRouter><I18nProvider locale="en" messages={en}><GeneratedPage spec={value} client={client} appId="a1" readOnly={false} refreshVersion={version} refresh={() => {}} /></I18nProvider></MemoryRouter>;
  const view = render(content(page, "first"));
  await userEvent.type(screen.getByLabelText("Answer"), "My unsent answer");
  view.rerender(content({ ...page, state: { answer: "new default" } }, "second"));
  expect(screen.getByLabelText("Answer")).toHaveValue("My unsent answer");
});
it("refreshes untouched defaults and read-only state alongside a dirty answer", async () => {
  const client = { chat: vi.fn(), uiEvent: vi.fn().mockResolvedValue({ ok: true }) } as unknown as StewardClient;
  const page = spec({ press: { action: "say", params: { text: { $template: "Result: ${/answer}" } } } });
  const elements = {
    ...page.elements,
    main: { ...page.elements.main, children: ["answer", "other", "count", "send"] },
    other: { type: "Input", props: { label: "Other", name: "other", value: { $bindState: "/other" } }, children: [] },
    count: { type: "Text", props: { text: { $template: "Count: ${/count}" } }, children: [] },
  };
  const content = (state: Record<string, unknown>) => <MemoryRouter><I18nProvider locale="en" messages={en}><GeneratedPage spec={{ ...page, elements, state }} client={client} appId="a1" readOnly={false} refresh={() => {}} /></I18nProvider></MemoryRouter>;
  const view = render(content({ answer: "", other: "old", count: 1 }));
  await userEvent.type(screen.getByLabelText("Answer"), "draft");
  view.rerender(content({ answer: "server", other: "new", count: 2 }));
  expect(screen.getByLabelText("Answer")).toHaveValue("draft");
  expect(screen.getByLabelText("Other")).toHaveValue("new");
  expect(screen.getByText("Count: 2")).toBeInTheDocument();
  view.rerender(content({ answer: "another default", other: "newest", count: 3 }));
  expect(screen.getByLabelText("Answer")).toHaveValue("draft");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(client.uiEvent).toHaveBeenCalledWith("a1", { kind: "feedback", path: "README.md", name: "say", text: "Result: draft" }));
  expect(client.chat).not.toHaveBeenCalled();
});
it("does not act on an ended app and rejects specs outside the catalog", async () => {
  const client = setup(spec({ press: { action: "say", params: { text: "done" } } }), true);
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(client.chat).not.toHaveBeenCalled();
  expect(client.uiEvent).not.toHaveBeenCalled();
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
