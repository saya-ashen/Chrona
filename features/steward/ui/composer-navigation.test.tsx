import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Link, MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import en from "../../../packages/i18n/src/messages/en.json";
import type { StewardClient } from "../model/client";
import { chatFixture } from "../model/fixtures";
import { Composer } from "./composer";

afterEach(cleanup);
function setup(chat = vi.fn().mockResolvedValue(chatFixture)) {
  const client = { chat } as unknown as StewardClient;
  render(<MemoryRouter initialEntries={["/en"]}><I18nProvider locale="en" messages={en}><Composer client={client} lang="en" refresh={() => {}} /><Link to="/en/apps/camera">Read matter</Link></I18nProvider></MemoryRouter>);
  return chat;
}
it("does not carry an old exchange into a reading page or lose an unsent draft", async () => {
  setup();
  const input = screen.getByRole("textbox", { name: en.steward.foundation.composer });
  await userEvent.type(input, "Make a plan");
  await userEvent.click(screen.getByRole("button", { name: en.steward.foundation.send }));
  expect(await screen.findByRole("region", { name: en.steward.foundation.reply })).toBeVisible();
  await userEvent.type(input, "Unsent detail");
  await userEvent.click(screen.getByRole("link", { name: "Read matter" }));
  expect(screen.queryByRole("region", { name: en.steward.foundation.reply })).not.toBeInTheDocument();
  expect(input).toHaveValue("Unsent detail");
  await userEvent.click(screen.getByRole("button", { name: en.steward.foundation.send }));
  expect(await screen.findByRole("region", { name: en.steward.foundation.reply })).toHaveTextContent("Unsent detail");
});
it("does not insert a late response above a page opened while the request was pending", async () => {
  let finish!: (value: typeof chatFixture) => void;
  const chat = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  setup(chat);
  await userEvent.type(screen.getByRole("textbox"), "Make a plan");
  await userEvent.click(screen.getByRole("button", { name: en.steward.foundation.send }));
  await userEvent.click(screen.getByRole("link", { name: "Read matter" }));
  await act(async () => finish(chatFixture));
  await waitFor(() => expect(screen.getByRole("textbox")).toBeEnabled());
  expect(screen.queryByRole("region", { name: en.steward.foundation.reply })).not.toBeInTheDocument();
  expect(chat).toHaveBeenCalledTimes(1);
});
