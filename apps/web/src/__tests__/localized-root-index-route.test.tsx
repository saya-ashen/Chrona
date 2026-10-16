import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "react-router-dom";
import { createAppRouter } from "../router";
import en from "../../../../packages/i18n/src/messages/en.json";
import zh from "../../../../packages/i18n/src/messages/zh.json";
import { apiJson } from "@shared/http";
import { emptyToday, chatFixture, detailFixture, fileFixture } from "@features/steward/test";

vi.mock("../loaders", () => ({ loadAppBootData: async ({ params }: { params: { lang: string } }) => ({ locale: params.lang, dictionary: params.lang === "zh" ? zh : en, defaultWorkspace: { id: "ws-1", name: "Chrona" } }) }));
vi.mock("@/components/access-key-gate", () => ({ AccessKeyGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@shared/http", () => ({ apiJson: vi.fn() }));
const settings = { chat: { channel: "chrona_qqbot", bound: true, sentToday: 2 }, notifications: { dailyCap: 5, quietHours: null, timezone: "Asia/Shanghai", digestAt: "09:00" } };
let router: ReturnType<typeof createAppRouter>;
function show(path: string) {
  window.history.replaceState(null, "", path);
  router = createAppRouter();
  render(<RouterProvider router={router} />);
}
beforeEach(() => vi.mocked(apiJson).mockImplementation(async url => {
  const path = String(url).split("?")[0]!;
  if (path.endsWith("/settings")) return settings;
  if (path.endsWith("/chat")) return chatFixture;
  if (path.endsWith("/health")) return emptyToday().health;
  if (path.endsWith("/file")) return fileFixture();
  if (path.endsWith("/affairs/camera")) return detailFixture();
  if (path.endsWith("/today")) return emptyToday();
  return { items: [] };
}));
afterEach(() => { cleanup(); router?.dispose(); vi.resetAllMocks(); });

describe("steward routes and shared shell", () => {
  it.each(["/en", "/en/today"])("shows Today at the localized root from %s", async path => {
    show(`${path}?filter=active#attention`);
    expect(await screen.findByRole("heading", { level: 1 })).toBeVisible();
    await waitFor(() => expect(router.state.location.pathname).toBe("/en"));
    expect(router.state.location.search).toBe("?filter=active");
    expect(router.state.location.hash).toBe("#attention");
    expect(within(screen.getByRole("navigation")).getAllByRole("link")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("textbox", { name: en.steward.foundation.composer })).toHaveLength(1);
    expect(await screen.findByText("Chat connected · Sent today 2/5")).toBeVisible();
    expect(apiJson).toHaveBeenCalledWith("/api/steward/settings?workspaceId=ws-1", expect.objectContaining({ method: "GET" }));
  });
  it.each([
    ["affairs", "Affairs", "Affairs"],
    ["affairs/camera", "二手相机选购", "Affairs"],
    ["settings", "Settings", "Settings"],
  ])("renders the page at %s", async (path, heading, active) => {
    show(`/en/${path}`);
    expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
    expect(screen.queryByText("Under construction")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: active })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("textbox", { name: en.steward.foundation.composer })).toBeVisible();
  });
  it.each([["/affairs/camera?path=trending.md", "/affairs/camera", "?path=trending.md"], ["/settings", "/settings", ""]])("redirects the unlocalized link %s Chrona sends out", async (link, pathname, search) => {
    show(link);
    await waitFor(() => expect(router.state.location.pathname).toMatch(new RegExp(`^/[a-z]{2}(-[A-Za-z]+)?${pathname}$`)));
    expect(router.state.location.search).toBe(search);
  });
  it.each(["home", "dashboard", "schedule", "action-center", "goals", "tasks", "work", "connections", "delegations", "affairs/camera/results/2"])("does not expose legacy %s", async path => {
    show(`/en/${path}`);
    expect(await screen.findByRole("heading", { name: "404" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/en");
    expect(screen.getByRole("textbox", { name: en.steward.foundation.composer })).toBeVisible();
  });
  it("retains the composer exchange when navigating", async () => {
    show("/en/settings");
    await userEvent.type(await screen.findByRole("textbox", { name: en.steward.foundation.composer }), "Budget 6000{Enter}");
    expect(await screen.findByText(/You · Budget 6000/)).toBeVisible();
    await userEvent.click(within(screen.getByRole("navigation", { name: en.steward.shell.navigation })).getByRole("link", { name: "Affairs" }));
    expect(await screen.findByRole("heading", { name: "Affairs" })).toBeVisible();
    expect(screen.getByText(/You · Budget 6000/)).toBeVisible();
  });
  it("renders Chinese navigation and budget", async () => {
    show("/zh/settings");
    expect(await screen.findByRole("heading", { name: "设置" })).toBeVisible();
    expect(await screen.findByText("聊天已连接 · 今天已推送 2/5")).toBeVisible();
    expect(screen.getByRole("link", { name: "今日" })).toHaveAttribute("href", "/zh");
    expect(screen.queryByText("建设中")).not.toBeInTheDocument();
  });
  it("shows disconnected status without inventing a connection", async () => {
    vi.mocked(apiJson).mockImplementation(async url => String(url).includes("/settings?") ? { ...settings, chat: { ...settings.chat, bound: false, sentToday: 0 } } : emptyToday());
    show("/en/settings");
    expect(await screen.findByText("Chat not connected")).toBeVisible();
    expect(screen.queryByText(/Sent today/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Chrona" })).toBeVisible();
  });
  it("shows status loading, failure and retry without a fake budget", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(apiJson).mockImplementation(async url => String(url).includes("/settings?") ? new Promise((_resolve, fail) => { reject = fail; }) : emptyToday());
    show("/en");
    expect(await screen.findByText("Loading…")).toBeVisible();
    await waitFor(() => expect(reject).toBeTypeOf("function"));
    reject(new Error("offline"));
    expect(await screen.findByText("Chat and notification status unavailable")).toBeVisible();
    expect(screen.queryByText(/Sent today/)).not.toBeInTheDocument();
    vi.mocked(apiJson).mockResolvedValue(settings);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Chat connected · Sent today 2/5")).toBeVisible();
  });
});
