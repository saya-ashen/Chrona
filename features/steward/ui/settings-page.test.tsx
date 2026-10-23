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
const settings = { moduleModel: null, notifications: { dailyCap: 5, quietHours: null, timezone: "UTC", digestAt: "09:00" }, chat: { channel: "chrona_qqbot", bound: false, sentToday: 2 } };
const source = { id: "mail", kind: "email", label: "My mail", status: "active", settings: { folders: ["INBOX"] }, hasCredentials: true, canSend: false, lastSyncAt: null, lastError: null, pendingItems: 3, coverageNote: "INBOX only" };
let fail = false;
function show() { render(<MemoryRouter><I18nProvider locale="en" messages={en}><StewardSession workspaceId="ws"><SettingsPage /></StewardSession></I18nProvider></MemoryRouter>); }
beforeEach(() => {
  fail = false;
  vi.mocked(apiJson).mockImplementation(async (url, options) => {
    const path = String(url).split("?")[0]!;
    if (options?.method && options.method !== "GET" && fail) throw new Error("offline");
    if (path.endsWith("/settings")) return settings as never;
    if (path.endsWith("/today")) return emptyToday() as never;
    if (path.endsWith("/health")) return { ...emptyToday().health, provider: { name: "Pi", available: true, sandboxed: false, lastError: "Sandbox missing" } } as never;
    if (path.endsWith("/test")) return { ok: false, error: "Invalid credentials" } as never;
    if (path.endsWith("/sync") || path.endsWith("/mail")) return source as never;
    if (path.endsWith("/connectors")) return (options?.method === "POST" ? source : { items: [source] }) as never;
    if (path.endsWith("/items")) return { items: [{ id: "i", connectorId: "mail", externalId: "e", from: "A sender", subject: "Hello", receivedAt: "2026-01-01T00:00:00Z", ref: "files/inbox/mail.md", status: "delivered", ruleNote: "Batch rule" }] } as never;
    return { items: [] } as never;
  });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("saves notifications and supports retry after failure", async () => {
  show();
  const cap = await screen.findByRole("spinbutton", { name: "Daily notification cap" });
  await userEvent.clear(cap); await userEvent.type(cap, "7"); fail = true;
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getAllByRole("alert").some(alert => alert.textContent?.includes("Could not connect"))).toBe(true));
  fail = false; await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Saved")).toBeVisible();
});
it("loads the owner's configured module model without substituting defaults", async () => {
  const implementation = vi.mocked(apiJson).getMockImplementation()!;
  vi.mocked(apiJson).mockImplementation(async (url, options) => String(url).split("?")[0]!.endsWith("/settings") ? { ...settings, moduleModel: { model: "fake/owner-choice", maxCallsPerEvent: 3, maxOutputTokens: 800, dailyCalls: 12, timeoutMs: 45000 } } as never : implementation(url, options));
  show();
  const region = within(await screen.findByRole("region", { name: "Module model" }));
  expect(region.getByLabelText("Exact provider/model ID")).toHaveValue("fake/owner-choice");
  expect(region.getByLabelText("Calls per event")).toHaveValue(3);
  expect(region.getByLabelText("Maximum output tokens")).toHaveValue(800);
  expect(region.getByLabelText("Daily model calls")).toHaveValue(12);
  expect(region.getByLabelText("Event timeout (ms)")).toHaveValue(45000);
});
it("sets and clears the exact module model through settings PATCH, with retry on failure", async () => {
  show();
  const region = within(await screen.findByRole("region", { name: "Module model" }));
  expect(region.getByLabelText("Exact provider/model ID")).toHaveValue("");
  await userEvent.type(region.getByLabelText("Exact provider/model ID"), "fake/exact-model");
  for (const [label, value] of [["Calls per event", "2"], ["Maximum output tokens", "1500"], ["Daily model calls", "25"], ["Event timeout (ms)", "30000"]]) {
    const input = region.getByLabelText(label!);
    await userEvent.clear(input); await userEvent.type(input, value!);
  }
  fail = true;
  await userEvent.click(region.getByRole("button", { name: "Save module model" }));
  expect(await region.findByRole("alert")).toHaveTextContent("Could not connect");
  fail = false;
  await userEvent.click(region.getByRole("button", { name: "Save module model" }));
  expect(await region.findByText("Saved")).toBeVisible();
  expect(apiJson).toHaveBeenCalledWith("/api/steward/settings?workspaceId=ws", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ moduleModel: { model: "fake/exact-model", maxCallsPerEvent: 2, maxOutputTokens: 1500, dailyCalls: 25, timeoutMs: 30000 } }) }));
  await userEvent.click(region.getByRole("button", { name: "Clear module model" }));
  await waitFor(() => expect(region.getByLabelText("Exact provider/model ID")).toHaveValue(""));
  expect(apiJson).toHaveBeenCalledWith("/api/steward/settings?workspaceId=ws", expect.objectContaining({ method: "PATCH", body: '{"moduleModel":null}' }));
});
it("keeps quiet-hour inputs labelled and optional in the compact notification form", async () => {
  show();
  const quiet = await screen.findByRole("checkbox", { name: "Quiet hours enabled" });
  expect(screen.queryByLabelText("Quiet hours start")).toBeNull();
  expect(screen.getByText("notifications; extras go in the digest")).toBeVisible();
  await userEvent.click(quiet);
  expect(screen.getByLabelText("Quiet hours start")).toBeVisible();
  expect(screen.getByLabelText("Quiet hours end")).toBeVisible();
  await userEvent.click(quiet);
  expect(screen.queryByLabelText("Quiet hours end")).toBeNull();
  expect(screen.getByRole("region", { name: "Permissions" })).toBeVisible();
});
it("shows provider, v3 permissions and connector details; test failures remain failures", async () => {
  show();
  expect(await screen.findByText("Pi · Available")).toBeVisible();
  expect(screen.getByText("Sandbox unavailable (Bash disabled)")).toBeVisible();
  expect(screen.getByText("Sandbox missing")).toBeVisible();
  expect(screen.getByText("INBOX only")).toBeVisible();
  expect(screen.getByText(/Pending items: 3/)).toBeVisible();
  expect(screen.getByText("Activate a module")).toBeVisible();
  expect(screen.queryByText("Run a check")).toBeNull();
  expect(within(screen.getByText("Change credentials").closest("tr")!).queryByRole("combobox")).toBeNull();
  await userEvent.click(screen.getByText("Recent inbound items"));
  expect(await screen.findByText("Batch rule")).toBeVisible();
  expect(screen.getByRole("link", { name: "files/inbox/mail.md" })).toHaveAttribute("href", "/en/apps/files?path=inbox%2Fmail.md");
  await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
  expect(await screen.findByText("Connection test failed: Invalid credentials")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Sync now" }));
  expect(apiJson).toHaveBeenCalledWith("/api/steward/connectors/mail/sync?workspaceId=ws", expect.objectContaining({ method: "POST" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "Pause" }));
  expect(apiJson).toHaveBeenCalledWith("/api/steward/connectors/mail?workspaceId=ws", expect.objectContaining({ method: "PATCH", body: '{"settings":{"folders":["INBOX"]},"status":"paused"}' }));
});
it("adds email with a write-only password without creating an app", async () => {
  show(); await screen.findByText("My mail");
  await userEvent.click(screen.getByText("Add email connector", { selector: "summary" }));
  await userEvent.type(screen.getByLabelText("Email address"), "me@example.test");
  await userEvent.type(screen.getByLabelText("IMAP host"), "imap.example.test");
  const password = screen.getByLabelText("Password or app password");
  expect(password).toHaveAttribute("type", "password");
  await userEvent.type(password, "test-password");
  await userEvent.click(screen.getByRole("button", { name: "Add email connector" }));
  expect(apiJson).toHaveBeenCalledWith("/api/steward/connectors?workspaceId=ws", expect.objectContaining({ method: "POST", body: JSON.stringify({ kind: "email", label: "me@example.test", settings: { address: "me@example.test", imapHost: "imap.example.test", imapPort: 993, folders: ["INBOX"] }, secret: { password: "test-password" } }) }));
  expect(password).toHaveValue("");
});
