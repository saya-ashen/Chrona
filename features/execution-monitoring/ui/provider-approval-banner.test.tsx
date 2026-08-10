"use client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiJson: vi.fn(),
}));

vi.mock("@shared/http", () => ({
  apiJson: mocks.apiJson,
}));

import { ProviderApprovalBanner } from "./provider-approval-banner";

afterEach(() => {
  cleanup();
  mocks.apiJson.mockReset();
});

function renderBanner(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

describe("ProviderApprovalBanner occurrence scope", () => {
  it("does not load task-only approvals without a selected occurrence and run", () => {
    renderBanner(<ProviderApprovalBanner taskId="task-1" workBlockId={null} executionScope={null} />);

    expect(mocks.apiJson).not.toHaveBeenCalled();
  });

  it("uses the selected work block and plan run for listing and resolution", async () => {
    mocks.apiJson
      .mockResolvedValueOnce({
        approvals: [{
          id: "approval-1",
          taskId: "task-1",
          provider: { category: "ai_provider", label: "AI provider" },
          title: "Approve email",
          summary: "Send the email",
          riskLevel: "medium",
          choices: ["approve_once"],
          requestedAt: "2026-07-29T12:00:00.000Z",
        }],
      })
      .mockResolvedValueOnce({
        approval: {},
        status: "not_active",
      });

    renderBanner(<ProviderApprovalBanner taskId="task-1" workBlockId="block-B" executionScope="scope-B" />);

    await waitFor(() => {
      expect(mocks.apiJson).toHaveBeenCalledWith(
        "/api/tasks/task-1/provider-approvals?workBlockId=block-B&executionScope=scope-B",
      );
    });

    fireEvent.click(await screen.findByRole("button", { name: "Approve once" }));

    await waitFor(() => {
      const resolveCall = mocks.apiJson.mock.calls.find(([path]) => path === "/api/tasks/task-1/provider-approvals/approval-1/resolve");
      expect(resolveCall).toBeTruthy();
      expect(resolveCall?.[1]).toMatchObject({ method: "POST" });
      expect(JSON.parse(String(resolveCall?.[1]?.body))).toMatchObject({
        workBlockId: "block-B",
        executionScope: "scope-B",
        choice: "approve_once",
        idempotencyKey: expect.any(String),
      });
    });
  });
});
