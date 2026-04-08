import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

import { redirect } from "next/navigation";
import HomePage from "@/app/page";

describe("HomePage", () => {
  it("redirects root traffic to /workspaces", () => {
    const redirectMock = vi.mocked(redirect);

    expect(() => HomePage()).toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/workspaces");
  });
});
