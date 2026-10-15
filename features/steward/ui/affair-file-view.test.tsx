import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import { apiJson } from "@shared/http";
import en from "../../../packages/i18n/src/messages/en.json";
import { createStewardClient, StewardClientError } from "../model/client";
import { fileFixture, detailFixture, emptyToday, fixtureTime } from "../model/fixtures";
import { StewardSession } from "../hooks/use-steward-session";
import { AffairFileView, EditableFile } from "./affair-file-view";
import { AffairDetailPage, FileTree } from "./affair-detail-page";
import { fileTree } from "../model/affair-file";
vi.mock("@shared/http", () => ({ apiJson: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const client = () => createStewardClient("ws");
function editor(c = client(), content = "# Camera\n\n- [ ] Compare lenses") {
  render(<I18nProvider locale="en" messages={en}><EditableFile client={c} affairId="camera" initial={{ ...fileFixture(), content }} refresh={vi.fn()} /></I18nProvider>);
  return c;
}
it("optimistically checks a task and sends the exact source line and revision", async () => {
  const c = client(); let finish!: (value: ReturnType<typeof fileFixture>) => void;
  const request = vi.spyOn(c, "toggleCheckbox").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  editor(c);
  await userEvent.click(screen.getByRole("checkbox", { name: "Compare lenses" }));
  expect(screen.getByRole("checkbox")).toBeChecked(); expect(screen.getByRole("checkbox")).toBeDisabled();
  expect(request).toHaveBeenCalledWith("camera", { path: "README.md", line: 3, checked: true, baseRevision: "abc123" });
  finish({ ...fileFixture(), content: "# Camera\n\n- [x] Compare lenses", revision: "new" });
  await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
});
it("rolls back checkbox on 409 and shows a notice", async () => {
  const c = client(); vi.spyOn(c, "toggleCheckbox").mockRejectedValue(new StewardClientError("requestError", 409)); editor(c);
  await userEvent.click(screen.getByRole("checkbox"));
  expect(await screen.findByRole("alert")).toHaveTextContent("changed elsewhere"); expect(screen.getByRole("checkbox")).not.toBeChecked();
});
it("refreshes the revision after checkbox conflict before an explicit retry", async () => {
  const c = client();
  const toggle = vi.spyOn(c, "toggleCheckbox").mockRejectedValueOnce(new StewardClientError("requestError", 409)).mockResolvedValue({ ...fileFixture(), content: "- [x] Compare lenses", revision: "saved" });
  vi.spyOn(c, "file").mockResolvedValue({ ...fileFixture(), content: "- [ ] Compare lenses", revision: "latest" });
  editor(c);
  await userEvent.click(screen.getByRole("checkbox"));
  await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
  expect(screen.getByRole("alert")).toBeVisible();
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  await userEvent.click(screen.getByRole("checkbox"));
  expect(toggle).toHaveBeenLastCalledWith("camera", { path: "README.md", line: 1, checked: true, baseRevision: "latest" });
});
it("keeps an editor draft on a network failure", async () => {
  const c = client(); vi.spyOn(c, "saveFile").mockRejectedValue(new Error("offline")); editor(c);
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  await userEvent.clear(screen.getByRole("textbox")); await userEvent.type(screen.getByRole("textbox"), "Unsaved notes");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(en.steward.affairFile.error);
  expect(screen.getByRole("textbox")).toHaveValue("Unsaved notes");
});
it.each(["photo.png", "document.pdf"])("uses the scoped raw route for %s", path => {
  const c = client();
  render(<I18nProvider locale="en" messages={en}><AffairFileView client={c} affairId="camera" path={path} refresh={vi.fn()} /></I18nProvider>);
  expect(screen.getByRole("link")).toHaveAttribute("href", c.rawUrl("camera", path));
  if (path.endsWith("png")) expect(screen.getByRole("img")).toHaveAttribute("src", c.rawUrl("camera", path));
  else expect(screen.queryByRole("img")).not.toBeInTheDocument();
});
it("keeps the editor draft, shows both versions after conflict and explicitly retries with the new revision", async () => {
  const c = client();
  const save = vi.spyOn(c, "saveFile").mockRejectedValueOnce(new StewardClientError("requestError", 409)).mockResolvedValue({ ...fileFixture(), content: "My version", revision: "saved" });
  vi.spyOn(c, "file").mockResolvedValue({ ...fileFixture(), content: "Their version", revision: "theirs" }); editor(c);
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  await userEvent.clear(screen.getByRole("textbox")); await userEvent.type(screen.getByRole("textbox"), "My version");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Their version")).toBeVisible(); expect(screen.getByRole("textbox")).toHaveValue("My version");
  await userEvent.click(screen.getByRole("button", { name: "Retry with my version" }));
  expect(save).toHaveBeenLastCalledWith("camera", { path: "README.md", content: "My version", baseRevision: "theirs" });
  await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
});
it("shows invalid panel declarations without making a data request", () => {
  const c = client(); const load = vi.spyOn(c, "file");
  editor(c, '```chrona-panel\n{}\n```');
  expect(screen.getByRole("alert")).toHaveTextContent(en.steward.affairFile.invalidPanel);
  expect(load).not.toHaveBeenCalled();
});
it("shows file loading and a recoverable error", async () => {
  const c = client(); let reject!: (error: Error) => void;
  vi.spyOn(c, "file").mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  render(<I18nProvider locale="en" messages={en}><AffairFileView client={c} affairId="camera" path="notes.txt" refresh={vi.fn()} /></I18nProvider>);
  expect(screen.getByRole("status")).toBeVisible();
  reject(new Error("offline"));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByRole("button", { name: en.steward.foundation.retry })).toBeVisible();
});
it("renders a markdown panel from its CSV file and posts typed entries", async () => {
  const c = client(); const file = { ...fileFixture(), path: "weight.csv", mime: "text/csv", content: "day,kg\n2026-10-15,70\n" };
  const load = vi.spyOn(c, "file").mockResolvedValue(file);
  const add = vi.spyOn(c, "addPanelEntry").mockResolvedValue(file);
  const spec = { title: "Weight", data: "weight.csv", fields: [{ key: "day", label: "Day", type: "date" }, { key: "kg", label: "Weight (kg)", type: "number" }], views: [{ kind: "trend", x: "day", y: "kg" }] };
  editor(c, '```chrona-panel\n' + JSON.stringify(spec) + '\n```');
  expect(await screen.findByRole("table")).toHaveTextContent("70"); expect(screen.getByRole("img", { name: /Trend/ })).toBeVisible();
  expect(load).toHaveBeenCalledWith("camera", "weight.csv", expect.any(AbortSignal));
  await userEvent.type(screen.getByRole("spinbutton", { name: "Weight (kg)" }), "71");
  await userEvent.click(screen.getByRole("button", { name: "Add entry" }));
  await waitFor(() => expect(add).toHaveBeenCalledWith("camera", { dataPath: "weight.csv", values: { day: expect.any(String), kg: 71 } }));
});
it("renders a collapsible tree with README first and no metadata", async () => {
  const nodes = fileTree(["notes/day.md", ".chrona/state.json", "README.md"].map(path => ({ path, kind: "file", size: 0, updatedAt: fixtureTime })));
  render(<MemoryRouter><I18nProvider locale="en" messages={en}><FileTree nodes={nodes} selected="README.md" affairId="camera" /></I18nProvider></MemoryRouter>);
  expect(screen.getAllByRole("link")[0]).toHaveTextContent("README.md");
  expect(screen.queryByText(".chrona")).not.toBeInTheDocument(); expect(screen.getByText("day.md")).not.toBeVisible();
  await userEvent.click(screen.getByText("notes")); expect(screen.getByText("day.md")).toBeVisible();
});
it("loads the selected page, schedules, approvals and affair status controls", async () => {
  vi.mocked(apiJson).mockImplementation(async url => {
    const path = String(url); if (path.includes("/file?")) return { ...fileFixture(), path: "notes.txt", mime: "text/plain", content: "Selected notes" };
    if (path.includes("/affairs/camera?")) return { ...detailFixture(), files: [{ path: "notes.txt", kind: "file", size: 10, updatedAt: fixtureTime }] };
    return emptyToday();
  });
  render(<MemoryRouter initialEntries={["/en/affairs/camera?path=notes.txt"]}><I18nProvider locale="en" messages={en}><StewardSession workspaceId="ws"><Routes><Route path="/:lang/affairs/:affairId" element={<AffairDetailPage />} /></Routes></StewardSession></I18nProvider></MemoryRouter>);
  expect(await screen.findByText("Selected notes")).toBeVisible(); expect(screen.getByText(/Daily at 18:00/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Allow once" })).toBeVisible(); expect(screen.getByRole("button", { name: "Cancel schedule" })).toBeVisible(); expect(screen.getByRole("button", { name: "End" })).toBeVisible();
});
