import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import en from "../../../packages/i18n/src/messages/en.json";
import type { StewardClient } from "../model/client";
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
