import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import en from "../../../packages/i18n/src/messages/en.json";
import { apiJson } from "@shared/http";
import { emptyToday } from "../model/fixtures";
import { StewardSession } from "../hooks/use-steward-session";
import { SettingsPage } from "./settings-page";
vi.mock("@shared/http", () => ({ apiJson: vi.fn() }));
const at = "2026-01-01T00:00:00Z";
const settings = {
  notifications: { dailyCap: 5, quietHours: null, timezone: "UTC", digestAt: "09:00" },
  chat: { channel: "chrona_qqbot", bound: false, sentToday: 2 },
};
const grant = {
  id: "g",
  action: "run_script",
  mode: "preapproved",
  scope: { kind: "affair", affairId: "a" },
  once: false,
  consumedAt: null,
  expiresAt: null,
  revokedAt: null,
  createdAt: at,
};
const preference = {
  id: "p",
  text: "Keep it brief",
  origin: "said",
  createdAt: at,
  lastUsedAt: null,
};
const tool = {
  id: "t",
  affairId: null,
  kind: "script",
  name: "Weekly summary",
  purpose: "Summarize",
  rationale: "",
  version: 3,
  approvedVersion: null,
  state: "draft",
  script: { language: "python", source: "print('summary')", usage: "" },
  spec: null,
  lastRunAt: null,
  lastRunOk: null,
  createdAt: at,
  updatedAt: at,
};
let fail = false;
let health = emptyToday().health;
function show() {
  render(
    <MemoryRouter>
      <I18nProvider locale="en" messages={en}>
        <StewardSession workspaceId="ws">
          <SettingsPage />
        </StewardSession>
      </I18nProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  fail = false;
  health = emptyToday().health;
  vi.mocked(apiJson).mockImplementation(async (url, options) => {
    const path = String(url).split("?")[0]!;
    if (options?.method && options.method !== "GET") {
      if (fail) throw new Error("offline");
      if (path.endsWith("/settings")) return settings as never;
      if (path.endsWith("/revoke")) return { ...grant, revokedAt: at } as never;
      if (path.endsWith("/preferences/p")) return null as never;
      if (path.endsWith("/preferences")) return preference as never;
      if (path.endsWith("/transition"))
        return { ...tool, state: "approved", approvedVersion: 3 } as never;
    }
    if (path.endsWith("/settings")) return settings as never;
    if (path.endsWith("/today")) return emptyToday() as never;
    if (path.endsWith("/health")) return health as never;
    if (path.endsWith("/tools/t")) return { tool, entries: [], runs: [{ id: "r", toolId: "t", version: 2, status: "failed", output: "partial output", error: "script failed", startedAt: at, endedAt: at }] } as never;
    return {
      items: path.endsWith("/grants")
        ? [grant]
        : path.endsWith("/preferences")
          ? [preference]
          : path.endsWith("/tools")
            ? [tool]
            : [],
    } as never;
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("saves notifications, shows errors and retries", async () => {
  show();
  const cap = await screen.findByRole("spinbutton", { name: "Daily notification cap" });
  await userEvent.clear(cap);
  await userEvent.type(cap, "7");
  fail = true;
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not connect");
  expect(cap).toHaveValue(7);
  fail = false;
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Saved")).toBeVisible();
  expect(apiJson).toHaveBeenCalledWith(
    "/api/steward/settings?workspaceId=ws",
    expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ notifications: { dailyCap: 7, quietHours: null, digestAt: "09:00" } }),
    }),
  );
});
it("revokes scoped grants, deletes and adds preferences", async () => {
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Revoke" }));
  await waitFor(() =>
    expect(apiJson).toHaveBeenCalledWith(
      "/api/steward/grants/g/revoke?workspaceId=ws",
      expect.objectContaining({ method: "POST" }),
    ),
  );
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(apiJson).toHaveBeenCalledWith(
    "/api/steward/preferences/p?workspaceId=ws",
    expect.objectContaining({ method: "DELETE" }),
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Add a preference" }),
    "Only important news",
  );
  await userEvent.click(screen.getByRole("button", { name: "Add a preference" }));
  await waitFor(() =>
    expect(apiJson).toHaveBeenCalledWith(
      "/api/steward/preferences?workspaceId=ws",
      expect.objectContaining({ method: "POST", body: '{"text":"Only important news"}' }),
    ),
  );
});
it("shows script source before version-bound approval and immutable credentials", async () => {
  show();
  const region = await screen.findByRole("region", { name: "Tools" });
  expect(within(region).getByText("Review script source").closest("details")).not.toHaveAttribute(
    "open",
  );
  await userEvent.click(within(region).getByText("Recent script runs"));
  expect(within(region).getByText("partial output")).toBeVisible();
  expect(within(region).getByText("script failed")).toBeVisible();
  expect(screen.getByText(/Script sandbox · Unavailable/)).toBeVisible();
  await userEvent.click(within(region).getByText("Review script source"));
  expect(within(region).getByText("print('summary')")).toBeVisible();
  await userEvent.click(within(region).getByRole("button", { name: "Approve" }));
  expect(apiJson).toHaveBeenCalledWith(
    "/api/steward/tools/t/transition?workspaceId=ws",
    expect.objectContaining({ method: "POST", body: '{"action":"approve","expectedVersion":3}' }),
  );
  const row = screen.getByText("Change credentials").closest("tr")!;
  const origins = within(row).getAllByText("Cannot be changed");
  expect(origins).toHaveLength(2);
  expect(origins[0]).toHaveClass("sm:hidden");
  expect(origins[0]?.parentElement).toHaveTextContent("Change credentials");
  expect(origins[1]).toHaveClass("hidden", "sm:table-cell", "whitespace-nowrap", "min-w-24");
  expect(screen.getByRole("columnheader", { name: en.steward.settings.origin })).toHaveClass("hidden", "sm:table-cell");
  expect(within(row).queryByRole("combobox")).toBeNull();
});
it.each(["Pi", "none"])("shows health values and the %s agent label", async (name) => {
  health = { ...health, agent: { name, available: name === "Pi", lastError: name === "none" ? "Agent not enabled" : null }, queuedAffairs: 2, runningAffairs: 3, failedAffairs: 4, pendingEvents: 5, failingConnections: 6, queuedNotifications: 7, failedNotifications: 8 };
  show();
  const region = await screen.findByRole("region", { name: "Health" });
  expect(await within(region).findAllByText(name === "Pi" ? "Pi · Available" : "Agent not enabled")).toHaveLength(1);
  for (const [key, value] of Object.entries(health)) {
    if (typeof value !== "number") continue;
    const label = en.steward.settings[key as keyof typeof en.steward.settings];
    if (typeof label === "string") expect(within(region).getByText(label).nextElementSibling).toHaveTextContent(String(value));
  }
  expect(within(region).queryByText(/none ·/)).toBeNull();
});
it("renders empty collections honestly", async () => {
  vi.mocked(apiJson).mockImplementation(async (url) =>
    String(url).includes("/settings?")
      ? (settings as never)
      : String(url).includes("/today?")
        ? (emptyToday() as never)
        : String(url).includes("/health?")
          ? (emptyToday().health as never)
          : ({ items: [] } as never),
  );
  show();
  expect(await screen.findByText("Not bound")).toBeVisible();
  expect(
    within(screen.getByRole("region", { name: "Remembered preferences" })).getByText("None"),
  ).toBeVisible();
});
