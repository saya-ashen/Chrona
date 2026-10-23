import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import en from "../../../packages/i18n/src/messages/en.json";
import { apiJson } from "@shared/http";
import { emptyToday, sessionFixture } from "../model/fixtures";
import { StewardSession } from "../hooks/use-steward-session";
import { ChatPage } from "./chat-page";
vi.mock("@shared/http", () => ({ apiJson: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("creates, switches, renames and ends web sessions", async () => {
  const c = en.steward.sessions;
  let sessions = [sessionFixture(), { ...sessionFixture(), id: "session-2", key: "web:session-2", title: "Second session" }];
  vi.mocked(apiJson).mockImplementation(async (url, options) => {
    const path = String(url).split("?")[0]!;
    if (path.endsWith("/today")) return emptyToday();
    if (path.endsWith("/sessions/new")) {
      const created = { ...sessionFixture(), id: "session-3", key: JSON.parse(String(options?.body)).key, title: "New session" };
      sessions = [...sessions, created]; return created;
    }
    if (path.endsWith("/sessions")) return { items: sessions };
    const session = sessions.find(item => path.endsWith(`/sessions/${item.id}`));
    if (session) {
      if (options?.method === "PATCH") Object.assign(session, JSON.parse(String(options.body)));
      return { ...session };
    }
    return { items: [] };
  });
  render(<MemoryRouter initialEntries={["/en/chat?sessionId=session-1"]}><I18nProvider locale="en" messages={en}><StewardSession workspaceId="ws"><ChatPage /></StewardSession></I18nProvider></MemoryRouter>);
  const nav = await screen.findByRole("navigation", { name: c.select });
  await userEvent.click(await within(nav).findByRole("button", { name: "Second session" }));
  expect(await screen.findByRole("heading", { name: "Second session" })).toBeVisible();
  await userEvent.type(screen.getByRole("textbox", { name: c.rename }), "Renamed session");
  await userEvent.click(screen.getByRole("button", { name: c.save }));
  expect(await screen.findByRole("heading", { name: "Renamed session" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: c.end }));
  expect(await screen.findByRole("heading", { name: `Renamed session · ${c.ended}` })).toBeVisible();
  expect(screen.queryByRole("button", { name: c.end })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: c.new }));
  expect(await screen.findByRole("heading", { name: "New session" })).toBeVisible();
  await waitFor(() => expect(within(nav).getByRole("button", { name: "New session" })).toHaveAttribute("aria-pressed", "true"));
  expect(apiJson).toHaveBeenCalledWith("/api/steward/sessions/session-2?workspaceId=ws", expect.objectContaining({ method: "PATCH", body: '{"status":"ended"}' }));
});
