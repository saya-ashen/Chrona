import type { ExecutionActionType } from "./commands";
import type { PublicEffectivePlanGraph } from "./public-effective-plan";
import type { PublicPlanExecutionResult } from "./execution-state";
import type { GeneratePlanStatusPhase, GeneratePlanErrorCode } from "./_leaf";

export type {
	GeneratePlanStatusPhase,
	GeneratePlanErrorCode,
} from "./_leaf";

export type ProviderApprovalChoice =
	| "approve_once"
	| "approve_session"
	| "approve_always"
	| "deny";

export type PublicProviderDescriptor = {
	category: "ai_provider" | "runtime" | "tool" | "system" | "unknown";
	label: string;
};

export type ProviderApprovalReadModel = {
	id?: string;
	provider: PublicProviderDescriptor;
	kind: string;
	title: string;
	summary: string;
	description?: string;
	riskLevel: "low" | "medium" | "high" | "critical" | "unknown";
	subject?: {
		type: "command" | "tool" | "url" | "file";
		label: string;
		language?: string;
	};
	choices: ProviderApprovalChoice[];
	defaultChoice?: ProviderApprovalChoice;
	recommendedChoice?: ProviderApprovalChoice;
	scopePolicy?: {
		supportsOnce: boolean;
		supportsSession: boolean;
		supportsAlways: boolean;
		supportsResolveAll: boolean;
	};
};

export type PlanExecutionRuntimeDisplayEvent =
	| {
			type: "text_delta";
			/** Redacted assistant output chunk emitted by the provider. */
			text: string;
	  }
	| {
			type: "reasoning_delta";
			/** Redacted provider reasoning chunk emitted by the provider. */
			text: string;
	  }
	| {
			type: "raw_event";
			/** Lifecycle label for a provider event without a richer public shape. */
			rawEventType?: string;
	  }
	| {
			type: "tool_started";
			tool: PublicProviderDescriptor;
			label: string;
			callId?: string;
			/** Bounded, allowlisted tool parameters safe for display. */
			input?: unknown;
	  }
	| {
			type: "tool_progress";
			tool: PublicProviderDescriptor;
			label: string;
			callId?: string;
			/** Bounded, allowlisted progress data safe for display. */
			output?: unknown;
	  }
	| {
			type: "tool_completed";
			tool?: PublicProviderDescriptor;
			label: string;
			callId?: string;
			durationMs?: number;
			/** Bounded, allowlisted result data safe for display. */
			output?: unknown;
			error?: { code?: string; message?: string };
	  }
	| {
			type: "approval_required";
			approval: ProviderApprovalReadModel;
	  }
	| {
			type: "run_status";
			status: "started" | "completed" | "failed" | "cancelled";
			/** Bounded, allowlisted lifecycle data safe for display. */
			input?: unknown;
			output?: unknown;
			error?: string;
	  };

export type PlanExecutionSSEEvent =
	| {
			type: "status";
			action: ExecutionActionType;
			message: string;
	  }
	| {
			type: "graph_event";
			event: string;
			nodeId?: string;
			nodeTitle?: string;
			status?: string;
			message?: string;
	  }
	| {
			type: "state";
			effectivePlan: PublicEffectivePlanGraph;
	  }
	| {
			type: "runtime_event";
			action: ExecutionActionType;
			executionScope: string;
			nodeId?: string;
			nodeTitle?: string;
			runtime: PublicProviderDescriptor;
			provider: PublicProviderDescriptor;
			sequence?: number;
			timestamp?: string;
			event: PlanExecutionRuntimeDisplayEvent;
	  }
	| {
			type: "result";
			result: PublicPlanExecutionResult;
	  }
	| {
			type: "error";
			code: "INTERNAL_ERROR";
			message: string;
	  }
	| {
			type: "done";
	  };
export interface GeneratePlanStatusEvent {
	type: "status";
	phase: GeneratePlanStatusPhase;
	message: string;
}

export interface GeneratePlanCommittedEvent {
	type: "committed";
	planId: string;
	headStateVersion: number;
}

export interface GeneratePlanStaleEvent {
	type: "stale";
	code: "STALE_GENERATION";
	/** Stable durable-runtime error code for diagnostics; absent for legacy events. */
	persistedCode?: string;
	message: string;
}

export interface GeneratePlanCancelledEvent {
	type: "cancelled";
}

export interface GeneratePlanErrorEvent {
	type: "failed";
	code: GeneratePlanErrorCode;
	title?: string;
	/** Stable durable-runtime error code for diagnostics; absent for legacy events. */
	persistedCode?: string;
	message: string;
}

export interface GeneratePlanDoneEvent {
	type: "done";
}

export type GeneratePlanSSEEvent =
	| GeneratePlanStatusEvent
	| GeneratePlanCommittedEvent
	| GeneratePlanStaleEvent
	| GeneratePlanCancelledEvent
	| GeneratePlanErrorEvent
	| GeneratePlanDoneEvent;
