"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardContent, Skeleton } from "@shared/ui";
import { useI18n } from "@chrona/i18n";
import { aiClientsApi, type AiClientDiagnosticsResponse } from "../browser-api";
import { notifyAiClientsChanged } from "../events";
import { ClientForm } from "./ai-client-form";
import { AiClientList } from "./ai-client-list";
import type {
	AiClientInfo,
	ClientSaveData,
	RuntimeProviderOption,
	TestResult,
} from "./ai-client-types";
import {
	normalizeRuntimeProviders,
	testClientAvailability,
} from "./ai-client-view-model";

type StoredTestState = TestResult & { checkedAt: number };

const READINESS_STORAGE_KEY = "chrona:ai-client-readiness";
const READINESS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function loadStoredTestStates(): Record<string, TestResult> {
	if (typeof window === "undefined") return {};
	try {
		const parsed = JSON.parse(
			window.localStorage.getItem(READINESS_STORAGE_KEY) ?? "null",
		) as Record<string, StoredTestState> | null;
		if (!parsed || typeof parsed !== "object") return {};
		const now = Date.now();
		return Object.fromEntries(
			Object.entries(parsed)
				.filter(
					([, value]) => value && now - value.checkedAt <= READINESS_MAX_AGE_MS,
				)
				.map(([id, value]) => [
					id,
					{ status: value.status, reason: value.reason },
				]),
		);
	} catch {
		return {};
	}
}

function storeTestState(clientId: string, result: TestResult) {
	if (
		typeof window === "undefined" ||
		result.status === "idle" ||
		result.status === "testing"
	)
		return;
	try {
		const current = JSON.parse(
			window.localStorage.getItem(READINESS_STORAGE_KEY) ?? "{}",
		) as Record<string, StoredTestState>;
		window.localStorage.setItem(
			READINESS_STORAGE_KEY,
			JSON.stringify({
				...current,
				[clientId]: { ...result, checkedAt: Date.now() },
			}),
		);
	} catch {
		// Readiness is a UI cache; storage failures must not block testing.
	}
}

function clearStoredTestState(clientId: string) {
	if (typeof window === "undefined") return;
	try {
		const current = JSON.parse(
			window.localStorage.getItem(READINESS_STORAGE_KEY) ?? "{}",
		) as Record<string, StoredTestState>;
		delete current[clientId];
		window.localStorage.setItem(READINESS_STORAGE_KEY, JSON.stringify(current));
	} catch {
		// Ignore storage failures; the server remains the source of truth.
	}
}
type RuntimeDiagnostics = NonNullable<
	AiClientDiagnosticsResponse["diagnostics"]
>;

