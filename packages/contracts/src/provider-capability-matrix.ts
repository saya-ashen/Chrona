export type ProviderExecutionCapabilityName =
	| "healthCheck"
	| "startRun"
	| "streamEvents"
	| "cancelActiveRun"
	| "toolTraces"
	| "structuredOutput"
	| "approvalBridge"
	| "engineManagedToolResults"
	| "externalControlPlaneActions";

export type ProviderRecoveryCapabilityName =
	| "sessionResume"
	| "crossProcessDurable"
	| "historyReplay"
	| "activeRunLookup"
	| "streamReconnect"
	| "clientOperationLookup"
	| "readOnlySingleAttempt"
	| "providerResumeRef"
	| "runEventReplay";

export type ProviderCapabilityName =
	| ProviderExecutionCapabilityName
	| ProviderRecoveryCapabilityName;

export type ProviderRecoveryMode =
	| "authoritative_run_lookup"
	| "session_history"
	| "local_stream_only";

export type ProviderCapabilityMatrixEntry = {
	provider: "debug" | "hermes" | "claude_code" | "codex" | "omp";
	label: string;
	execution: Record<ProviderExecutionCapabilityName, boolean>;
	recovery: Record<ProviderRecoveryCapabilityName, boolean> & {
		mode: ProviderRecoveryMode;
	};
	capabilities: Record<ProviderCapabilityName, boolean>;
	uiBehavior: Record<ProviderCapabilityName, string>;
};

const UI_BEHAVIOR: Record<ProviderCapabilityName, string> = {
	healthCheck: "Settings shows provider readiness.",
	startRun: "Execution start action can be enabled when task state allows it.",
	streamEvents: "Workspace can show live execution progress.",
	cancelActiveRun: "Workspace can show cancel/stop action during active runs.",
	approvalBridge: "Workspace can show provider approval checkpoint actions.",
	toolTraces: "Activity view can show provider tool activity.",
	structuredOutput:
		"Result panel can validate json-render output and fall back to text.",
	engineManagedToolResults:
		"Engine can submit a result for a provider-pending tool call.",
	externalControlPlaneActions:
		"Agent can invoke run-scoped control-plane actions.",
	sessionResume:
		"Workspace can resume provider session context after interruption.",
	historyReplay:
		"Engine can replay provider session history for terminal evidence.",
	activeRunLookup:
		"Engine can query an active provider run snapshot by run id.",
	streamReconnect: "Workspace can reconnect to an active provider run stream.",
	crossProcessDurable:
		"Provider run lookup and stream reattachment remain authoritative after a process restart.",
	clientOperationLookup:
		"Engine can repair a missing provider run ref by stable client operation id.",
	readOnlySingleAttempt:
		"Engine can issue one tool-isolated read-only request and fails closed if its outcome is interrupted.",
	providerResumeRef:
		"Engine can persist a provider-private resume reference for recovery.",
	runEventReplay:
		"Engine can replay or reattach provider run events after interruption.",
};

function matrixEntry(
	input: Omit<ProviderCapabilityMatrixEntry, "capabilities" | "uiBehavior">,
): ProviderCapabilityMatrixEntry {
	return {
		...input,
		capabilities: {
			...input.execution,
			sessionResume: input.recovery.sessionResume,
			historyReplay: input.recovery.historyReplay,
			activeRunLookup: input.recovery.activeRunLookup,
			streamReconnect: input.recovery.streamReconnect,
			crossProcessDurable: input.recovery.crossProcessDurable,
			clientOperationLookup: input.recovery.clientOperationLookup,
			readOnlySingleAttempt: input.recovery.readOnlySingleAttempt,
			providerResumeRef: input.recovery.providerResumeRef,
			runEventReplay: input.recovery.runEventReplay,
			engineManagedToolResults: input.execution.engineManagedToolResults,
			externalControlPlaneActions: input.execution.externalControlPlaneActions,
		},
		uiBehavior: UI_BEHAVIOR,
	};
}

export const providerCapabilityMatrix = [
	matrixEntry({
		provider: "hermes",
		label: "Hermes",
		execution: {
			healthCheck: true,
			startRun: true,
			streamEvents: true,
			cancelActiveRun: true,
			approvalBridge: true,
			toolTraces: true,
			structuredOutput: true,
			engineManagedToolResults: false,
			externalControlPlaneActions: false,
		},
		recovery: {
			sessionResume: true,
			historyReplay: true,
			activeRunLookup: true,
			streamReconnect: true,
			crossProcessDurable: true,
			mode: "authoritative_run_lookup",
			clientOperationLookup: false,
			readOnlySingleAttempt: false,
			providerResumeRef: true,
			runEventReplay: true,
		},
	}),
	matrixEntry({
		provider: "claude_code",
		label: "Claude Code",
		execution: {
			healthCheck: true,
			startRun: true,
			streamEvents: true,
			cancelActiveRun: true,
			approvalBridge: false,
			toolTraces: true,
			structuredOutput: true,
			engineManagedToolResults: false,
			externalControlPlaneActions: true,
		},
		recovery: {
			sessionResume: true,
			historyReplay: true,
			activeRunLookup: true,
			streamReconnect: false,
			crossProcessDurable: false,
			mode: "local_stream_only",
			clientOperationLookup: false,
			readOnlySingleAttempt: false,
			providerResumeRef: true,
			runEventReplay: true,
		},
	}),
	matrixEntry({
		provider: "codex",
		label: "Codex",
		execution: {
			healthCheck: true,
			startRun: true,
			streamEvents: true,
			cancelActiveRun: true,
			approvalBridge: true,
			toolTraces: true,
			structuredOutput: true,
			engineManagedToolResults: false,
			externalControlPlaneActions: true,
		},
		recovery: {
			sessionResume: true,
			historyReplay: true,
			activeRunLookup: false,
			streamReconnect: false,
			crossProcessDurable: false,
			mode: "session_history",
			clientOperationLookup: false,
			readOnlySingleAttempt: false,
			providerResumeRef: true,
			runEventReplay: false,
		},
	}),
	matrixEntry({
		provider: "omp",
		label: "Oh My Pi",
		execution: {
			healthCheck: true,
			startRun: true,
			streamEvents: true,
			cancelActiveRun: true,
			approvalBridge: false,
			toolTraces: true,
			structuredOutput: true,
			engineManagedToolResults: false,
			externalControlPlaneActions: true,
		},
		recovery: {
			sessionResume: true,
			historyReplay: true,
			activeRunLookup: false,
			streamReconnect: false,
			crossProcessDurable: false,
			mode: "session_history",
			clientOperationLookup: false,
			readOnlySingleAttempt: true,
			providerResumeRef: true,
			runEventReplay: false,
		},
	}),
	matrixEntry({
		provider: "debug",
		label: "Chrona Debug",
		execution: {
			healthCheck: true,
			startRun: true,
			streamEvents: true,
			cancelActiveRun: true,
			approvalBridge: false,
			toolTraces: true,
			structuredOutput: true,
			engineManagedToolResults: true,
			externalControlPlaneActions: false,
		},
		recovery: {
			sessionResume: true,
			historyReplay: true,
			activeRunLookup: true,
			streamReconnect: true,
			crossProcessDurable: false,
			clientOperationLookup: true,
			readOnlySingleAttempt: true,
			providerResumeRef: true,
			runEventReplay: true,
			mode: "local_stream_only",
		},
	}),
] as const satisfies readonly ProviderCapabilityMatrixEntry[];
