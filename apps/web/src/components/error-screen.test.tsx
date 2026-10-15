import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ErrorLocaleProvider, ErrorScreen } from "./error-screen";
import { NotFoundPage } from "./not-found-page";

afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });
it.each([
  ["zh", "出了点问题", "刷新页面"],
  ["en", "Something went wrong", "Refresh page"],
])("localizes errors outside the route provider for %s", (locale, title, refresh) => {
  window.history.replaceState(null, "", `/${locale}/settings`);
  render(<ErrorScreen />);
  expect(screen.getByRole("heading", { name: title })).toBeVisible();
  expect(screen.getByRole("button", { name: refresh })).toBeVisible();
});
it("provides Chinese localization for a loader's not-found fallback", () => {
  window.history.replaceState(null, "", "/zh/missing");
  render(<MemoryRouter><ErrorLocaleProvider><NotFoundPage /></ErrorLocaleProvider></MemoryRouter>);
  expect(screen.getByRole("link")).toHaveAttribute("href", "/zh");
  expect(screen.queryByText("Not found")).not.toBeInTheDocument();
});
