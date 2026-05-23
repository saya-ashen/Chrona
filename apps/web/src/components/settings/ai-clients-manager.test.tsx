import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
      debug: "Debug Provider",
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

const providersResponse = {
  providers: [
    {
      key: "hermes",
      label: "LLM (OpenAI Compatible)",
      features: ["suggest", "generatePlan", "conflicts", "timeslots", "chat"],
    },
    {
      key: "hermes",
      label: "Hermes",
      features: ["suggest", "generatePlan", "conflicts", "timeslots", "chat"],
    },
    {
      key: "debug",
      label: "Debug Provider",
      features: ["suggest", "generatePlan", "chat"],
    },
  ],
};

vi.mock("@chrona/i18n/react", () => ({
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
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("No AI Clients configured yet. Click the button above to add one.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));

    fireEvent.change(screen.getByPlaceholderText("My Hermes Client"), {
      target: { value: "Hermes Client" },
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
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ clients: [] }),
    });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("No AI Clients configured yet. Click the button above to add one.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));

    fireEvent.change(screen.getByPlaceholderText("My Hermes Client"), {
      target: { value: "Local Hermes" },
    });
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(within(screen.getByRole("listbox")).getByText("Hermes"));
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
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => providersResponse });

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

  it("creates a debug client without provider config", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ clients: [] }),
    });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("No AI Clients configured yet. Click the button above to add one.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));

    fireEvent.change(screen.getByPlaceholderText("My Hermes Client"), {
      target: { value: "Local Debug" },
    });
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(within(screen.getByRole("listbox")).getByText("Debug Provider"));

    expect(screen.queryByPlaceholderText("http://127.0.0.1:8642")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("optional for localhost")).not.toBeInTheDocument();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ client: { id: "client_debug" } }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ clients: [] }),
    });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => providersResponse });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ai/clients",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const createCall = fetchMock.mock.calls.find((call) => call[0] === "/api/ai/clients" && call[1]?.method === "POST");
    expect(JSON.parse(createCall?.[1]?.body as string)).toMatchObject({
      name: "Local Debug",
      type: "debug",
      config: {},
    });
  });

  it("updates an existing Hermes client to Hermes", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        clients: [
          {
            id: "client_hermes",
            name: "Runtime Client",
            type: "hermes",
            config: { bridgeUrl: "http://localhost:7677", bridgeToken: "secret-token" },
            isDefault: true,
            enabled: true,
            bindings: [],
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("Runtime Client");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(within(screen.getByRole("listbox")).getByText("Hermes"));
    fireEvent.change(screen.getByPlaceholderText("http://127.0.0.1:8642"), {
      target: { value: "http://localhost:8642" },
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ client: { id: "client_hermes", type: "hermes" } }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ clients: [] }),
    });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => providersResponse });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ai/clients/client_hermes",
        expect.objectContaining({ method: "PATCH" }),
      );
    });

    const updateCall = fetchMock.mock.calls.find((call) => call[0] === "/api/ai/clients/client_hermes" && call[1]?.method === "PATCH");
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
             type: "hermes",
             config: { bridgeUrl: "http://localhost:7677", bridgeToken: "secret-token" },
             isDefault: false,
             enabled: true,
            bindings: ["suggest"],
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => providersResponse });

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
