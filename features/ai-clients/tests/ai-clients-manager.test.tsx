import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiClientsManager } from "../ui/ai-clients-manager";
import { AI_CLIENTS_CHANGED_EVENT } from "../events";

const messages = {
  pages: {
    aiClientsPage: {
      title: "AI Clients",
      subtitle: "Connect an AI client so Chrona can plan tasks and safely execute approved work.",
      addClient: "+ Add Client",
      emptyState: "No AI client is connected yet. Connect one to unlock planning, suggestions, and execution previews.",
      emptyStateCta: "Connect AI Client",
      hermesIntro: "Hermes is Chrona's local AI bridge. Start with Local Hermes if you run it on this machine, or Remote Hermes if another machine hosts it.",
      loading: "Loading...",
      defaultBadge: "Default",
      enabled: "Enabled",
      edit: "Edit",
      delete: "Delete",
      nameLabel: "Name",
      typeLabel: "Type",
      recommendedProvider: "Recommended",
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
      setAsDefault: "Use as default AI client",
      setAsDefaultHelp: "Chrona uses the default client for planning, execution, and summaries unless a feature has its own client.",
      makeDefault: "Make default",
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
      tier: "experimental",
      features: ["suggest", "conflicts", "timeslots", "chat", "dashboard.brief", "task.plan", "task.execution"],
    },
    {
      key: "llm",
      label: "LLM (OpenAI Compatible)",
      tier: "experimental",
      features: ["suggest", "conflicts", "timeslots", "chat", "dashboard.brief", "task.plan", "task.execution"],
    },
    {
      key: "claude_code",
      label: "Claude Code",
      tier: "stable",
      features: ["chat", "dashboard.brief", "goal.review", "task.plan", "task.execution"],
    },
    {
      key: "codex",
      label: "Codex",
      tier: "stable",
      recommended: true,
      features: ["chat", "dashboard.brief", "goal.review", "task.plan", "task.execution"],
    },
    {
      key: "omp",
      label: "Oh My Pi",
      tier: "stable",
      features: ["dashboard.brief", "goal.review", "task.plan", "task.execution"],
    },
    {
      key: "debug",
      label: "Debug Provider",
      tier: "experimental",
      features: ["suggest", "chat", "dashboard.brief", "task.plan", "task.execution"],
    },
  ],
};
vi.mock("@chrona/i18n", () => ({
  useI18n: () => ({ messages }),
}));

