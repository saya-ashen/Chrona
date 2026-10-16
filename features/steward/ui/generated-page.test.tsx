import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
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
  const client = { chat } as unknown as StewardClient;
  render(<MemoryRouter><I18nProvider locale="en" messages={en}><GeneratedPage spec={page} client={client} affairId="a1" readOnly={readOnly} refresh={() => {}} /></I18nProvider></MemoryRouter>);
  return chat;
}
it("sends the say action with state interpolated, linked to the affair", async () => {
  const chat = setup(spec({ press: { action: "say", params: { text: { $template: "Result: ${/answer}" } } } }));
  await userEvent.type(screen.getByLabelText("Answer"), "16/20");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(chat).toHaveBeenCalledWith({ affairId: "a1", text: "Result: 16/20" }));
});
it("does not act on an ended affair and rejects specs outside the catalog", async () => {
  const chat = setup(spec({ press: { action: "say", params: { text: "done" } } }), true);
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(chat).not.toHaveBeenCalled();
  cleanup();
  setup({ root: "x", elements: { x: { type: "Script", props: {}, children: [] } } });
  expect(screen.getByRole("alert")).toBeInTheDocument();
});
