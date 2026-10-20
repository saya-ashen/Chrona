import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import en from "../../../packages/i18n/src/messages/en.json";
import type { Affair } from "@chrona/contracts";
import { createStewardClient } from "../model/client";
import { detailFixture, fixtureTime, chatFixture, runFixture } from "../model/fixtures";
import { AffairArrangements, AffairCenterHeader, AffairNow, AffairTechnicalDetails, AffairTimeline } from "./affair-center";

afterEach(cleanup);
function setup(detail = detailFixture()) {
  const client = createStewardClient("ws");
  const refresh = vi.fn();
  const update = vi.spyOn(client, "updateAffair").mockResolvedValue(detail.affair);
  const chat = vi.spyOn(client, "chat").mockResolvedValue(chatFixture);
  render(<MemoryRouter><I18nProvider locale="en" messages={en}><AffairCenterHeader detail={detail} client={client} refresh={refresh} /><AffairArrangements detail={detail} client={client} refresh={refresh} /><AffairNow detail={detail} /><AffairTimeline detail={detail} client={client} refresh={refresh} /><AffairTechnicalDetails detail={detail} /></I18nProvider></MemoryRouter>);
  return { update, chat };
}
it.each<{ work: Affair["work"]; text: string | null }>([
  { work: { state: "running", label: "Prepare day two", since: fixtureTime }, text: "Working on: Prepare day two" },
  { work: { state: "running", label: null, since: fixtureTime }, text: "Replying to your message" },
  { work: { state: "queued", label: "Prepare day two", since: fixtureTime }, text: "Up next: Prepare day two" },
  { work: null, text: null },
])("renders work status $text without duplicate summary", ({ work, text }) => {
  const detail = detailFixture(); detail.affair.work = work;
  setup(detail);
  if (text) expect(screen.getByRole("status")).toHaveTextContent(text);
  else expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getAllByText(detail.affair.summary)).toHaveLength(1);
});
it("shows an unfinished outcome without exposing raw errors and lets the user resume this affair", async () => {
  const detail = detailFixture(); detail.affair.openApprovals = 0; detail.approvals = []; detail.runs = [runFixture()];
  const { chat } = setup(detail);
  expect(screen.getByRole("alert")).toHaveTextContent("The last attempt did not finish");
  expect(screen.getByRole("alert")).not.toHaveTextContent("Internal provider detail");
  await userEvent.click(screen.getByRole("button", { name: "Continue work" }));
  expect(chat).toHaveBeenCalledWith({ affairId: "camera", text: expect.stringContaining("latest") });
});
it("shows an intentional stop without automatically restarting it", () => {
  const detail = detailFixture(); detail.runs = [{ ...runFixture(), status: "cancelled" }];
  const { chat } = setup(detail);
  expect(screen.getByText(en.steward.affairCenter.workCancelled)).toBeVisible();
  expect(screen.getByRole("button", { name: en.steward.affairCenter.resumeWork })).toBeEnabled();
  expect(chat).not.toHaveBeenCalled();
});
it("does not submit recovery twice while the first request is pending", async () => {
  const detail = detailFixture(); detail.runs = [runFixture()];
  const { chat } = setup(detail);
  let finish!: (value: typeof chatFixture) => void;
  chat.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const button = screen.getByRole("button", { name: "Continue work" });
  await userEvent.click(button);
  expect(button).toBeDisabled();
  await userEvent.click(button);
  expect(chat).toHaveBeenCalledTimes(1);
  finish(chatFixture);
  await waitFor(() => expect(button).toBeEnabled());
});
it("does not offer a duplicate retry when work is already queued", () => {
  const detail = detailFixture(); detail.runs = [runFixture()];
  detail.affair.work = { state: "queued", label: "Prepare day two", since: fixtureTime };
  setup(detail);
  expect(screen.queryByRole("button", { name: "Continue work" })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Up next: Prepare day two");
  expect(screen.getByText(en.steward.affairCenter.workRecovering)).toBeVisible();
});
it("keeps wake instructions only in collapsed technical details", async () => {
  const detail = detailFixture();
  detail.schedules[0] = { ...detail.schedules[0]!, mode: "wake", label: "Prepare day two", text: "chrona_notify level now internal instruction" };
  setup(detail);
  expect(screen.getByText("Prepare day two", { selector: "p" })).toBeVisible();
  expect(screen.getByText("chrona_notify level now internal instruction")).not.toBeVisible();
  await userEvent.click(screen.getByText(/^Technical details:/, { selector: "summary" }));
  expect(screen.getByText("chrona_notify level now internal instruction")).toBeVisible();
});
it.each(["active", "paused"] as const)("hides module schedule controls when %s", status => {
  const detail = detailFixture(); detail.affair.status = "done";
  detail.schedules[0] = { ...detail.schedules[0]!, mode: "module", status, label: "Price watcher" };
  setup(detail);
  expect(screen.getByText("Price watcher", { selector: "p" })).toBeVisible();
  for (const name of ["Pause", "Resume", "Cancel schedule"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
});

it.each(["done", "cancelled"] as const)("collapses %s arrangements", async status => {
  const detail = detailFixture(); detail.schedules[0]!.status = status; detail.schedules[0]!.label = "Old arrangement";
  setup(detail);
  expect(screen.getAllByText("Old arrangement").every(item => !item.closest("details")?.open)).toBe(true);
  await userEvent.click(screen.getByText("Completed arrangements (1)"));
  expect(screen.getByText(/Old arrangement ·/)).toBeVisible();
});
it("renders timeline message and grouped page links, not run logs", () => {
  const detail = detailFixture(); detail.messages = chatFixture.messages;
  detail.activity = [{ id: "edit", affairId: "camera", at: fixtureTime, actor: "chrona", kind: "edit", text: "internal edit", data: { commit: "abc", paths: ["README.md", "plan.md"] } }, { id: "run", affairId: "camera", at: fixtureTime, actor: "chrona", kind: "run", text: "message finished", data: null }];
  setup(detail);
  expect(screen.getByText(chatFixture.messages[0]!.text)).toBeVisible();
  expect(screen.getByRole("link", { name: "plan" })).toHaveAttribute("href", "/en/affairs/camera?path=plan.md");
  expect(screen.queryByText("message finished")).not.toBeInTheDocument();
});
it("shows twenty timeline entries first and expands long messages only", async () => {
  const detail = detailFixture();
  detail.messages = Array.from({ length: 21 }, (_, index) => ({ ...chatFixture.messages[0]!, id: `message-${index}`, text: index === 20 ? `Update ${index}\n${"detail ".repeat(20)}` : `Update ${index}`, at: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString() }));
  setup(detail);
  expect(screen.queryByText("Update 0")).not.toBeInTheDocument();
  expect(screen.getByText(/Update 20/)).toBeVisible();
  expect(screen.getAllByRole("button", { name: "Expand" })).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Expand" }));
  expect(screen.getByRole("button", { name: "Collapse" })).toHaveAttribute("aria-expanded", "true");
  await userEvent.click(screen.getByRole("button", { name: "Show more" }));
  expect(screen.getByText("Update 0")).toBeVisible();
});
it.each(["active", "paused"] as const)("changes affair status from %s in header", async status => {
  const detail = detailFixture(); detail.affair.status = status; detail.schedules = [];
  const { update } = setup(detail);
  await userEvent.click(screen.getByRole("button", { name: status === "active" ? "Pause" : "Resume" }));
  expect(update).toHaveBeenCalledWith("camera", { status: status === "active" ? "paused" : "active" });
});
it("sends a supplement linked to this affair", async () => {
  const { chat } = setup();
  await userEvent.type(screen.getByRole("textbox", { name: "Add" }), "Compare lighter cameras");
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(chat).toHaveBeenCalledWith({ text: "Compare lighter cameras", affairId: "camera" });
});
it("hides the supplement and creation actions for ended affairs", () => {
  const detail = detailFixture(); detail.affair.status = "done";
  setup(detail);
  expect(screen.queryByRole("textbox", { name: "Add" })).not.toBeInTheDocument();
  expect(screen.queryByText("Add arrangement")).not.toBeInTheDocument();
});
it("renders empty arrangements and confirms before ending", async () => {
  const detail = detailFixture(); detail.schedules = [];
  const { update } = setup(detail);
  expect(screen.getByText(en.steward.affairCenter.noSchedules)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "End" }));
  expect(update).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(update).toHaveBeenCalledWith("camera", { status: "done" });
});
