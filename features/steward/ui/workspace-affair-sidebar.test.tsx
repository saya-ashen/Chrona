import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import en from "../../../packages/i18n/src/messages/en.json";
import { createStewardClient } from "../model/client";
import { detailFixture, fixtureTime } from "../model/fixtures";
import { WorkspaceAffairSidebar } from "./workspace-affair-sidebar";

afterEach(cleanup);
function sidebar(detail = detailFixture()) {
  const client = createStewardClient("ws");
  const refresh = vi.fn();
  const updateAffair = vi.spyOn(client, "updateAffair").mockResolvedValue(detail.affair);
  const updateSchedule = vi.spyOn(client, "updateSchedule").mockResolvedValue(detail.schedules[0]!);
  render(<MemoryRouter><I18nProvider locale="en" messages={en}><WorkspaceAffairSidebar detail={detail} client={client} refresh={refresh} /></I18nProvider></MemoryRouter>);
  return { updateAffair, updateSchedule, refresh };
}
it.each(["active", "paused"] as const)("changes affair status from %s", async status => {
  const detail = detailFixture(); detail.affair.status = status; detail.schedules = [];
  const { updateAffair, refresh } = sidebar(detail);
  await userEvent.click(screen.getByRole("button", { name: status === "active" ? "Pause" : "Resume" }));
  expect(updateAffair).toHaveBeenCalledWith("camera", { status: status === "active" ? "paused" : "active" });
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
});
it("requires confirmation before ending an affair", async () => {
  const { updateAffair } = sidebar();
  await userEvent.click(screen.getByRole("button", { name: "End" }));
  expect(updateAffair).not.toHaveBeenCalled();
  await userEvent.click(within(screen.getByRole("group", { name: en.steward.affairFile.confirmEnd })).getByRole("button", { name: "Confirm" }));
  expect(updateAffair).toHaveBeenCalledWith("camera", { status: "done" });
});
it.each(["active", "paused"] as const)("changes schedule status from %s", async status => {
  const detail = detailFixture(); detail.affair.status = "done"; detail.schedules[0]!.status = status;
  const { updateSchedule } = sidebar(detail);
  await userEvent.click(screen.getByRole("button", { name: status === "active" ? "Pause" : "Resume" }));
  expect(updateSchedule).toHaveBeenCalledWith("reminder", { status: status === "active" ? "paused" : "active" });
  await userEvent.click(screen.getByRole("button", { name: "Cancel schedule" }));
  expect(updateSchedule).toHaveBeenLastCalledWith("reminder", { status: "cancelled" });
});
it("renders done, empty schedules and activity without obsolete controls", () => {
  const detail = detailFixture(); detail.affair.status = "done"; detail.schedules = []; detail.approvals = [];
  sidebar(detail);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.getByText(en.steward.affairFile.noSchedules)).toBeVisible();
  expect(screen.getByText(en.steward.affairFile.noActivity)).toBeVisible();
});
it("renders the affair timeline", () => {
  const detail = detailFixture();
  detail.activity = [{ id: "edit", affairId: "camera", at: fixtureTime, actor: "chrona", kind: "edit", text: "Updated the comparison", data: null }];
  sidebar(detail);
  expect(screen.getByRole("listitem")).toHaveTextContent("Updated the comparison");
  expect(screen.getByRole("listitem").querySelector("time")).toHaveAttribute("datetime", fixtureTime);
});
