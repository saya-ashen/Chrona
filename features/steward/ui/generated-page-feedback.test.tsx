import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@chrona/i18n/react";
import en from "../../../packages/i18n/src/messages/en.json";
import type { StewardClient } from "../model/client";
import { GeneratedPageFeedback } from "./generated-page-feedback";

afterEach(cleanup);
function setup(readOnly = false, uiEvent = vi.fn().mockResolvedValue({ ok: true })) {
  render(<I18nProvider locale="en" messages={en}><GeneratedPageFeedback client={{ uiEvent } as unknown as StewardClient} affairId="a1" path="home.ui.json" readOnly={readOnly} /></I18nProvider>);
  return uiEvent;
}
it("expands inline feedback and confirms successful delivery with page context", async () => {
  const uiEvent = setup();
  await userEvent.click(screen.getByRole("button", { name: en.steward.generatedPage.feedback }));
  await userEvent.type(screen.getByRole("textbox"), "Make the tasks clearer");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByRole("status")).toHaveTextContent(en.steward.generatedPage.sent);
  expect(uiEvent).toHaveBeenCalledWith("a1", { kind: "feedback", path: "home.ui.json", text: "Make the tasks clearer" });
});
it("hides feedback on done affairs", () => {
  setup(true);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("retains feedback on failure for retry", async () => {
  setup(false, vi.fn().mockRejectedValue(new Error("offline")));
  await userEvent.click(screen.getByRole("button", { name: en.steward.generatedPage.feedback }));
  await userEvent.type(screen.getByRole("textbox"), "Less clutter");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(en.steward.generatedPage.failed);
  expect(screen.getByRole("textbox")).toHaveValue("Less clutter");
});
