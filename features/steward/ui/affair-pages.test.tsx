import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import en from "../../../packages/i18n/src/messages/en.json";
import { apiJson } from "@shared/http";
import { affairFixture, detailFixture, emptyToday } from "../model/fixtures";
import { StewardSession } from "../hooks/use-steward-session";
import { AffairsPage } from "./affairs-page";
import { AffairDetailPage } from "./affair-detail-page";
import { ResultPage } from "./result-page";
vi.mock("@shared/http", () => ({ apiJson: vi.fn() }));
let detail = detailFixture();
let items = [affairFixture()];
let mutation: ((path: string, body: Record<string, unknown>) => Promise<unknown>) | undefined;
function show(path = "/en/affairs/camera") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider locale="en" messages={en}>
        <StewardSession workspaceId="ws">
          <Routes>
            <Route path="/:lang/affairs" element={<AffairsPage />} />
            <Route path="/:lang/affairs/:affairId" element={<AffairDetailPage />} />
            <Route path="/:lang/affairs/:affairId/results/:version" element={<ResultPage />} />
          </Routes>
        </StewardSession>
      </I18nProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  detail = detailFixture();
  items = [affairFixture()];
  mutation = undefined;
  vi.mocked(apiJson).mockImplementation(async (url, options) => {
    const path = String(url).split("?")[0]!;
    if (options?.method && options.method !== "GET") {
      const body = JSON.parse(String(options.body ?? "{}")) as Record<string, unknown>;
      if (mutation) return mutation(path, body) as never;
      if (path.endsWith("/entries")) return { ...detail.entries[0], ...body } as never;
      if (path.endsWith("/revoke"))
        return { ...detail.grants[0], revokedAt: new Date().toISOString() } as never;
      return { ...detail.affair, ...body } as never;
    }
    if (path.endsWith("/today")) return emptyToday() as never;
    if (path.endsWith("/settings"))
      return {
        notifications: { dailyCap: 5, quietHours: null, timezone: "UTC", digestAt: "09:00" },
        chat: { channel: "in_app", bound: false, sentToday: 0 },
      } as never;
    if (path.endsWith("/affairs")) return { items } as never;
    if (path.includes("/results/")) {
      const version = Number(path.split("/").at(-1));
      return { ...detail.latestResult, version, body: `Reading version ${version}` } as never;
    }
    return detail as never;
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("groups affairs and keeps ended affairs collapsed", async () => {
  items = [
    affairFixture(),
    ...(["active", "watching", "paused", "done"] as const).map((status) => ({
      ...affairFixture(),
      id: status,
      title: status,
      status,
      openAsks: 0,
      agentState: "idle" as const,
    })),
  ];
  show("/en/affairs");
  await screen.findByRole("region", { name: "Waiting for you" });
  expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual([
    "Waiting for you",
    "In progress",
    "Being watched",
    "Paused",
  ]);
  const ended = screen.getByText("Ended · 1").closest("details");
  expect(ended).not.toHaveAttribute("open");
  expect(screen.getByRole("link", { name: "二手相机选购" })).toHaveAttribute(
    "href",
    "/en/affairs/camera",
  );
});
it("hides an empty goal and empty sidebar sections", async () => {
  detail.affair.goal = "";
  detail.affair.handling = null;
  detail.tools = [];
  detail.grants = [];
  show();
  await screen.findByRole("heading", { name: "二手相机选购" });
  expect(screen.queryByText(/^Goal:/)).not.toBeInTheDocument();
  expect(screen.getByText("No sources or tools")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Handling approach" })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Permissions for this affair" }),
  ).not.toBeInTheDocument();
});
it("shows permissions when this affair has a grant", async () => {
  detail.grants = [
    {
      id: "camera-script",
      action: "run_script",
      mode: "preapproved",
      scope: { kind: "affair", affairId: "camera" },
      once: false,
      consumedAt: null,
      expiresAt: null,
      createdAt: detail.affair.createdAt,
      revokedAt: null,
    },
  ];
  show();
  expect(await screen.findByRole("heading", { name: "Permissions for this affair" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Revoke" })).toBeVisible();
});
it.each(["/en/affairs/camera", "/en/affairs/camera/results/2"])("hides empty result sources on %s", async (path) => {
  detail.latestResult!.sources = [];
  show(path);
  await screen.findByRole("heading", { name: detail.latestResult!.title });
  expect(screen.queryByRole("heading", { name: en.steward.affairs.sources })).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Revision feedback" })).toBeVisible();
});
it("renders detail, inline ask, result sources and history", async () => {
  show();
  expect(await screen.findByRole("heading", { name: "二手相机选购" })).toBeVisible();
  for (const name of ["Where things stand", "History", "Care", "Handling approach"])
    expect(screen.getByRole("heading", { name })).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Permissions for this affair" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("No sources or tools")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Sources / tools" })).not.toBeInTheDocument();
  expect(screen.getByText("Waiting for your answer")).toBeVisible();
  expect(screen.getByRole("textbox", { name: /Answer:/ })).toBeVisible();
  expect(screen.getByText(/Reviewed/)).toBeVisible();
  expect(screen.getByRole("heading", { name: en.steward.affairs.sources })).toBeVisible();
  expect(screen.getByText(/Unverified/)).toBeVisible();
  expect(screen.getByText("镜头成本未计入")).toBeVisible();
});
it.each([
  ["Revision feedback", "feedback"],
  ["Add information", "supplement"],
])("submits %s with pending/error and preserves text for retry", async (label, kind) => {
  show();
  const input = await screen.findByRole("textbox", { name: label });
  let reject!: (reason: unknown) => void;
  mutation = () =>
    new Promise((_resolve, fail) => {
      reject = fail;
    });
  await userEvent.type(input, "Include lenses");
  const form = input.closest("form")!;
  await userEvent.click(within(form).getByRole("button", { name: "Send" }));
  expect(within(form).getByRole("status")).toHaveTextContent("Processing…");
  expect(input).toBeDisabled();
  expect(apiJson).toHaveBeenCalledWith(
    "/api/steward/affairs/camera/entries?workspaceId=ws",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ kind, text: "Include lenses" }),
    }),
  );
  reject(new Error("offline"));
  expect(await within(form).findByRole("alert")).toHaveTextContent("Could not connect");
  expect(input).toHaveValue("Include lenses");
  mutation = undefined;
  await userEvent.click(within(form).getByRole("button", { name: "Send" }));
  await waitFor(() => expect(input).toHaveValue(""));
});
it("pauses with pending/error and requires an inline confirmation to end", async () => {
  show();
  const pause = await screen.findByRole("button", { name: "Pause" });
  let reject!: (reason: unknown) => void;
  mutation = () =>
    new Promise((_resolve, fail) => {
      reject = fail;
    });
  await userEvent.click(pause);
  expect(pause).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Processing…");
  expect(apiJson).toHaveBeenCalledWith(
    "/api/steward/affairs/camera?workspaceId=ws",
    expect.objectContaining({ method: "PATCH", body: '{"status":"paused"}' }),
  );
  reject(new Error("offline"));
  await screen.findByRole("alert");
  mutation = undefined;
  await userEvent.click(screen.getByRole("button", { name: "End" }));
  expect(apiJson).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ body: '{"status":"done"}' }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Confirm end" }));
  await waitFor(() =>
    expect(apiJson).toHaveBeenCalledWith(
      "/api/steward/affairs/camera?workspaceId=ws",
      expect.objectContaining({ body: '{"status":"done"}' }),
    ),
  );
});
it("saves care through PATCH and shows pending and error", async () => {
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Set up regular care" }));
  const minutes = screen.getByRole("spinbutton", { name: "Check interval (minutes)" });
  await userEvent.clear(minutes);
  await userEvent.type(minutes, "30");
  let reject!: (reason: unknown) => void;
  mutation = () =>
    new Promise((_resolve, fail) => {
      reject = fail;
    });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(minutes).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Processing…");
  expect(apiJson).toHaveBeenCalledWith(
    "/api/steward/affairs/camera?workspaceId=ws",
    expect.objectContaining({
      method: "PATCH",
      body: '{"care":{"cadenceSeconds":1800,"notify":"digest"}}',
    }),
  );
  reject(new Error("offline"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not connect");
});
it("saves and stops care, and resumes a paused affair", async () => {
  detail.affair = {
    ...detail.affair,
    status: "paused",
    care: {
      cadenceSeconds: 3600,
      notify: "web",
      connectionId: null,
      lastCheckAt: null,
      nextCheckAt: null,
    },
  };
  mutation = async (_path, body) => {
    const care =
      body.care === null
        ? null
        : body.care
          ? { ...detail.affair.care, ...(body.care as object) }
          : detail.affair.care;
    return { ...detail.affair, ...body, care };
  };
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Resume" }));
  expect(apiJson).toHaveBeenCalledWith(
    "/api/steward/affairs/camera?workspaceId=ws",
    expect.objectContaining({ body: '{"status":"active"}' }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument());
  expect(apiJson).toHaveBeenCalledWith(
    "/api/steward/affairs/camera?workspaceId=ws",
    expect.objectContaining({ body: '{"care":{"cadenceSeconds":3600,"notify":"web"}}' }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Stop regular care" }));
  expect(apiJson).toHaveBeenCalledWith(
    "/api/steward/affairs/camera?workspaceId=ws",
    expect.objectContaining({ body: '{"care":null}' }),
  );
});
it("renders loading and recoverable fetch failure", async () => {
  vi.mocked(apiJson).mockRejectedValue(new Error("offline"));
  show("/en/affairs");
  expect(screen.getByRole("status", { name: "Loading…" })).toBeVisible();
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not connect");
  expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
});
it("switches result versions using the scoped result endpoint", async () => {
  show("/en/affairs/camera/results/2");
  expect(await screen.findByText("Reading version 2")).toBeVisible();
  await userEvent.click(screen.getByRole("link", { name: "Version 1" }));
  expect(await screen.findByText("Reading version 1")).toBeVisible();
  expect(screen.queryByText("Reading version 2")).not.toBeInTheDocument();
  expect(apiJson).toHaveBeenCalledWith(
    "/api/steward/affairs/camera/results/1?workspaceId=ws",
    expect.anything(),
  );
});
it("shows list empty and failure recovery states", async () => {
  items = [];
  const view = show("/en/affairs");
  expect(await screen.findByText("No affairs yet")).toBeVisible();
  view.unmount();
  detail.affair = {
    ...detail.affair,
    agentState: "failed",
    lastError: "Research service unavailable",
  };
  show();
  expect(await screen.findByRole("alert")).toHaveTextContent("Research service unavailable");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(apiJson).toHaveBeenCalledWith(
    "/api/steward/affairs/camera?workspaceId=ws",
    expect.objectContaining({ body: '{"status":"active"}' }),
  );
});
