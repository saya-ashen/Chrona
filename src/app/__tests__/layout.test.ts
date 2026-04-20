import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist-sans" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono" }),
}));

import { metadata } from "@/app/layout";

describe("RootLayout metadata", () => {
  it("describes the task-centric control plane product", () => {
    expect(metadata.title).toBe("Chrona");
    expect(metadata.description).toBe(
      "Task-centric AI control plane for human and runtime collaboration.",
    );
  });
});
