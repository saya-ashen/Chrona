import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@chrona/i18n/react";
import en from "../../../packages/i18n/src/messages/en.json";
import { createStewardClient, StewardClientError } from "../model/client";
import { detailFixture } from "../model/fixtures";
import { AddSchedule, AffairFileActions } from "./affair-actions";

afterEach(cleanup);
function setup(schedule = false) {
  const client = createStewardClient("ws"), refresh = vi.fn();
  const save = vi.spyOn(client, "saveFile").mockResolvedValue({ path: "days/notes.md", content: "", mime: "text/markdown", revision: "sha", updatedAt: new Date().toISOString() });
  const upload = vi.spyOn(client, "upload").mockResolvedValue({ path: "days/paper.pdf", kind: "file", size: 1, updatedAt: new Date().toISOString() });
  const create = vi.spyOn(client, "createSchedule").mockResolvedValue(detailFixture().schedules[0]!);
  render(<I18nProvider locale="en" messages={en}>{schedule ? <AddSchedule client={client} affairId="camera" refresh={refresh} /> : <AffairFileActions client={client} affairId="camera" path="days/day-1.md" refresh={refresh} />}</I18nProvider>);
  return { save, upload, create, refresh };
}
it("creates an empty page in the current folder and refreshes", async () => {
  const { save, refresh } = setup();
  await userEvent.click(screen.getByRole("button", { name: "New page" }));
  await userEvent.type(screen.getByLabelText(en.steward.affairActions.pagePath), "notes.md");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(save).toHaveBeenCalledWith("camera", { path: "days/notes.md", content: "", baseRevision: null });
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(screen.getByLabelText(en.steward.affairActions.pagePath)).toHaveValue("");
});
it("uploads through picker and drop into current folder", async () => {
  const { upload } = setup();
  const file = new File(["pdf"], "paper.pdf", { type: "application/pdf" });
  await userEvent.upload(screen.getByLabelText("Upload files"), file);
  await waitFor(() => expect(upload).toHaveBeenCalledWith("camera", file, "days"));
  await waitFor(() => expect(screen.getByLabelText("Upload files")).not.toBeDisabled());
  fireEvent.drop(screen.getByRole("region", { name: "Add files" }), { dataTransfer: { files: [file] } });
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
});
it("keeps page input and shows error on conflict", async () => {
  const { save, refresh } = setup();
  save.mockRejectedValue(new StewardClientError("requestError", 409));
  await userEvent.click(screen.getByRole("button", { name: "New page" }));
  await userEvent.type(screen.getByLabelText(en.steward.affairActions.pagePath), "notes.md");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByLabelText(en.steward.affairActions.pagePath)).toHaveValue("notes.md");
  expect(refresh).not.toHaveBeenCalled();
});
it("shows pending until creation finishes, then refreshes", async () => {
  const { create, refresh } = setup(true);
  let resolve!: (value: ReturnType<typeof detailFixture>["schedules"][number]) => void;
  create.mockImplementation(() => new Promise(done => { resolve = done; }));
  await userEvent.click(screen.getByText("Add arrangement", { selector: "summary" }));
  await userEvent.type(screen.getByLabelText("Name (optional)"), "Study reminder");
  await userEvent.type(screen.getByLabelText("Message or instructions"), "Study");
  await userEvent.click(screen.getByRole("button", { name: "Add arrangement" }));
  expect(create).toHaveBeenCalledWith("camera", { mode: "remind", rule: { kind: "daily", time: "08:00" }, text: "Study", label: "Study reminder" });
  expect(screen.getByRole("button", { name: "Add arrangement" })).toBeDisabled();
  resolve(detailFixture().schedules[0]!);
  await waitFor(() => expect(refresh).toHaveBeenCalled());
});
