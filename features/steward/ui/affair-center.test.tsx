import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import en from "../../../packages/i18n/src/messages/en.json";
import type { Affair } from "@chrona/contracts";
import { createStewardClient } from "../model/client";
import { detailFixture, fixtureTime, chatFixture } from "../model/fixtures";
import { AffairArrangements, AffairCenterHeader, AffairTechnicalDetails, AffairTimeline } from "./affair-center";

afterEach(cleanup);
function setup(detail = detailFixture()) {
  const client = createStewardClient("ws");
  const refresh = vi.fn();
  const update = vi.spyOn(client, "updateAffair").mockResolvedValue(detail.affair);
  render(<MemoryRouter><I18nProvider locale="en" messages={en}><AffairCenterHeader detail={detail} client={client} refresh={refresh} /><AffairArrangements detail={detail} client={client} refresh={refresh} /><AffairTimeline detail={detail} /><AffairTechnicalDetails detail={detail} /></I18nProvider></MemoryRouter>);
  return { update };
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
  expect(screen.queryByText(detail.affair.summary)).not.toBeInTheDocument();
});
it("keeps wake instructions only in collapsed technical details", async () => {
  const detail = detailFixture();
  detail.schedules[0] = { ...detail.schedules[0]!, mode: "wake", label: "Prepare day two", text: "chrona_notify level now internal instruction" };
  setup(detail);
  expect(screen.getByText("Prepare day two", { selector: "p" })).toBeVisible();
  expect(screen.getByText("chrona_notify level now internal instruction")).not.toBeVisible();
  await userEvent.click(screen.getByText("Technical details", { selector: "summary" }));
  expect(screen.getByText("chrona_notify level now internal instruction")).toBeVisible();
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
  expect(screen.getByText(`Chrona: ${chatFixture.messages[0]!.text}`)).toBeVisible();
  expect(screen.getByRole("link", { name: "plan" })).toHaveAttribute("href", "/en/affairs/camera?path=plan.md");
  expect(screen.queryByText("message finished")).not.toBeInTheDocument();
});
it("shows twenty timeline entries first and expands long messages only", async () => {
  const detail = detailFixture();
  detail.messages = Array.from({ length: 21 }, (_, index) => ({ ...chatFixture.messages[0]!, id: `message-${index}`, text: index === 20 ? `Update ${index}\n${"detail ".repeat(20)}` : `Update ${index}`, at: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString() }));
  setup(detail);
  expect(screen.queryByText("Chrona: Update 0")).not.toBeInTheDocument();
  expect(screen.getByText(/Chrona: Update 20/)).toBeVisible();
  expect(screen.getAllByRole("button", { name: "Expand" })).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Expand" }));
  expect(screen.getByRole("button", { name: "Collapse" })).toHaveAttribute("aria-expanded", "true");
  await userEvent.click(screen.getByRole("button", { name: "Show more" }));
  expect(screen.getByText("Chrona: Update 0")).toBeVisible();
});
it.each(["active", "paused"] as const)("changes affair status from %s in header", async status => {
  const detail = detailFixture(); detail.affair.status = status; detail.schedules = [];
  const { update } = setup(detail);
  await userEvent.click(screen.getByRole("button", { name: status === "active" ? "Pause" : "Resume" }));
  expect(update).toHaveBeenCalledWith("camera", { status: status === "active" ? "paused" : "active" });
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
