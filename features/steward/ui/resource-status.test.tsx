import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@chrona/i18n/react";
import en from "../../../packages/i18n/src/messages/en.json";
import { ResourceStatus } from "./resource-status";

afterEach(cleanup);
it.each([null, undefined, { saved: true }])("only shows a loading skeleton before data exists (%j)", data => {
  render(<I18nProvider locale="en" messages={en}><ResourceStatus resource={{ data, loading: true, error: null, refresh: vi.fn() }} /></I18nProvider>);
  if (data) expect(screen.queryByRole("status")).not.toBeInTheDocument();
  else expect(screen.getByRole("status")).toBeVisible();
});