describe("AiClientsManager", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async () => ({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({}),
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a test availability action in the create form and updates status after probing", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("No AI client is connected yet. Connect one to unlock planning, suggestions, and execution previews.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));
    fireEvent.click(screen.getByText("Advanced settings"));

    fireEvent.change(screen.getByPlaceholderText("My Codex Client"), {
      target: { value: "Codex Client" },
    });

    const testButton = screen.getByRole("button", { name: "Test availability" });
    expect(screen.getByText("Not tested")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveTextContent("Codex");
    expect(screen.getByText("Support tier: stable · Recommended")).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ ok: true, available: true }) });

    fireEvent.click(testButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/ai/clients/test",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(await screen.findByText("Available")).toBeInTheDocument();
  });

  it("probes OMP availability deterministically during first-run onboarding", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });
    render(<AiClientsManager />);
    await screen.findByText("No AI client is connected yet. Connect one to unlock planning, suggestions, and execution previews.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Type" }));
    await userEvent.click(within(screen.getByRole("listbox")).getByText("Oh My Pi"));
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ ok: true, available: true, reason: "OMP native assets available" }) });
    fireEvent.click(screen.getByRole("button", { name: "Test availability" }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/ai/clients/test",
      expect.objectContaining({ method: "POST", body: expect.stringContaining('"type":"omp"') }),
    ));
    expect(await screen.findByText("Available")).toBeInTheDocument();
    expect(screen.getByText("OMP native assets available")).toBeInTheDocument();
  });

  it("shows OMP's stable tier, safe feature bindings, and fail-closed recovery limit", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });
    const user = userEvent.setup();
    render(<AiClientsManager />);
    await screen.findByText("No AI client is connected yet. Connect one to unlock planning, suggestions, and execution previews.");
    await user.click(screen.getByRole("button", { name: "+ Add Client" }));
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(within(screen.getByRole("listbox")).getByText("Oh My Pi"));
    expect(screen.getByText("Support tier: stable")).toBeInTheDocument();
    expect(screen.getByText("Terminal-only read-only starts run once. If interrupted, Chrona does not replay them; start a new operation explicitly.")).toBeInTheDocument();
    await user.click(screen.getByText("Advanced settings"));
    expect(screen.getByText("Task Planning")).toBeInTheDocument();
    expect(screen.getByText("Goal Review")).toBeInTheDocument();
    expect(screen.getByText("Task Execution")).toBeInTheDocument();
  });

  it("hides the unavailable Smart Suggestions binding", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ clients: [] }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => providersResponse,
    });

    render(<AiClientsManager />);

    await screen.findByText(
      "No AI client is connected yet. Connect one to unlock planning, suggestions, and execution previews.",
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));

    expect(screen.queryByText("Smart Suggestions")).not.toBeInTheDocument();
    expect(screen.getByText("Task Execution")).toBeInTheDocument();
  });

  it("creates a Hermes client with Hermes-specific config", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("No AI client is connected yet. Connect one to unlock planning, suggestions, and execution previews.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));
    fireEvent.click(screen.getByText("Advanced settings"));

    fireEvent.change(screen.getByPlaceholderText("My Codex Client"), {
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
    fireEvent.change(screen.getByDisplayValue("3600"), {
      target: { value: "45" },
    });

    expect(screen.getByRole("checkbox", { name: "Use as default AI client" })).toBeChecked();
    expect(screen.getByText("Chrona uses the default client for planning, execution, and summaries unless a feature has its own client.")).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ client: { id: "client_hermes" } }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ bindings: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });
    const clientsChanged = vi.fn();
    window.addEventListener(AI_CLIENTS_CHANGED_EVENT, clientsChanged, { once: true });


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
      isDefault: true,
    });

    const bindingsCall = fetchMock.mock.calls.find((call) => call[0] === "/api/ai/clients/client_hermes/bindings" && call[1]?.method === "PUT");
    expect(JSON.parse(bindingsCall?.[1]?.body as string)).toEqual({ features: ["task.execution", "dashboard.brief"] });
    expect(clientsChanged).toHaveBeenCalledOnce();
  });

  it("creates a Claude Code client with Anthropic environment variables", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("No AI client is connected yet. Connect one to unlock planning, suggestions, and execution previews.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));
    fireEvent.click(screen.getByText("Advanced settings"));

    fireEvent.change(screen.getByPlaceholderText("My Codex Client"), {
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

    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ client: { id: "client_claude_code" } }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ bindings: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

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
        timeoutMs: 3600000,
        env: {
          ANTHROPIC_MODEL: "cx/gpt-5.5",
          ANTHROPIC_BASE_URL: "https://9router.saya.love/v1",
          ANTHROPIC_AUTH_TOKEN: "sk-aaa",
        },
      },
    });
  });

  it("creates a Codex client without path configuration", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("No AI client is connected yet. Connect one to unlock planning, suggestions, and execution previews.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));
    fireEvent.click(screen.getByText("Advanced settings"));

    fireEvent.change(screen.getByPlaceholderText("My Codex Client"), {
      target: { value: "Codex" },
    });
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(within(screen.getByRole("listbox")).getByText("Codex"));

    expect(screen.queryByText("Binary path")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: "gpt-5-codex" },
    });
    fireEvent.change(screen.getByLabelText("OPENAI_API_KEY"), {
      target: { value: "sk-codex" },
    });

    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ client: { id: "client_codex" } }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ bindings: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ai/clients",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const createCall = fetchMock.mock.calls.find((call) => call[0] === "/api/ai/clients" && call[1]?.method === "POST");
    const payload = JSON.parse(createCall?.[1]?.body as string);
    expect(payload).toMatchObject({
      name: "Codex",
      type: "codex",
      config: {
        model: "gpt-5-codex",
        apiKey: "sk-codex",
        timeoutMs: 3600000,
      },
    });
    expect(payload.config).not.toHaveProperty("binaryPath");

    const bindingsCall = fetchMock.mock.calls.find((call) => call[0] === "/api/ai/clients/client_codex/bindings" && call[1]?.method === "PUT");
    expect(JSON.parse(bindingsCall?.[1]?.body as string)).toEqual({ features: ["task.execution", "dashboard.brief"] });
  });


  it("creates an Oh My Pi client with local profile directory overrides", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("No AI client is connected yet. Connect one to unlock planning, suggestions, and execution previews.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));
    fireEvent.click(screen.getByText("Advanced settings"));

    fireEvent.change(screen.getByPlaceholderText("My Codex Client"), {
      target: { value: "Local OMP" },
    });
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(within(screen.getByRole("listbox")).getByText("Oh My Pi"));
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "nrouter" },
    });
    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: "cx/gpt-5.6-sol" },
    });
    expect(screen.getByRole("combobox", { name: "API type" })).toHaveTextContent("openai-responses");
    fireEvent.change(screen.getByLabelText("OMP Base URL"), {
      target: { value: "https://llm.internal/v1" },
    });
    fireEvent.change(screen.getByLabelText("OMP API Key"), {
      target: { value: "sk-omp" },
    });
    fireEvent.change(screen.getByLabelText("HOME"), {
      target: { value: "/home/chrona-omp" },
    });
    fireEvent.change(screen.getByLabelText("PI_CONFIG_DIR"), {
      target: { value: ".omp-test" },
    });
    fireEvent.change(screen.getByLabelText("PI_CODING_AGENT_DIR"), {
      target: { value: "/tmp/chrona-omp-agent" },
    });

    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ client: { id: "client_omp" } }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ bindings: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ai/clients",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const createCall = fetchMock.mock.calls.find((call) => call[0] === "/api/ai/clients" && call[1]?.method === "POST");
    expect(JSON.parse(createCall?.[1]?.body as string)).toMatchObject({
      name: "Local OMP",
      type: "omp",
      config: {
        provider: "nrouter",
        model: "cx/gpt-5.6-sol",
        api: "openai-responses",
        apiKey: "sk-omp",
        baseUrl: "https://llm.internal/v1",
        homeDirectory: "/home/chrona-omp",
        configDirectory: ".omp-test",
        codingAgentDirectory: "/tmp/chrona-omp-agent",
        timeoutMs: 3600000,
      },
    });
  });

  it("creates a debug client with the deterministic profile by default", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("No AI client is connected yet. Connect one to unlock planning, suggestions, and execution previews.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));

    fireEvent.change(screen.getByPlaceholderText("My Codex Client"), {
      target: { value: "Local Debug" },
    });
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(within(screen.getByRole("listbox")).getByText("Debug Provider"));

    expect(screen.queryByPlaceholderText("http://127.0.0.1:8642")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("optional for localhost")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Debug profile" })).toHaveTextContent("Deterministic");

    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ client: { id: "client_debug" } }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ bindings: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

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
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("No AI client is connected yet. Connect one to unlock planning, suggestions, and execution previews.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));

    fireEvent.change(screen.getByPlaceholderText("My Codex Client"), {
      target: { value: "Hermes-like Debug" },
    });
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(within(screen.getByRole("listbox")).getByText("Debug Provider"));
    await user.click(screen.getByRole("combobox", { name: "Debug profile" }));
    await user.click(within(screen.getByRole("listbox")).getByText("Hermes-like"));

    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ client: { id: "client_debug" } }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ bindings: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

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
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({
      clients: [
        {
          id: "client_hermes",
          name: "Runtime Client",
          type: "hermes",
          config: { bridgeUrl: "http://localhost:7677", bridgeToken: "secret-token" },
          isDefault: true,
          enabled: true,
          bindings: ["dashboard.brief"],
          createdAt: new Date().toISOString(),
        },
      ],
    }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("Runtime Client");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(within(screen.getByRole("listbox")).getByText("Hermes"));
    fireEvent.change(screen.getByPlaceholderText("http://127.0.0.1:8642"), {
      target: { value: "http://localhost:8642" },
    });
    expect(screen.getByText("Dashboard Brief")).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ client: { id: "client_hermes", type: "hermes" } }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ bindings: ["dashboard.brief"] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

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
        timeoutMs: 3600000,
      },
    });

    const bindingsCall = fetchMock.mock.calls.find((call) => call[0] === "/api/ai/clients/client_hermes/bindings" && call[1]?.method === "PUT");
    expect(JSON.parse(bindingsCall?.[1]?.body as string)).toEqual({ features: ["dashboard.brief"] });
  });

  it("shows remote Hermes guidance without local auto-configuration", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("No AI client is connected yet. Connect one to unlock planning, suggestions, and execution previews.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(within(screen.getByRole("listbox")).getByText("Hermes"));
    await user.click(screen.getByRole("combobox", { name: "Hermes location" }));
    await user.click(within(screen.getByRole("listbox")).getByText("Remote Hermes"));

    expect(screen.getByText("Remote mode will not touch local files. Configure the remote Hermes machine manually, then test availability here.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Auto-configure local Hermes" })).not.toBeInTheDocument();
  });

  it("auto-configures local Hermes and writes the returned API key into the client payload", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("No AI client is connected yet. Connect one to unlock planning, suggestions, and execution previews.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));
    fireEvent.change(screen.getByPlaceholderText("My Codex Client"), {
      target: { value: "Auto Hermes" },
    });
    await userEvent.click(screen.getByRole("combobox", { name: "Type" }));
    await userEvent.click(within(screen.getByRole("listbox")).getByText("Hermes"));

    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({
      apiKey: "chrona-generated-token",
      maskedApiKey: "chrona-...oken",
      changed: ["env:/home/user/.hermes/.env"],
      diagnostics: {
        mode: "local",
        restartRequired: true,
        checks: [{ key: "hermesEnvFile", status: "warning", message: "Hermes .env updated" }],
      },
      plan: { summary: "Restart Hermes.", canRunAutomatically: false, actions: [] },
    }) });

    fireEvent.click(screen.getByRole("button", { name: "Auto-configure local Hermes" }));

    await screen.findByText("Restart Hermes.");

    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ client: { id: "client_hermes" } }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ bindings: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

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
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ clients: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("No AI client is connected yet. Connect one to unlock planning, suggestions, and execution previews.");
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Type" }));
    await userEvent.click(within(screen.getByRole("listbox")).getByText("Hermes"));

    expect(screen.getByText(/Chrona can run hermes gateway restart/)).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ ok: true, exitCode: null, message: "Hermes gateway restart command started in the background." }) });

    fireEvent.click(screen.getByRole("button", { name: "Restart Hermes gateway" }));

    await screen.findByText("Hermes gateway restart command started in the background.");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/integrations/hermes/restart-local",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("allows testing an existing client card and shows the returned failure reason", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({
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
    }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("Broken Bridge");

    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ ok: true, available: false, reason: "Bridge health endpoint returned 503" }) });

    fireEvent.click(screen.getAllByRole("button", { name: "Test availability" })[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/ai/clients/client_1/test",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await screen.findByText("Unavailable");
    expect(screen.getAllByText("Bridge health endpoint returned 503")).toHaveLength(2);
  });

  it("lets users make an enabled non-default client the default", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({
      clients: [
        {
          id: "client_codex",
          name: "Codex Local",
          type: "codex",
          config: {},
          isDefault: false,
          enabled: true,
          bindings: [],
          createdAt: new Date().toISOString(),
        },
      ],
    }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("Codex Local");

    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ client: { id: "client_codex", isDefault: true } }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({
      clients: [
        {
          id: "client_codex",
          name: "Codex Local",
          type: "codex",
          config: {},
          isDefault: true,
          enabled: true,
          bindings: [],
          createdAt: new Date().toISOString(),
        },
      ],
    }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

    fireEvent.click(screen.getByRole("button", { name: "Make default" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ai/clients/client_codex",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    const makeDefaultCall = fetchMock.mock.calls.find((call) => call[0] === "/api/ai/clients/client_codex" && call[1]?.method === "PATCH");
    expect(JSON.parse(makeDefaultCall?.[1]?.body as string)).toEqual({ isDefault: true });
  });

  it("shows execution and recovery readiness for providers", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({
      clients: [
        {
          id: "client_codex",
          name: "Codex Local",
          type: "codex",
          config: {},
          isDefault: true,
          enabled: true,
          bindings: ["task.execution"],
          createdAt: new Date().toISOString(),
        },
      ],
    }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

    render(<AiClientsManager />);

    await screen.findByText("Codex Local");
    expect(screen.getByLabelText("Provider readiness")).toBeInTheDocument();
    expect(screen.getByText("Configured")).toBeInTheDocument();
    expect(screen.getByText("Reachable")).toBeInTheDocument();
    expect(screen.getByText("Can run tasks")).toBeInTheDocument();
    expect(screen.getByText("Supports task start, live progress, stop, tool use, and structured result validation.")).toBeInTheDocument();
    expect(screen.getByText("Interruption recovery")).toBeInTheDocument();
    expect(screen.getByText("Session context is saved; if execution is interrupted, retry this step to continue.")).toBeInTheDocument();
    expect(screen.queryByText(/Provider lacks critical capabilities/)).not.toBeInTheDocument();
    expect(screen.queryByText(/session_history|active run lookup|stream reconnect/)).not.toBeInTheDocument();

    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ ok: true, available: true, reason: "Codex provider is reachable" }) });

    fireEvent.click(screen.getAllByRole("button", { name: "Test availability" })[0]);

    await screen.findByText("Available");
    expect(screen.getByText("Provider health check passed.")).toBeInTheDocument();
  });
  it("shows SDK-resolved OMP defaults with provenance", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({
      clients: [{
        id: "client_omp",
        name: "PI",
        type: "omp",
        config: {},
        isDefault: true,
        enabled: true,
        bindings: ["task.execution"],
        createdAt: new Date().toISOString(),
      }],
    }) });
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => providersResponse });

    render(<AiClientsManager />);
    await screen.findByText("PI");
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({
      diagnostics: {
        provider: "omp",
        model: "openai-codex/gpt-5.5",
        contextWindow: 272000,
        contextStrategy: "auto_compact",
        workingDirectory: "/workspace",
        configDirectory: "/home/user/.omp",
        agentDirectory: "/home/user/.omp/agent",
        configurationCapabilities: {
          tooling: {
            mcp: { supported: true, enabled: false },
            lsp: { supported: true, enabled: false },
            subagents: { supported: true, enabled: false },
            enabledTools: [],
          },
        },
        sources: {
          model: "provider_default",
          context: "provider_default",
          configDirectory: "provider_default",
          agentDirectory: "provider_default",
          tools: "runtime",
        },
      },
    }) });

    fireEvent.click(screen.getByRole("button", { name: "View runtime configuration" }));

    expect(await screen.findByText("Model: openai-codex/gpt-5.5 (Default)")).toBeInTheDocument();
    expect(screen.getByText("Context strategy: auto_compact (Default)")).toBeInTheDocument();
    expect(screen.getByText("Config directory: /home/user/.omp (Default)")).toBeInTheDocument();
    expect(screen.getByText("Agent data directory: /home/user/.omp/agent (Default)")).toBeInTheDocument();
  });

});