const DEFAULTS: Record<string, string> = {
	title: "AI Clients",
	subtitle:
		"Connect an AI client so Chrona can plan tasks and safely execute approved work.",
	addClient: "+ Add Client",
	emptyState:
		"No AI client is connected yet. Connect one to unlock planning, suggestions, and execution previews.",
	emptyStateCta: "Connect AI Client",
	hermesIntro:
		"Hermes is Chrona's local AI runtime. It generates task plans, proposes schedule changes, and only executes after your approval.",
	loading: "Loading...",
	defaultBadge: "Default",
	enabled: "Enabled",
	edit: "Edit",
	delete: "Delete",
	nameLabel: "Name",
	typeLabel: "Type",
	timeoutSeconds: "Timeout (seconds)",
	debugProfileLabel: "Debug profile",
	debugProfileDeterministic: "Deterministic",
	debugProfileToolSubmit: "Tool submit",
	debugProfileHermesLike: "Hermes-like",
	hermesScopeLabel: "Hermes location",
	hermesScopeLocal: "Local Hermes",
	hermesScopeRemote: "Remote Hermes",
	hermesLocalDescription:
		"Local mode can install the Chrona Hermes plugin and enable the Hermes API server on this machine.",
	hermesRemoteDescription:
		"Remote mode will not touch local files. Configure the remote Hermes machine manually, then test availability here.",
	hermesRestartDescription:
		"Restart Hermes if you changed the plugin, enabled the API server, or updated the API key. Chrona can run hermes gateway restart, but it may not know your original gateway startup options; restart it yourself if that is clearer. Running tasks may pause briefly during restart.",
	remoteBaseUrlRequired: "Remote Hermes base URL is required",
	diagnoseHermes: "Diagnose Hermes",
	autoConfigureHermes: "Auto-configure local Hermes",
	restartHermes: "Restart Hermes gateway",
	restartHermesRequested: "Hermes restart requested.",
	hermesDiagnosticsTitle: "Hermes diagnostics",
	hermesPlanTitle: "Setup plan",
	hermesChangedTitle: "Changed",
	hermesRestartRequired: "Restart Hermes, then run diagnosis again.",
	setAsDefault: "Use as default AI client",
	setAsDefaultHelp:
		"Chrona uses the default client for planning, execution, and summaries unless a feature has its own client.",
	makeDefault: "Make default",
	save: "Save",
	cancel: "Cancel",
	testAvailability: "Test availability",
	testing: "Testing...",
	available: "Available",
	unavailable: "Unavailable",
	statusUnknown: "Not tested",
	reasonUnknown: "No details yet",
	ready: "Ready",
	needsAttention: "Needs attention",
	readinessConfigured: "Configured",
	readinessReachable: "Reachable",
	readinessCapability: "Can run tasks",
	readinessRecovery: "Interruption recovery",
	readinessConfiguredDetail:
		"Client is enabled and required settings are complete.",
	readinessDisabledDetail:
		"Client is disabled or required settings are missing.",
	readinessReachableDetail: "Provider health check passed.",
	readinessRunHealthCheck:
		"Click “Test availability” to confirm this provider is reachable.",
	readinessCapabilityDetail:
		"Supports task start, live progress, stop, tool use, and structured result validation.",
	readinessCapabilityLimited: "Provider execution support incomplete",
	readinessCapabilityUnknown: "Provider capability matrix is not registered.",
	recoveryFull: "Can reconnect to an active task and sync the final state.",
	recoverySnapshotOnly:
		"Can sync run state; live progress is not replayed after disconnect.",
	recoverySessionHistory:
		"Session context is saved; if execution is interrupted, retry this step to continue.",
	recoveryUnavailable: "Interrupted runs cannot be recovered automatically.",
	ompRecoveryLimit:
		"Terminal-only read-only starts run once. If interrupted, Chrona does not replay them; start a new operation explicitly.",
	advancedSettings: "Advanced settings",
	advancedSettingsHelp:
		"Provider endpoints, model overrides, directories, timeouts, and capability assignment.",
	viewRuntimeConfiguration: "View runtime configuration",
	inspectingRuntime: "Inspecting…",
	defaultSource: "Default",
	unresolved: "Unresolved",
	contextStrategy: "Context strategy",
	configDirectory: "Config directory",
	agentDirectory: "Agent data directory",
	modelLabel: "Model",
	subagents: "SubAgents",
	enabledTools: "Enabled tools",
	chronaRunToolsOnly: "Chrona run tools only",
};

function getCopy(messages: Record<string, unknown>): Record<string, string> {
	const section =
		(messages.pages as Record<string, Record<string, string>> | undefined)
			?.aiClientsPage ?? {};
	return { ...DEFAULTS, ...section };
}

