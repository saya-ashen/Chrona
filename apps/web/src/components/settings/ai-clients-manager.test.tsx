import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiClientsManager } from "@/components/settings/ai-clients-manager";

const messages = {
  pages: {
    aiClientsPage: {
      title: "AI Clients",
      subtitle: "Connect Hermes so Chrona can plan tasks and safely execute approved work.",
      addClient: "+ Add Client",
      emptyState: "No AI client is connected yet. Add Hermes to unlock planning, suggestions, and approved execution.",
      emptyStateCta: "Connect Hermes",
      hermesIntro: "Hermes is Chrona's local AI bridge. Start with Local Hermes if you run it on this machine, or Remote Hermes if another machine hosts it.",
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
      debugProfileLabel: "Debug profile",
      debugProfileDeterministic: "Deterministic",
      debugProfileToolSubmit: "Tool submit",
      debugProfileHermesLike: "Hermes-like",
      hermesScopeLabel: "Hermes location",
      hermesScopeLocal: "Local Hermes",
      hermesScopeRemote: "Remote Hermes",
      hermesLocalDescription: "Local mode can install the Chrona Hermes plugin and enable the Hermes API server on this machine.",
      hermesRemoteDescription: "Remote mode will not touch local files. Configure the remote Hermes machine manually, then test availability here.",
      hermesRestartDescription: "Restart Hermes if you changed the plugin, enabled the API server, or updated the API key. Chrona can run hermes gateway restart, but it may not know your original gateway startup options; restart it yourself if that is clearer. Running tasks may pause briefly during restart.",
      diagnoseHermes: "Diagnose Hermes",
      autoConfigureHermes: "Auto-configure local Hermes",
      restartHermes: "Restart Hermes gateway",
      restartHermesRequested: "Hermes restart requested.",
      hermesDiagnosticsTitle: "Hermes diagnostics",
      hermesPlanTitle: "Setup plan",
      hermesChangedTitle: "Changed",
      hermesRestartRequired: "Restart Hermes, then run diagnosis again.",
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
      label: "Hermes",
      features: ["suggest", "generatePlan", "conflicts", "timeslots", "chat"],
    },
    {
      key: "llm",
      label: "LLM (OpenAI Compatible)",
      features: ["suggest", "generatePlan", "conflicts", "timeslots", "chat"],
    },
    {
      key: "claude_code",
      label: "Claude Code",
      features: ["generatePlan", "chat"],
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

    await screen.findByText("No AI client is connected yet. Add Hermes to unlock planning, suggestions, and approved execution.");
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

    await screen.findByText("No AI client is connected yet. Add Hermes to unlock planning, suggestions, and approved execution.");
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
        scope: "local",
        timeoutMs: 45000,
      },
    });
  });

  it("creates a Claude Code client with Anthropic environment variables", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ clients: [] }),
    });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("No AI client is connected yet. Add Hermes to unlock planning, suggestions, and approved execution.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));

    fireEvent.change(screen.getByPlaceholderText("My Hermes Client"), {
      target: { value: "Claude Code via 9router" },
    });
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(within(screen.getByRole("listbox")).getByText("Claude Code"));
    fireEvent.change(screen.getByLabelText("ANTHROPIC_MODEL"), {
      target: { value: "cx/gpt-5.5" },
    });
    fireEvent.change(screen.getByLabelText("ANTHROPIC_BASE_URL"), {
      target: { value: "https://9router.saya.love/v1" },
    });
    fireEvent.change(screen.getByLabelText("ANTHROPIC_AUTH_TOKEN"), {
      target: { value: "sk-aaa" },
    });
    await user.click(screen.getByRole("combobox", { name: "Control plane" }));
    await user.click(within(screen.getByRole("listbox")).getByText("Skill"));

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ client: { id: "client_claude_code" } }),
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
      name: "Claude Code via 9router",
      type: "claude_code",
      config: {
        model: "cx/gpt-5.5",
        timeoutMs: 120000,
        controlPlane: "skill",
        env: {
          ANTHROPIC_MODEL: "cx/gpt-5.5",
          ANTHROPIC_BASE_URL: "https://9router.saya.love/v1",
          ANTHROPIC_AUTH_TOKEN: "sk-aaa",
        },
      },
    });
  });

  it("creates a debug client with the deterministic profile by default", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ clients: [] }),
    });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("No AI client is connected yet. Add Hermes to unlock planning, suggestions, and approved execution.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));

    fireEvent.change(screen.getByPlaceholderText("My Hermes Client"), {
      target: { value: "Local Debug" },
    });
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(within(screen.getByRole("listbox")).getByText("Debug Provider"));

    expect(screen.queryByPlaceholderText("http://127.0.0.1:8642")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("optional for localhost")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Debug profile" })).toHaveTextContent("Deterministic");

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
      config: { profile: "deterministic" },
    });
  });

  it("creates a debug client with a selected simulation profile", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ clients: [] }),
    });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("No AI client is connected yet. Add Hermes to unlock planning, suggestions, and approved execution.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));

    fireEvent.change(screen.getByPlaceholderText("My Hermes Client"), {
      target: { value: "Hermes-like Debug" },
    });
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(within(screen.getByRole("listbox")).getByText("Debug Provider"));
    await user.click(screen.getByRole("combobox", { name: "Debug profile" }));
    await user.click(within(screen.getByRole("listbox")).getByText("Hermes-like"));

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
      name: "Hermes-like Debug",
      type: "debug",
      config: { profile: "hermes-like" },
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
        scope: "local",
        timeoutMs: 120000,
      },
    });
  });

  it("shows remote Hermes guidance without local auto-configuration", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("No AI client is connected yet. Add Hermes to unlock planning, suggestions, and approved execution.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));
    await user.click(screen.getByRole("combobox", { name: "Hermes location" }));
    await user.click(within(screen.getByRole("listbox")).getByText("Remote Hermes"));

    expect(screen.getByText("Remote mode will not touch local files. Configure the remote Hermes machine manually, then test availability here.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Auto-configure local Hermes" })).not.toBeInTheDocument();
  });

  it("auto-configures local Hermes and writes the returned API key into the client payload", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("No AI client is connected yet. Add Hermes to unlock planning, suggestions, and approved execution.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));
    fireEvent.change(screen.getByPlaceholderText("My Hermes Client"), {
      target: { value: "Auto Hermes" },
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        apiKey: "chrona-generated-token",
        maskedApiKey: "chrona-...oken",
        changed: ["env:/home/user/.hermes/.env"],
        diagnostics: {
          mode: "local",
          restartRequired: true,
          checks: [{ key: "hermesEnvFile", status: "warning", message: "Hermes .env updated" }],
        },
        plan: { summary: "Restart Hermes.", canRunAutomatically: false, actions: [] },
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Auto-configure local Hermes" }));

    await screen.findByText("Restart Hermes.");

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ client: { id: "client_hermes" } }) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ clients: [] }) });
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
      name: "Auto Hermes",
      type: "hermes",
      config: {
        apiKey: "chrona-generated-token",
        scope: "local",
      },
    });
  });

  it("lets local Hermes clients request a gateway restart", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("No AI client is connected yet. Add Hermes to unlock planning, suggestions, and approved execution.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));

    expect(screen.getByText(/Chrona can run hermes gateway restart/)).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, exitCode: null, message: "Hermes gateway restart command started in the background." }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Restart Hermes gateway" }));

    await screen.findByText("Hermes gateway restart command started in the background.");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/integrations/hermes/restart-local",
      expect.objectContaining({ method: "POST" }),
    );
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
