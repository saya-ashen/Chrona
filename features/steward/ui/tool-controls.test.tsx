import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@chrona/i18n/react";
import en from "@chrona/i18n/messages/en.json";
import type { ManagedTool, ToolState } from "@chrona/contracts";
import type { ReactNode } from "react";
import type { StewardClient } from "../model/client";
import { ToolRow } from "./tool-row";
import { ToolGenerator } from "./tool-generator";
import { StewardStatus } from "./steward-status";
import { emptyToday, timestamp } from "../model/fixtures";
const tool: ManagedTool = { id: "t1", affairId: "a1", kind: "script", name: "Watcher", purpose: "Watch", handlingMode: "script", selectionRationale: "Repeated rules", dataScopes: [], version: 7, state: "generated", validationSummary: null, validatedVersion: null, authorizedAt: null, enabledAt: null, lastRunAt: null, lastSuccessAt: null, lastFailureAt: null, createdAt: timestamp, updatedAt: timestamp };
function show(child: ReactNode) { render(<I18nProvider locale="en" messages={en}>{child}</I18nProvider>); }
function client(values: Partial<StewardClient>) { return values as StewardClient; }
afterEach(cleanup);
it.each<[ToolState, string[]]>([["generated", ["Validate"]], ["validation_failed", []], ["validated", ["Authorize"]], ["authorized", ["Enable"]], ["enabled", ["Run now", "Disable"]], ["disabled", ["Enable", "Retire"]], ["retired", []]])("renders exactly the buttons for %s", (state, names) => {
  show(<ToolRow tool={{ ...tool, state }} events={[]} client={client({})} refresh={() => {}} />);
  expect(screen.queryAllByRole("button").map(button => button.textContent)).toEqual(names);
  expect(screen.getByLabelText("Tool progress").children).toHaveLength(4);
});
it("posts expectedVersion and refetches conflict while displaying server reason", async () => {
  const transitionTool = vi.fn().mockRejectedValue({ status: 409, message: "Version changed to 8" }), refresh = vi.fn();
  show(<ToolRow tool={tool} events={[]} client={client({ transitionTool })} refresh={refresh} />);
  await userEvent.click(screen.getByRole("button", { name: "Validate" }));
  expect(transitionTool).toHaveBeenCalledWith("t1", { action: "validate", expectedVersion: 7 });
  expect(await screen.findByRole("alert")).toHaveTextContent("Version changed to 8"); expect(refresh).toHaveBeenCalledOnce();
});
it.each(["Tool is not enabled", "Not permitted by a delegation"])("renders run refusal: %s", async message => {
  const runTool = vi.fn().mockRejectedValue({ status: 409, message });
  show(<ToolRow tool={{ ...tool, state: "enabled" }} events={[]} client={client({ runTool })} refresh={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "Run now" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(message); expect(runTool).toHaveBeenCalledWith("t1", { events: [] });
});
it("renders successful matches and rows", async () => {
  const runTool = vi.fn().mockResolvedValue({ matches: [{ index: 0, matched: true, disposition: "retain", note: "Keep this" }], rows: [{ title: "Result title" }] });
  show(<ToolRow tool={{ ...tool, state: "enabled" }} events={[]} client={client({ runTool })} refresh={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "Run now" })); expect(await screen.findByText("Result title")).toBeVisible(); expect(screen.getByText(/Keep this/)).toBeVisible();
});
it("created=false is a successful answer with mode and rationale", async () => {
  const generateTool = vi.fn().mockResolvedValue({ created: false, choice: { mode: "direct_answer", rationale: "A one-off answer is enough" } });
  show(<ToolGenerator affairId="a1" client={client({ generateTool })} refresh={() => {}} />);
  await userEvent.click(screen.getByText(en.steward.controls.needTool));
  await userEvent.type(screen.getByLabelText("Name"), "Check"); await userEvent.type(screen.getByLabelText("Purpose"), "One question");
  await userEvent.type(screen.getByLabelText("Keywords (comma-separated)"), "urgent"); await userEvent.type(screen.getByLabelText("Note"), "Keep");
  await userEvent.type(screen.getAllByLabelText("Sample title")[0]!, "urgent"); await userEvent.type(screen.getAllByLabelText("Sample title")[1]!, "hello");
  await userEvent.click(screen.getByRole("button", { name: "Choose handling" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Direct answer — No tool needed: A one-off answer is enough"); expect(screen.queryByRole("alert")).toBeNull();
  expect(generateTool).toHaveBeenCalledWith(expect.objectContaining({ affairId: "a1", spec: expect.objectContaining({ type: "event_rule", cases: expect.arrayContaining([expect.objectContaining({ expectMatch: true }), expect.objectContaining({ expectMatch: false })]) }) }));
});
it("submits the guided table panel with selected columns and source", async () => {
  const generateTool = vi.fn().mockResolvedValue({ created: true, choice: { mode: "panel", rationale: "Compare repeatedly" }, tool });
  show(<ToolGenerator affairId="a1" client={client({ generateTool })} refresh={() => {}} />);
  await userEvent.click(screen.getByText(en.steward.controls.needTool));
  await userEvent.type(screen.getByLabelText("Name"), "Compare"); await userEvent.type(screen.getByLabelText("Purpose"), "Compare changes");
  await userEvent.click(screen.getByRole("combobox", { name: "Specification" })); await userEvent.click(screen.getByRole("option", { name: "Table panel" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Author" }));
  await userEvent.click(screen.getByRole("combobox", { name: "Source" })); await userEvent.click(screen.getByRole("option", { name: "Affair attention items" }));
  await userEvent.click(screen.getByRole("button", { name: "Choose handling" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Tool generated");
  expect(generateTool).toHaveBeenCalledWith(expect.objectContaining({ spec: { type: "table_panel", columns: [{ key: "title", label: "Title" }, { key: "author", label: "Author" }], source: "affair_attention" } }));
});
it.each([null, "2000-01-01T00:00:00Z"])("warns when tick is %s", async lastTickAt => {
  show(<StewardStatus health={{ ...emptyToday().health, lastTickAt }} />);
  expect(screen.getByRole("alert")).toHaveTextContent(en.steward.controls.staleWarning);
  expect(within(screen.getByRole("region")).getByText(/Queued notifications: 0/)).toBeVisible();
});
it("shows status even without a loaded health response", () => { show(<StewardStatus />); expect(screen.getByRole("region", { name: "Steward status" })).toBeVisible(); });
it("recent tick has no warning", async () => { show(<StewardStatus health={{ ...emptyToday().health, lastTickAt: new Date().toISOString() }} />); await waitFor(() => expect(screen.queryByRole("alert")).toBeNull()); });
