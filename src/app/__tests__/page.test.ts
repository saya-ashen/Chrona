import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

import { redirect } from "next/navigation";
import HomePage from "@/app/page";

describe("HomePage", () => {
  it("redirects root traffic to the default localized schedule page", () => {
    const redirectMock = vi.mocked(redirect);

    expect(() => HomePage()).toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/en/schedule");
  });
});
