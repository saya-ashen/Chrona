import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiClientsManager } from "@/components/settings/ai-clients-manager";

const messages = {
  pages: {
    aiClientsPage: {
      title: "AI Clients",
      subtitle: "Manage AI clients and configure which client each feature uses",
      addClient: "+ Add Client",
      emptyState: "No AI Clients configured yet. Click the button above to add one.",
      loading: "Loading...",
      defaultBadge: "Default",
      enabled: "Enabled",
      edit: "Edit",
      delete: "Delete",
      nameLabel: "Name",
      typeLabel: "Type",
      llmCompatible: "LLM (OpenAI Compatible)",
      timeoutSeconds: "Timeout (seconds)",
      modelLabel: "Model",
      setAsDefault: "Set as default Client",
      save: "Save",
      cancel: "Cancel",
      featureSuggest: "Smart Suggestions",
      featureDecompose: "Task Decomposition",
      featureConflicts: "Conflict Analysis",
      featureTimeslots: "Timeslot Recommendations",
      featureChat: "Chat / Plan Generation",
      testAvailability: "Test availability",
      testing: "Testing...",
      available: "Available",
      unavailable: "Unavailable",
      statusUnknown: "Not tested",
    },
  },
};

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({ messages }),
}));

describe("AiClientsManager", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a test availability action in the create form and updates status after probing", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ clients: [] }),
    });

    render(<AiClientsManager />);

    await screen.findByText("No AI Clients configured yet. Click the button above to add one.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));

    fireEvent.change(screen.getByPlaceholderText("My OpenClaw Client"), {
      target: { value: "Bridge Client" },
    });

    const testButton = screen.getByRole("button", { name: "Test availability" });
    expect(screen.getByText("Not tested")).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, available: true }),
    });

    fireEvent.click(testButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/ai/clients/test",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(await screen.findByText("Available")).toBeInTheDocument();
  });

  it("allows testing an existing client card and shows the returned failure reason", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        clients: [
          {
            id: "client_1",
            name: "Broken Bridge",
            type: "openclaw",
            config: { bridgeUrl: "http://localhost:7677" },
            isDefault: false,
            enabled: true,
            bindings: ["suggest"],
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    });

    render(<AiClientsManager />);

    await screen.findByText("Broken Bridge");

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, available: false, reason: "Bridge health endpoint returned 503" }),
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Test availability" })[0]);

    await screen.findByText("Unavailable");
    expect(screen.getByText("Bridge health endpoint returned 503")).toBeInTheDocument();
  });
});
