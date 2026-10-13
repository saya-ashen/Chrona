import { MemoryRouter } from "react-router-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StewardListPage, type StewardListKind } from "./steward-list-page";
import { I18nProvider } from "@chrona/i18n/react";
import en from "@chrona/i18n/messages/en.json";
const mocks = vi.hoisted(() => ({ affairs: vi.fn(), delegations: vi.fn(), connections: vi.fn() }));
vi.mock("../model/client", () => ({ createStewardClient: () => mocks }));
function show(kind: StewardListKind) { render(<I18nProvider locale="en" messages={en}><MemoryRouter><StewardListPage workspaceId="workspace-test" kind={kind} /></MemoryRouter></I18nProvider>); }
afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());
describe.each<StewardListKind>(["affairs"])("%s list", kind => {
  it("announces loading", () => { mocks[kind].mockReturnValue(new Promise(() => {})); show(kind); expect(screen.getByRole("status")).toHaveTextContent(en.steward.loading); });
  it("shows errors with a reload action", async () => { mocks[kind].mockRejectedValue(new Error("offline")); show(kind); expect(await screen.findByRole("alert")).toHaveTextContent(en.steward.error); expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled(); });
  it("shows an empty list", async () => { mocks[kind].mockResolvedValue({ items: [] }); show(kind); expect(await screen.findByText(en.steward.empty)).toBeVisible(); });
  it("renders title and status rows", async () => {
    const title = kind === "affairs" ? { title: "Travel plans" } : kind === "delegations" ? { purpose: "Watch travel updates" } : { label: "Test source" };
    mocks[kind].mockResolvedValue({ items: [{ id: "item-1", ...title, status: "paused" }] }); show(kind);
    expect(await screen.findByRole("listitem")).toHaveTextContent(Object.values(title)[0]);
    expect(screen.getByText("Paused")).toBeVisible();
  });
});
