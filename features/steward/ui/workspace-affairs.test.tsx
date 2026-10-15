import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import { apiJson } from "@shared/http";
import en from "../../../packages/i18n/src/messages/en.json";
import { affairFixture, emptyToday } from "../model/fixtures";
import { StewardSession } from "../hooks/use-steward-session";
import { AffairsPage } from "./affairs-page";
vi.mock("@shared/http", () => ({ apiJson: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("renders status groups, schedule, activity and approvals; ended affairs start collapsed", async () => {
  const affair = affairFixture();
  vi.mocked(apiJson).mockImplementation(async url => String(url).includes("/affairs?") ? { items: [
    { ...affair, running: true, nextSchedule: { at: affair.createdAt, mode: "remind", text: "Compare lenses" } },
    { ...affair, id: "paused", title: "Paused affair", status: "paused" },
    { ...affair, id: "done", title: "Ended affair", status: "done" },
  ] } : emptyToday());
  render(<MemoryRouter><I18nProvider locale="en" messages={en}><StewardSession workspaceId="ws"><AffairsPage /></StewardSession></I18nProvider></MemoryRouter>);
  expect(await screen.findByRole("heading", { name: "In progress" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Paused" })).toBeVisible();
  expect(screen.getByText("Working")).toBeVisible();
  expect(screen.getByText(/Next schedule.*Compare lenses/)).toBeVisible();
  expect(screen.getAllByText("Open approvals · 1")).toHaveLength(3);
  expect(screen.getByText("Ended affair")).not.toBeVisible();
  await userEvent.click(screen.getByText("Ended · 1"));
  expect(screen.getByRole("link", { name: "Ended affair" })).toBeVisible();
});
