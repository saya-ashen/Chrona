import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import en from "../../../packages/i18n/src/messages/en.json";
import { createStewardClient } from "../model/client";
import { fileFixture } from "../model/fixtures";
import { AffairFileView, EditableFile } from "./affair-file-view";
const NativeURL = URL;
let sequence = 0;
const create = vi.fn((_blob: unknown) => `blob:fixture/${++sequence}`), revoke = vi.fn();
beforeEach(() => {
  sequence = 0; create.mockClear(); revoke.mockClear();
  vi.stubGlobal("URL", class extends NativeURL { static override createObjectURL = create; static override revokeObjectURL = revoke; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function wrapper(children: React.ReactNode) { return <MemoryRouter><I18nProvider locale="en" messages={en}>{children}</I18nProvider></MemoryRouter>; }
function file(path: string) {
  const client = createStewardClient("ws"), raw = vi.spyOn(client, "raw").mockResolvedValue(new Blob(["fixture"], { type: "application/octet-stream" }));
  const view = render(wrapper(<AffairFileView client={client} affairId="camera" path={path} refresh={() => {}} />));
  return { client, raw, ...view };
}
it("loads images with authenticated bytes and revokes object URLs on unmount", async () => {
  const { raw, unmount } = file("photo.png");
  expect(await screen.findByRole("img", { name: "photo.png" })).toHaveAttribute("src", "blob:fixture/1");
  expect(raw).toHaveBeenCalledWith("camera", "photo.png", expect.any(AbortSignal));
  expect(create.mock.calls[0]![0]).toMatchObject({ type: "image/png" });
  unmount(); expect(revoke).toHaveBeenCalledWith("blob:fixture/1");
});
it.each(["recording.wav", "clip.mp4"])("previews browser media %s without an unauthenticated src", async path => {
  file(path);
  const player = await screen.findByLabelText(path); await waitFor(() => expect(player).toHaveAttribute("src", "blob:fixture/1"));
  expect(player).toHaveAttribute("controls"); fireEvent.error(player);
  expect(await screen.findByText(en.steward.affairFile.previewUnavailable)).toBeVisible();
});
it("binary files do not auto-fetch or embed; download uses a temporary blob URL", async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const { raw } = file("document.pdf"); expect(raw).not.toHaveBeenCalled(); expect(screen.queryByRole("img")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Download file/ }));
  await waitFor(() => expect(click).toHaveBeenCalledOnce());
  expect(raw).toHaveBeenCalledWith("camera", "document.pdf");
  expect(click.mock.instances[0]).toHaveProperty("download", "document.pdf");
  await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:fixture/1"), { timeout: 2000 });
});
it("a source change cancels the previous request and never paints the previous image in the new scope", async () => {
  const { client, raw, rerender } = file("first.png"); await screen.findByRole("img");
  let resolve!: (blob: Blob) => void; raw.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const oldSignal = raw.mock.calls[0]![2]!;
  rerender(wrapper(<AffairFileView client={client} affairId="second" path="second.png" refresh={() => {}} />));
  expect(screen.queryByRole("img")).not.toBeInTheDocument(); expect(oldSignal.aborted).toBe(true);
  resolve(new Blob(["next"]));
  expect(await screen.findByRole("img")).toHaveAttribute("src", "blob:fixture/2"); expect(revoke).toHaveBeenCalledWith("blob:fixture/1");
});
it("image loading failure has an explicit retry", async () => {
  const client = createStewardClient("ws"), raw = vi.spyOn(client, "raw").mockRejectedValueOnce(new Error("offline")).mockResolvedValue(new Blob(["next"]));
  render(wrapper(<AffairFileView client={client} affairId="camera" path="photo.png" refresh={() => {}} />));
  expect(await screen.findByRole("alert")).toHaveTextContent(en.steward.foundation.networkError);
  await userEvent.click(screen.getByRole("button", { name: en.steward.foundation.retry }));
  expect(await screen.findByRole("img")).toBeVisible(); expect(raw).toHaveBeenCalledTimes(2);
});
it("Markdown keeps relative pages in the affair and authenticates only local raster images", async () => {
  const client = createStewardClient("ws"), raw = vi.spyOn(client, "raw").mockResolvedValue(new Blob(["fixture"]));
  const content = "[Material](../material.md) [Outside](https://example.com) ![Local](../images/a.png) ![Remote](https://remote.invalid/private.png) ![Unsafe](../bad.svg) [Escape](../../private.md)";
  render(wrapper(<EditableFile client={client} affairId="camera" initial={{ ...fileFixture(), path: "days/one.md", content }} refresh={() => {}} />));
  expect(screen.getByRole("link", { name: "Material" })).toHaveAttribute("href", "/en/affairs/camera?path=material.md");
  expect(screen.getByRole("link", { name: "Outside" })).toHaveAttribute("href", "https://example.com");
  expect(screen.queryByRole("link", { name: "Escape" })).not.toBeInTheDocument();
  expect(await screen.findByRole("img", { name: "Local" })).toHaveAttribute("src", "blob:fixture/1");
  expect(screen.queryByRole("img", { name: "Remote" })).not.toBeInTheDocument(); expect(screen.queryByRole("img", { name: "Unsafe" })).not.toBeInTheDocument();
  expect(raw).toHaveBeenCalledTimes(1); expect(raw).toHaveBeenCalledWith("camera", "images/a.png", expect.any(AbortSignal));
});
