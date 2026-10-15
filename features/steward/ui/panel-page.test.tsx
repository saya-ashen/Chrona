import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@chrona/i18n/react";
import en from "../../../packages/i18n/src/messages/en.json";
import type { ToolDetail } from "@chrona/contracts";
import { createStewardClient, StewardClientError } from "../model/client";
import type { ToolSpec } from "../model/panel";
import { PanelContent } from "./panel-page";
afterEach(cleanup);
const spec: ToolSpec = { title: "Weight", description: "Daily measurements", fields: [{ key: "date", label: "Date", type: "date", required: true }, { key: "kg", label: "Weight", type: "number", required: true }], views: [{ kind: "table", columns: ["date", "kg"] }, { kind: "trend", x: "date", y: "kg" }] };
const at = "2026-01-01T00:00:00Z";
const entry = { id: "e", toolId: "t", values: { date: "2026-01-01", kg: 71 }, createdAt: at };
const detail: ToolDetail = { tool: { id: "t", affairId: "a", kind: "panel", name: "Weight", purpose: "Track", rationale: "Repeated", version: 1, approvedVersion: 1, state: "enabled", spec, script: null, lastRunAt: null, lastRunOk: null, createdAt: at, updatedAt: at }, entries: [], runs: [] };
function show(d = detail) {
  const client = createStewardClient("w");
  const add = vi.spyOn(client, "addPanelEntry").mockResolvedValue(entry);
  const remove = vi.spyOn(client, "deletePanelEntry").mockResolvedValue(null);
  const refresh = vi.fn();
  render(<I18nProvider locale="en" messages={en}><PanelContent spec={spec} detail={d} client={client} refresh={refresh} /></I18nProvider>);
  return { add, remove, refresh };
}
it("empty form validates before adding normalized values", async () => {
  const user = userEvent.setup(), { add, refresh } = show();
  expect(screen.getByText(en.steward.panel.empty)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Add entry" }));
  expect(screen.getByRole("alert").textContent).toContain("Check required");
  expect(add).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("Weight"), "71.2");
  await user.click(screen.getByRole("button", { name: "Add entry" }));
  await waitFor(() => expect(add).toHaveBeenCalledWith("t", { values: { date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), kg: 71.2 } }));
  expect(refresh).toHaveBeenCalled();
});
it("shows one labeled point without axes before the records", () => {
  show({ ...detail, entries: [entry] });
  const chart = screen.getByRole("img", { name: /Trend/ });
  expect(within(chart).getByText("71")).toBeTruthy();
  expect(within(chart).getByText("2026-01-01")).toBeTruthy();
  expect(chart.querySelector("svg")).toBeNull();
  expect(chart.compareDocumentPosition(screen.getByRole("table", { name: en.steward.panel.entries })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it("shows padded range and first and last dates for multiple points", () => {
  show({ ...detail, entries: [entry, { ...entry, id: "e2", values: { date: "2026-01-03", kg: 73 } }] });
  const chart = within(screen.getByRole("img", { name: /Trend/ }));
  for (const label of ["70.9", "73.1", "2026-01-01", "2026-01-03"]) expect(chart.getByText(label)).toBeTruthy();
  expect(chart.getByTitle("2026-01-01: 71")).toBeTruthy();
  expect(chart.getByTitle("2026-01-03: 73")).toBeTruthy();
});
it("shows chart labels and deletes only after inline confirmation", async () => {
  const user = userEvent.setup(), { remove } = show({ ...detail, entries: [entry] });
  expect(screen.getByRole("img", { name: /Trend/ })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(remove).not.toHaveBeenCalled();
  expect(screen.getByText("Delete this entry?")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith("t", "e"));
});
it("shows concrete validation failures from the server", async () => {
  const user = userEvent.setup(), { add } = show();
  add.mockRejectedValue(new StewardClientError("requestError", 400, "Weight is required"));
  await user.type(screen.getByLabelText("Weight"), "71");
  await user.click(screen.getByRole("button", { name: "Add entry" }));
  expect(await screen.findByText("Weight is required")).toBeTruthy();
});
it("disabled panel cannot add", () => {
  show({ ...detail, tool: { ...detail.tool, state: "disabled" } });
  expect(screen.getByText(en.steward.panel.disabled)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add entry" }).closest("fieldset")?.disabled).toBe(true);
});