// eslint-disable-next-line max-lines-per-function
export function AiClientsManager() {
	const { messages } = useI18n();
	const copy = getCopy(messages as Record<string, unknown>);
	const [clients, setClients] = useState<AiClientInfo[]>([]);
	const [providers, setProviders] = useState<RuntimeProviderOption[]>([]);
	const [showForm, setShowForm] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [cardTestStates, setCardTestStates] = useState<
		Record<string, TestResult>
	>(() => loadStoredTestStates());
	const [diagnostics, setDiagnostics] = useState<
		Record<string, RuntimeDiagnostics>
	>({});
	const [diagnosticsLoading, setDiagnosticsLoading] = useState<
		Record<string, boolean>
	>({});

	const fetchClients = useCallback(async () => {
		const [clientsData, providersData] = await Promise.all([
			aiClientsApi.list(),
			aiClientsApi.listRuntimeProviders(),
		]);
		const available = normalizeRuntimeProviders(providersData);
		setProviders(available);
		setClients(
			(clientsData.clients ?? []).filter((client) =>
				available.some((provider) => provider.key === client.type),
			),
		);
		setLoading(false);
	}, []);
	useEffect(() => {
		void fetchClients();
	}, [fetchClients]);

	const refresh = () => {
		notifyAiClientsChanged();
		void fetchClients();
	};
	const saveNew = async (data: ClientSaveData) => {
		const result = await aiClientsApi.create(data.payload);
		if (result.client?.id)
			await aiClientsApi.updateBindings(result.client.id, data.bindings);
		setShowForm(false);
		refresh();
	};
	const saveExisting = async (id: string, data: ClientSaveData) => {
		await aiClientsApi.update(id, data.payload);
		await aiClientsApi.updateBindings(id, data.bindings);
		clearStoredTestState(id);
		setCardTestStates((current) => {
			const next = { ...current };
			delete next[id];
			return next;
		});
		setEditingId(null);
		refresh();
	};
	const testExisting = async (client: AiClientInfo) => {
		setCardTestStates((current) => ({
			...current,
			[client.id]: { status: "testing", reason: null },
		}));
		try {
			const result = await testClientAvailability({
				name: client.name,
				type: client.type,
				config: client.config,
				isDefault: client.isDefault,
			});
			storeTestState(client.id, result);
			setCardTestStates((current) => ({ ...current, [client.id]: result }));
		} catch (error) {
			const result = {
				status: "unavailable" as const,
				reason: error instanceof Error ? error.message : copy.reasonUnknown,
			};
			storeTestState(client.id, result);
			setCardTestStates((current) => ({ ...current, [client.id]: result }));
		}
	};
	const inspect = async (id: string) => {
		setDiagnosticsLoading((current) => ({ ...current, [id]: true }));
		try {
			const result = await aiClientsApi.diagnostics(id);
			const runtimeDiagnostics = result.diagnostics;
			if (runtimeDiagnostics)
				setDiagnostics((current) => ({ ...current, [id]: runtimeDiagnostics }));
		} finally {
			setDiagnosticsLoading((current) => ({ ...current, [id]: false }));
		}
	};

	if (loading)
		return (
			<div className="flex flex-col gap-3 p-1" aria-label={copy.loading}>
				<Skeleton className="h-6 w-44" />
				<Skeleton className="h-24 w-full" />
			</div>
		);
	return (
		<div className="flex flex-col gap-5">
			<header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex flex-col gap-1">
					<h2 className="text-xl font-semibold tracking-tight">{copy.title}</h2>
					<p className="text-sm text-muted-foreground">{copy.subtitle}</p>
					<p className="text-sm text-muted-foreground">{copy.hermesIntro}</p>
				</div>
				<Button
					type="button"
					disabled={showForm}
					onClick={() => setShowForm(true)}
				>
					{copy.addClient}
				</Button>
			</header>
			{showForm ? (
				<ClientForm
					onSave={saveNew}
					onCancel={() => setShowForm(false)}
					copy={copy}
					providers={providers}
					forceDefault={!clients.length}
				/>
			) : null}
			{!clients.length && !showForm ? (
				<EmptyState copy={copy} onAdd={() => setShowForm(true)} />
			) : null}
			<AiClientList
				clients={clients}
				copy={copy}
				cardTestStates={cardTestStates}
				diagnostics={diagnostics}
				diagnosticsLoading={diagnosticsLoading}
				editingId={editingId}
				onEdit={setEditingId}
				onDelete={async (id) => {
					await aiClientsApi.delete(id);
					clearStoredTestState(id);
					setCardTestStates((current) => {
						const next = { ...current };
						delete next[id];
						return next;
					});
					refresh();
				}}
				onMakeDefault={async (id) => {
					await aiClientsApi.update(id, { isDefault: true });
					refresh();
				}}
				onToggleEnabled={async (id, enabled) => {
					await aiClientsApi.update(id, { enabled });
					clearStoredTestState(id);
					setCardTestStates((current) => {
						const next = { ...current };
						delete next[id];
						return next;
					});
					refresh();
				}}
				onTest={(client) => void testExisting(client)}
				onInspect={(id) => void inspect(id)}
				renderEditor={(client) => (
					<ClientForm
						initial={client}
						onSave={(data) => void saveExisting(client.id, data)}
						onCancel={() => setEditingId(null)}
						copy={copy}
						providers={providers}
					/>
				)}
			/>
		</div>
	);
}

function EmptyState({
	copy,
	onAdd,
}: {
	copy: Record<string, string>;
	onAdd: () => void;
}) {
	return (
		<Card className="border-dashed">
			<CardContent className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
				<p className="max-w-md">{copy.emptyState}</p>
				<Button type="button" onClick={onAdd}>
					{copy.emptyStateCta}
				</Button>
			</CardContent>
		</Card>
	);
}
