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
      hermes: "Hermes",
      timeoutSeconds: "Timeout (seconds)",
      modelLabel: "Model",
      setAsDefault: "Set as default Client",
      save: "Save",
      cancel: "Cancel",
      featureSuggest: "Smart Suggestions",
      featureGeneratePlan: "Task Plan Generation",
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
      target: { value: "OpenClaw Client" },
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

  it("creates a Hermes client with Hermes-specific config", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ clients: [] }),
    });

    render(<AiClientsManager />);

    await screen.findByText("No AI Clients configured yet. Click the button above to add one.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));

    fireEvent.change(screen.getByPlaceholderText("My OpenClaw Client"), {
      target: { value: "Local Hermes" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Type" }), {
      target: { value: "hermes" },
    });
    fireEvent.change(screen.getByPlaceholderText("http://127.0.0.1:8642"), {
      target: { value: "http://localhost:8642" },
    });
    fireEvent.change(screen.getByPlaceholderText("optional for localhost"), {
      target: { value: "hermes-token" },
    });
    fireEvent.change(screen.getByDisplayValue("120"), {
      target: { value: "45" },
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ client: { id: "client_hermes" } }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ clients: [] }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ai/clients",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const createCall = fetchMock.mock.calls.find((call) => call[0] === "/api/ai/clients" && call[1]?.method === "POST");
    expect(JSON.parse(createCall?.[1]?.body as string)).toMatchObject({
      name: "Local Hermes",
      type: "hermes",
      config: {
        baseUrl: "http://localhost:8642",
        apiKey: "hermes-token",
        timeoutMs: 45000,
      },
    });
  });

  it("updates an existing OpenClaw client to Hermes", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        clients: [
          {
            id: "client_openclaw",
            name: "Runtime Client",
            type: "openclaw",
            config: { bridgeUrl: "http://localhost:7677", bridgeToken: "secret-token" },
            isDefault: true,
            enabled: true,
            bindings: [],
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    });

    render(<AiClientsManager />);

    await screen.findByText("Runtime Client");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Type" }), {
      target: { value: "hermes" },
    });
    fireEvent.change(screen.getByPlaceholderText("http://127.0.0.1:8642"), {
      target: { value: "http://localhost:8642" },
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ client: { id: "client_openclaw", type: "hermes" } }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ clients: [] }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ai/clients/client_openclaw",
        expect.objectContaining({ method: "PATCH" }),
      );
    });

    const updateCall = fetchMock.mock.calls.find((call) => call[0] === "/api/ai/clients/client_openclaw" && call[1]?.method === "PATCH");
    expect(JSON.parse(updateCall?.[1]?.body as string)).toMatchObject({
      name: "Runtime Client",
      type: "hermes",
      config: {
        baseUrl: "http://localhost:8642",
        timeoutMs: 120000,
      },
    });
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
             config: { bridgeUrl: "http://localhost:7677", bridgeToken: "secret-token" },
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
