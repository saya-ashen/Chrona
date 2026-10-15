import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import en from "../../../packages/i18n/src/messages/en.json";
import { apiJson } from "@shared/http";
import { chatFixture, emptyToday, questionFixture, todayFixture } from "../model/fixtures";
import { TodayPage } from "./today-page";
import { Composer } from "./composer";
import { StewardSession, useStewardSession } from "../hooks/use-steward-session";
function TestPage() {
  const session = useStewardSession();
  return (
    <>
      <Composer
        client={session.today.client}
        lang="en"
        refresh={session.refresh}
        onPendingChange={session.setChatPending}
      />
      <TodayPage />
    </>
  );
}
vi.mock("@shared/http", () => ({ apiJson: vi.fn() }));
function show() {
  render(
    <MemoryRouter>
      <I18nProvider locale="en" messages={en}>
        <StewardSession workspaceId="ws">
          <TestPage />
        </StewardSession>
      </I18nProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.mocked(apiJson).mockResolvedValue(todayFixture());
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("renders sections and result links", async () => {
  show();
  for (const key of ["decisions", "changes", "results", "upcoming", "suggestions"] as const)
    expect(await screen.findByRole("heading", { name: en.steward.foundation[key] })).toBeVisible();
  expect(screen.getByRole("link", { name: "Read" })).toHaveAttribute(
    "href",
    "/en/affairs/camera/results/2",
  );
});
it("hides empty sections", async () => {
  vi.mocked(apiJson).mockResolvedValue(emptyToday());
  show();
  expect(await screen.findByRole("heading", { name: en.steward.foundation.clear })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Waiting for you" })).not.toBeInTheDocument();
});
it("answers and approves through scoped endpoints", async () => {
  show();
  await screen.findByRole("heading", { name: "Waiting for you" });
  vi.mocked(apiJson).mockResolvedValueOnce(questionFixture()).mockResolvedValue(todayFixture());
  await userEvent.type(screen.getByRole("textbox", { name: /Answer:/ }), "600g");
  await userEvent.click(screen.getByRole("button", { name: "Answer" }));
  await waitFor(() =>
    expect(apiJson).toHaveBeenCalledWith(
      "/api/steward/asks/weight/resolve?workspaceId=ws",
      expect.objectContaining({ body: '{"decision":"answer","text":"600g"}' }),
    ),
  );
  vi.mocked(apiJson).mockResolvedValueOnce(questionFixture()).mockResolvedValue(todayFixture());
  await userEvent.click(screen.getByRole("button", { name: "Allow once" }));
  await waitFor(() =>
    expect(apiJson).toHaveBeenCalledWith(
      "/api/steward/asks/script/resolve?workspaceId=ws",
      expect.objectContaining({ body: '{"decision":"approve","scope":"once"}' }),
    ),
  );
});
it("composer keeps Shift+Enter as a newline without sending", async () => {
  show();
  await screen.findByRole("heading", { name: "Waiting for you" });
  const input = screen.getByRole("textbox", { name: en.steward.foundation.composer });
  await userEvent.type(input, "First line{Shift>}{Enter}{/Shift}Second line");
  expect(input).toHaveValue("First line\nSecond line");
  expect(apiJson).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ method: "POST" }),
  );
});
it("composer sends, waits, then keeps the exchange with affair effects", async () => {
  show();
  await screen.findByRole("heading", { name: "Waiting for you" });
  let resolve!: (value: unknown) => void;
  vi.mocked(apiJson).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: en.steward.foundation.composer }),
    "Budget 6000{Enter}",
  );
  expect(screen.getByRole("status")).toHaveTextContent("Processing…");
  resolve(chatFixture);
  expect(await screen.findByRole("link", { name: chatFixture.effects[0]!.label })).toHaveAttribute(
    "href",
    "/en/affairs/camera",
  );
  expect(screen.getByText(/You · Budget 6000/)).toBeVisible();
});
