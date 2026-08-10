import {
	Activity,
	Check,
	CircleAlert,
	ChevronRight,
	LoaderCircle,
	TerminalSquare,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { UiDocument } from "@chrona/ui-protocol";
import {
	ActivityTimeline,
	SpecRenderer,
	runtimeEventsToWorkspaceActivity,
	taskRuntimeToolLabel,
	workspaceActivityToTaskRuntimeActivity,
	type TaskRuntimeTool,
	type WorkspaceActivityItem,
} from "@features/task-workspace/public/workspace-integration";
import type {
	ResultNodeFilter,
	ResultNodeOption,
} from "./build-execution-overview-spec";
import type { WorkspaceRuntimeEvent } from "../model/workspace-runtime-events";
import {
	Badge,
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@shared/ui";
type CommandCenterCopy = Record<string, string | undefined>;

type WorkspaceCopy = Record<string, string | undefined>;
type ResultStatus = "active" | "failed" | "running" | "ready" | "unavailable";
type ResultCollapseCommand = {
	mode: "collapse" | "expand";
	revision: number;
} | null;

type ResultStatusInfoProps = {
	status: ResultStatus;
	hasAvailableResult: boolean;
	copy: WorkspaceCopy;
	isProducingOutput: boolean;
};

function resultStatusLabel(
	status: ResultStatus,
	hasAvailableResult: boolean,
	copy: WorkspaceCopy,
) {
	if (status === "active")
		return hasAvailableResult
			? (copy.resultsAvailableBadge ?? "Results available")
			: (copy.resultsPendingBadge ?? "No result yet");
	if (status === "failed")
		return copy.finalizationFailedBadge ?? "Finalization failed";
	if (status === "running") return copy.finalizationRunningBadge ?? "Preparing";
	return status === "ready"
		? (copy.aiGeneratedBadge ?? "AI generated")
		: (copy.finalizationUnavailableBadge ?? "Artifacts only");
}

function resultStatusDescription(
	status: ResultStatus,
	hasAvailableResult: boolean,
	copy: WorkspaceCopy,
) {
	if (status === "active")
		return hasAvailableResult
			? (copy.resultsAvailableDescription ??
					"Current output and completed step results collected during this run.")
			: (copy.resultsPendingDescription ??
					"The current step has not produced viewable output yet. Follow execution activity for live progress.");
	if (status === "failed")
		return (
			copy.finalizationFailedDescription ??
			"Chrona could not assemble the final result. Generated files remain available below."
		);
	if (status === "running")
		return (
			copy.finalizationRunningDescription ??
			"Chrona is assembling and validating the final result."
		);
	return status === "ready"
		? (copy.validatedOutputDescription ??
				"Validated output from task execution.")
		: (copy.finalizationUnavailableDescription ??
				"The final result is unavailable. Generated files are shown below.");
}

function resultStatusTitle(status: ResultStatus, copy: WorkspaceCopy) {
	if (status === "active") return copy.stageResultsTitle ?? "Stage results";
	if (status === "failed")
		return copy.finalizationFailedTitle ?? "Final result unavailable";
	if (status === "running")
		return copy.finalizationRunningTitle ?? "Preparing final result";
	return copy.finalResultTitle ?? "Final result";
}

function resultStatusClassName(status: ResultStatus) {
	if (status === "active")
		return "bg-sky-500/10 text-sky-700 dark:text-sky-200";
	if (status === "failed")
		return "border-destructive/30 bg-destructive/10 text-destructive";
	if (status === "running")
		return "bg-amber-500/10 text-amber-700 dark:text-amber-200";
	return "bg-violet-500/10 text-violet-700 dark:text-violet-200";
}

function ResultStatusInfo({
	status,
	hasAvailableResult,
	copy,
	isProducingOutput,
}: ResultStatusInfoProps) {
	return (
		<div className="min-w-0 space-y-1">
			<h3
				id="task-workspace-results-heading"
				className="font-heading text-base font-semibold text-foreground"
			>
				{resultStatusTitle(status, copy)}
			</h3>
			<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
				{status === "active" && isProducingOutput ? (
					<span
						role="status"
						aria-label="Execution is producing output"
						className="inline-flex items-center"
					>
						<LoaderCircle className="size-3.5 animate-spin" aria-hidden />
						{!hasAvailableResult ? (
							<span className="sr-only">
								{resultStatusLabel(status, false, copy)}
							</span>
						) : null}
					</span>
				) : null}
				<Badge variant="outline" className={resultStatusClassName(status)}>
					{resultStatusLabel(status, hasAvailableResult, copy)}
				</Badge>
				<span>{resultStatusDescription(status, hasAvailableResult, copy)}</span>
			</div>
		</div>
	);
}

type FinalizationRetryProps = {
	copy: WorkspaceCopy;
	error: string | null | undefined;
	isRetrying: boolean;
	onRetry: (() => Promise<void> | void) | undefined;
};

function FinalizationRetry({
	copy,
	error,
	isRetrying,
	onRetry,
}: FinalizationRetryProps) {
	return (
		<div
			className="mt-3 space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-3 text-sm"
			role="alert"
		>
			<p className="font-medium text-foreground">
				{copy.finalizationFailedActionDescription ??
					"Retry finalization to assemble and validate the complete result."}
			</p>
			{error ? <p className="text-xs text-destructive">{error}</p> : null}
			<Button
				type="button"
				size="sm"
				onClick={() => void onRetry?.()}
				disabled={!onRetry || isRetrying}
			>
				{isRetrying
					? (copy.finalizationRetrying ?? "Retrying finalization...")
					: (copy.finalizationRetry ?? "Retry finalization")}
			</Button>
		</div>
	);
}

type ResultsToolbarProps = {
	copy: WorkspaceCopy;
	nodeOptions: ResultNodeOption[];
	selectedNodeId: ResultNodeFilter;
	onSelectedNodeIdChange: (value: ResultNodeFilter) => void;
	onCollapseCommand: (mode: "collapse" | "expand") => void;
};

function ResultsToolbar({
	copy,
	nodeOptions,
	selectedNodeId,
	onSelectedNodeIdChange,
	onCollapseCommand,
}: ResultsToolbarProps) {
	return (
		<div className="flex flex-wrap items-center justify-end gap-2">
			{nodeOptions.length > 1 ? (
				<Select
					value={selectedNodeId}
					onValueChange={(value) =>
						onSelectedNodeIdChange(value as ResultNodeFilter)
					}
				>
					<SelectTrigger
						aria-label={copy.resultNodeFilterLabel ?? "Filter results by node"}
						size="sm"
						className="max-w-full bg-background/90 text-xs"
					>
						<SelectValue
							placeholder={copy.resultNodeFilterAll ?? "All nodes"}
						/>
					</SelectTrigger>
					<SelectContent align="end">
						<SelectItem value="all">
							{copy.resultNodeFilterAll ?? "All nodes"}
						</SelectItem>
						{nodeOptions.map((node) => (
							<SelectItem key={node.id} value={node.id}>
								{node.title}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			) : null}
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="h-8 px-2.5 text-xs"
						/>
					}
				>
					{copy.resultOptions ?? "Result options"}
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onClick={() => onCollapseCommand("collapse")}>
						{copy.collapseAllResults ?? "Collapse all"}
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => onCollapseCommand("expand")}>
						{copy.expandAllResults ?? "Expand all"}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

type ExecutionResultsProps = {
	taskId: string;
	workspaceCopy: WorkspaceCopy;
	active: boolean;
	status: ResultStatus;
	isLive: boolean;
	hasAvailableResult: boolean;
	finalizationRetryError: string | null | undefined;
	onRetryFinalization: (() => Promise<void> | void) | undefined;
	isRetryingFinalization: boolean;
	nodeOptions: ResultNodeOption[];
	selectedNodeId: ResultNodeFilter;
	onSelectedNodeIdChange: (value: ResultNodeFilter) => void;
	onCollapseCommand: (mode: "collapse" | "expand") => void;
	outputSpec: UiDocument;
	handlers: Record<string, (params: Record<string, unknown>) => void>;
	resultCollapseCommand: ResultCollapseCommand;
	runtimeEvents: WorkspaceRuntimeEvent[];
	activityItems: WorkspaceActivityItem[];
	activitySummary: string;
};

function formatProviderPayload(value: unknown) {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

function ProviderPayloadBlock({
	label,
	value,
	embedded = false,
}: {
	label: string;
	value: unknown;
	embedded?: boolean;
}) {
	if (value === undefined) return null;
	return (
		<div
			className={
				embedded
					? "rounded-lg border border-border/70 bg-muted/35 p-2"
					: "rounded-xl border border-slate-700 bg-slate-900/80 p-2"
			}
		>
			<p
				className={
					embedded
						? "mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
						: "mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400"
				}
			>
				{label}
			</p>
			<pre
				className={
					embedded
						? "max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground"
						: "max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-100"
				}
			>
				{formatProviderPayload(value)}
			</pre>
		</div>
	);
}

type ProviderChatItem =
	| {
			kind: "assistant" | "reasoning";
			key: string;
			nodeTitle?: string;
			text: string;
	  }
	| {
			kind: "tool";
			key: string;
			nodeTitle?: string;
			tool: TaskRuntimeTool;
			label: string;
			state: "started" | "progress" | "completed" | "failed";
			path?: string;
			command?: string;
			cwd?: string;
			input?: unknown;
			output?: unknown;
			diff?: string;
			raw?: unknown;
			startedAt?: string;
			completedAt?: string;
	  }
	| {
			kind: "status";
			key: string;
			label: string;
			tone: "info" | "success" | "warning" | "danger";
	  };

function appendProviderChatText(
	items: ProviderChatItem[],
	kind: "assistant" | "reasoning",
	key: string,
	nodeTitle: string | undefined,
	text: string,
) {
	if (!text) return;
	const previous = items.at(-1);
	if (previous?.kind === kind && previous.nodeTitle === nodeTitle) {
		previous.text += text;
		return;
	}
	items.push({ kind, key, nodeTitle, text });
}

function appendProviderTool(
	items: ProviderChatItem[],
	event: WorkspaceRuntimeEvent,
	index: number,
) {
	const value = event.event;
	if (
		value.type !== "tool_started" &&
		value.type !== "tool_progress" &&
		value.type !== "tool_completed"
	)
		return;
	const activity = runtimeEventsToWorkspaceActivity([event], 1)[0];
	if (!activity) return;
	const normalized = workspaceActivityToTaskRuntimeActivity(activity);
	if (normalized.kind !== "tool") return;

	const existing = items.findLast(
		(item): item is Extract<ProviderChatItem, { kind: "tool" }> =>
			item.kind === "tool" &&
			item.tool === normalized.tool &&
			item.nodeTitle === event.nodeTitle &&
			(item.state === "started" || item.state === "progress"),
	);
	const state =
		value.type === "tool_completed"
			? value.error
				? "failed"
				: "completed"
			: value.type === "tool_progress"
				? "progress"
				: "started";
	const update = {
		state,
		path: normalized.path,
		command: normalized.command,
		cwd: normalized.cwd,
		input: normalized.input,
		output: normalized.output,
		diff: normalized.diff,
		raw: value.raw,
		startedAt: value.type === "tool_started" ? event.timestamp : undefined,
		completedAt: value.type === "tool_completed" ? event.timestamp : undefined,
	} satisfies Partial<Extract<ProviderChatItem, { kind: "tool" }>>;

	if (existing) {
		Object.assign(
			existing,
			Object.fromEntries(
				Object.entries(update).filter(([, entry]) => entry !== undefined),
			),
		);
		return;
	}
	items.push({
		kind: "tool",
		key: `${event.executionScope}-${event.sequence ?? index}-${value.type}`,
		nodeTitle: event.nodeTitle,
		tool: normalized.tool,
		label:
			normalized.tool === "generic"
				? normalized.title
				: taskRuntimeToolLabel(normalized.tool),
		...update,
		state,
	});
}

function providerChatItems(
	events: WorkspaceRuntimeEvent[],
): ProviderChatItem[] {
	const items: ProviderChatItem[] = [];
	for (const [index, event] of events.entries()) {
		const value = event.event;
		const key = `${event.executionScope}-${event.sequence ?? index}-${value.type}`;
		switch (value.type) {
			case "text_delta":
				appendProviderChatText(
					items,
					"assistant",
					key,
					event.nodeTitle,
					value.text,
				);
				break;
			case "reasoning_delta":
				appendProviderChatText(
					items,
					"reasoning",
					key,
					event.nodeTitle,
					value.text,
				);
				break;
			case "tool_started":
			case "tool_progress":
			case "tool_completed":
				appendProviderTool(items, event, index);
				break;
			case "approval_required":
				items.push({
					kind: "status",
					key,
					label: "Waiting for approval",
					tone: "warning",
				});
				break;
			case "run_status": {
				if (value.status === "failed")
					items.push({
						kind: "status",
						key,
						label: value.error ?? "Provider run failed",
						tone: "danger",
					});
				if (value.status === "cancelled")
					items.push({
						kind: "status",
						key,
						label: "Run cancelled",
						tone: "warning",
					});
				if (value.status === "completed") {
					const output = value.output;
					const text =
						output &&
						typeof output === "object" &&
						"text" in output &&
						typeof output.text === "string"
							? output.text
							: undefined;
					if (text)
						appendProviderChatText(
							items,
							"assistant",
							key,
							event.nodeTitle,
							text,
						);
				}
				break;
			}
			case "raw_event":
				// Lifecycle noise such as turn_start and thinking_level_changed belongs
				// in diagnostics, not in the user-facing chat transcript.
				break;
		}
	}
	return items;
}

function formatToolDuration(item: Extract<ProviderChatItem, { kind: "tool" }>) {
	if (!item.startedAt || !item.completedAt) return null;
	const durationMs = Date.parse(item.completedAt) - Date.parse(item.startedAt);
	if (!Number.isFinite(durationMs) || durationMs < 0) return null;
	if (durationMs < 1000) return "<1s";
	return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}

function compactProviderPreview(value: unknown) {
	if (value === undefined) return null;
	const text = formatProviderPayload(value).trim();
	if (!text) return null;
	return text.length > 280 ? `${text.slice(0, 280)}…` : text;
}

function LiveExecutionStream({
	items,
	isLive,
	copy,
}: {
	items: ProviderChatItem[];
	isLive: boolean;
	copy: WorkspaceCopy;
}) {
	const latestActiveKey = items.findLast(
		(item): item is Extract<ProviderChatItem, { kind: "tool" }> =>
			item.kind === "tool" &&
			(item.state === "started" || item.state === "progress"),
	)?.key;

	if (items.length === 0) {
		return (
			<div className="px-4 py-8 text-center text-sm text-muted-foreground">
				{isLive
					? (copy.liveExecutionDescription ??
						"Chrona is receiving runtime events.")
					: (copy.completedActivityDescription ??
						"Execution events and tool activity for this run.")}
			</div>
		);
	}

	return (
		<ol className="divide-y divide-border/60" aria-label="Execution stream">
			{items.map((item) => {
				if (item.kind === "assistant") {
					return (
						<li key={item.key} className="px-4 py-3">
							<div className="flex items-start gap-3">
								<span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">
									AI
								</span>
								<p className="min-w-0 flex-1 text-sm leading-relaxed text-foreground line-clamp-3">
									{item.text}
								</p>
							</div>
						</li>
					);
				}

				if (item.kind === "reasoning") {
					return (
						<li
							key={item.key}
							className="flex items-center gap-3 px-4 py-2.5 text-xs text-muted-foreground"
						>
							<span
								className="flex size-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"
								aria-hidden
							>
								{isLive ? (
									<LoaderCircle className="size-3 animate-spin" />
								) : (
									"·"
								)}
							</span>
							<span>
								{copy.runtimeTranscriptThinking ?? "Analyzing context"}
							</span>
						</li>
					);
				}

				if (item.kind === "status") {
					const statusClass =
						item.tone === "danger"
							? "text-destructive"
							: item.tone === "warning"
								? "text-amber-700 dark:text-amber-300"
								: item.tone === "success"
									? "text-emerald-700 dark:text-emerald-300"
									: "text-muted-foreground";
					return (
						<li
							key={item.key}
							className={`flex items-center gap-3 px-4 py-2.5 text-xs font-medium ${statusClass}`}
						>
							{item.tone === "danger" ? (
								<CircleAlert className="size-4 shrink-0" aria-hidden />
							) : (
								<span
									className="size-2 shrink-0 rounded-full bg-current"
									aria-hidden
								/>
							)}
							<span>{item.label}</span>
						</li>
					);
				}

				if (item.kind !== "tool") return null;
				const tool = item;
				const isCurrent = tool.key === latestActiveKey;
				const duration = formatToolDuration(tool);
				const preview = compactProviderPreview(tool.output ?? tool.diff);
				const hasDetails = Boolean(tool.command || preview);
				const stateLabel =
					tool.state === "failed"
						? "Failed"
						: tool.state === "completed"
							? "Completed"
							: isCurrent
								? "Running"
								: "Pending";

				const row = (
					<div className="flex min-w-0 items-center gap-3 px-4 py-3">
						<span
							className={`flex size-5 shrink-0 items-center justify-center rounded-full ${
								tool.state === "failed"
									? "bg-destructive/10 text-destructive"
									: tool.state === "completed"
										? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
										: "bg-primary/10 text-primary"
							}`}
							aria-hidden
						>
							{tool.state === "failed" ? (
								<CircleAlert className="size-3.5" />
							) : tool.state === "completed" ? (
								<Check className="size-3.5" />
							) : (
								<LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
							)}
						</span>
						<div className="min-w-0 flex-1">
							<div className="flex min-w-0 items-center gap-2">
								<span className="truncate text-sm font-medium text-foreground">
									{tool.label}
								</span>
								{tool.path ? (
									<code className="min-w-0 truncate text-[11px] text-muted-foreground">
										{tool.path}
									</code>
								) : null}
							</div>
							{tool.nodeTitle ? (
								<p className="mt-0.5 truncate text-[11px] text-muted-foreground">
									{tool.nodeTitle}
								</p>
							) : null}
						</div>
						<span className="shrink-0 text-[11px] text-muted-foreground">
							{duration ?? stateLabel}
						</span>
						{hasDetails ? (
							<ChevronRight
								className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
								aria-hidden
							/>
						) : null}
					</div>
				);

				if (!hasDetails) {
					return <li key={item.key}>{row}</li>;
				}

				return (
					<li key={item.key}>
						<details open={isCurrent && isLive} className="group">
							<summary className="cursor-pointer list-none outline-none focus-visible:bg-primary/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
								{row}
							</summary>
							<div className="ml-12 mr-4 mb-3 rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
								{tool.command ? (
									<code className="block whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
										{tool.command}
									</code>
								) : null}
								{preview ? (
									<pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words border-t border-border/60 pt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
										{preview}
									</pre>
								) : null}
							</div>
						</details>
					</li>
				);
			})}
		</ol>
	);
}

function ProviderChatTranscript({
	events,
	isLive,
	copy,
	embedded = false,
}: {
	events: WorkspaceRuntimeEvent[];
	isLive: boolean;
	copy: WorkspaceCopy;
	embedded?: boolean;
}) {
	const items = providerChatItems(events);
	const latestActiveKey = items.findLast(
		(item): item is Extract<ProviderChatItem, { kind: "tool" }> =>
			item.kind === "tool" &&
			(item.state === "started" || item.state === "progress"),
	)?.key;
	if (items.length === 0) return null;

	return (
		<section
			className={
				embedded
					? "overflow-hidden rounded-xl bg-transparent text-foreground"
					: "mb-5 overflow-hidden rounded-2xl border-2 border-slate-800 bg-slate-950 text-slate-100 shadow-[0_18px_55px_rgba(15,23,42,0.22)]"
			}
			aria-label={
				embedded
					? undefined
					: (copy.runtimeTranscriptTitle ?? "Agent transcript")
			}
			data-testid={
				embedded ? "provider-execution-trace-live" : "provider-execution-trace"
			}
		>
			{embedded ? null : (
				<div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/90 px-4 py-3">
					<div>
						<h4 className="text-sm font-semibold text-slate-100">
							{copy.runtimeTranscriptTitle ?? "Agent transcript"}
						</h4>
						<p className="mt-0.5 text-xs text-slate-400">
							{copy.runtimeTranscriptDescription ??
								"Live assistant conversation and tool execution"}
						</p>
					</div>
					{isLive ? (
						<Badge variant="default">
							<LoaderCircle className="mr-1 size-3 animate-spin" />
							{copy.runtimeTranscriptLive ?? "Live"}
						</Badge>
					) : (
						<Badge variant="secondary">
							{copy.runtimeTranscriptRecorded ?? "Recorded"}
						</Badge>
					)}
				</div>
			)}
			<div
				className={
					embedded
						? "space-y-2 bg-transparent p-3"
						: "space-y-3 bg-slate-950 p-4"
				}
				role="log"
				aria-live="polite"
			>
				{items.map((item) => {
					if (item.kind === "assistant") {
						return (
							<article
								key={item.key}
								className={embedded ? "flex gap-3" : "flex gap-2"}
							>
								<div
									className={
										embedded
											? "mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary"
											: "mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-[10px] font-bold text-slate-950"
									}
								>
									AI
								</div>
								<div className="min-w-0 flex-1">
									<p
										className={
											embedded
												? "mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
												: "mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400"
										}
									>
										{copy.runtimeTranscriptAssistant ?? "Assistant"}
									</p>
									<div
										className={
											embedded
												? "rounded-xl rounded-tl-md border border-border/70 bg-background px-3 py-2 shadow-sm"
												: "rounded-2xl rounded-tl-md border border-slate-700 bg-slate-900/90 px-3 py-2"
										}
									>
										<pre
											className={
												embedded
													? "whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground"
													: "whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-100"
											}
										>
											{item.text}
										</pre>
									</div>
								</div>
							</article>
						);
					}
					if (item.kind === "reasoning") {
						return (
							<details
								key={item.key}
								className={
									embedded
										? "ml-8 rounded-xl border border-violet-200 bg-violet-50/70 dark:border-violet-900/70 dark:bg-violet-950/25"
										: "ml-8 rounded-xl border border-violet-900/70 bg-violet-950/25"
								}
							>
								<summary
									className={
										embedded
											? "cursor-pointer px-3 py-2 text-xs font-medium text-violet-800 dark:text-violet-200"
											: "cursor-pointer px-3 py-2 text-xs font-medium text-violet-200"
									}
								>
									{copy.runtimeTranscriptThinking ?? "Thinking"}
								</summary>
								<div
									className={
										embedded
											? "border-t border-violet-200 px-3 py-2 dark:border-violet-900/70"
											: "border-t border-violet-900/70 px-3 py-2"
									}
								>
									<pre
										className={
											embedded
												? "whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-violet-900 dark:text-violet-100"
												: "whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-violet-100"
										}
									>
										{item.text}
									</pre>
								</div>
							</details>
						);
					}
					if (item.kind === "status") {
						return (
							<div
								key={item.key}
								className="ml-8 flex items-center gap-2 text-xs text-muted-foreground"
							>
								<span
									className={`size-2 rounded-full ${item.tone === "danger" ? "bg-rose-400" : item.tone === "warning" ? "bg-amber-400" : item.tone === "success" ? "bg-emerald-400" : "bg-cyan-400"}`}
								/>
								{item.label}
							</div>
						);
					}
					if (item.kind !== "tool") return null;
					return (
						<details
							key={item.key}
							open={isLive && item.key === latestActiveKey}
							className={
								embedded
									? "ml-8 rounded-xl border border-border/70 bg-card/80 shadow-sm"
									: "ml-8 rounded-xl border border-slate-700 bg-slate-900/80"
							}
						>
							<summary
								className={
									embedded
										? "flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium text-foreground"
										: "flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium text-slate-100"
								}
							>
								<span
									className={
										embedded
											? "rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
											: "rounded-md bg-slate-800 px-1.5 py-0.5 font-mono text-[10px]"
									}
								>
									{item.state === "failed"
										? "ERR"
										: item.tool === "generic"
											? "TOOL"
											: item.tool.toUpperCase()}
								</span>
								<span>{item.label}</span>
								<Badge
									variant={
										item.state === "completed"
											? "secondary"
											: item.state === "failed"
												? "destructive"
												: "default"
									}
								>
									{item.state}
								</Badge>
								{item.path ? (
									<code
										className={
											embedded
												? "min-w-0 truncate text-[10px] text-muted-foreground"
												: "min-w-0 truncate text-[10px] text-slate-400"
										}
									>
										{item.path}
									</code>
								) : null}
								{item.nodeTitle ? (
									<span className="ml-auto text-[10px] text-muted-foreground">
										{item.nodeTitle}
									</span>
								) : null}
							</summary>
							<div
								className={
									embedded
										? "space-y-2 border-t border-border/70 p-3"
										: "space-y-2 border-t border-slate-700 p-3"
								}
							>
								{item.command ? (
									<div
										className={
											embedded
												? "rounded-lg border border-border/70 bg-muted/40 px-2 py-1.5"
												: "rounded-lg border border-slate-700 bg-black/30 px-2 py-1.5"
										}
									>
										<p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
											{copy.runtimeTranscriptCommand ?? "Command"}
											{item.cwd ? ` · ${item.cwd}` : ""}
										</p>
										<code
											className={
												embedded
													? "block whitespace-pre-wrap break-words font-mono text-xs text-emerald-700 dark:text-emerald-200"
													: "block whitespace-pre-wrap break-words font-mono text-xs text-emerald-200"
											}
										>
											{item.command}
										</code>
									</div>
								) : null}
								<ProviderPayloadBlock
									label={copy.runtimeTranscriptInput ?? "Input"}
									value={item.input}
									embedded={embedded}
								/>
								<ProviderPayloadBlock
									label={copy.runtimeTranscriptResult ?? "Result"}
									value={item.output}
									embedded={embedded}
								/>
								{item.diff ? (
									<pre
										className={
											embedded
												? "max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-emerald-200 bg-emerald-50/70 p-2 font-mono text-[11px] leading-relaxed text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/20 dark:text-emerald-100"
												: "max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-emerald-900/70 bg-emerald-950/20 p-2 font-mono text-[11px] leading-relaxed text-emerald-100"
										}
									>
										{item.diff}
									</pre>
								) : null}
								<ProviderPayloadBlock
									label={
										copy.runtimeTranscriptProviderDetails ?? "Provider details"
									}
									value={item.raw}
									embedded={embedded}
								/>
							</div>
						</details>
					);
				})}
			</div>
		</section>
	);
}

// Live execution owns follow-latest behavior so new events never steal the user's scroll position.
// eslint-disable-next-line complexity
function LiveExecutionFeed({
	items,
	runtimeEvents,
	isLive,
	activitySummary,
	copy,
}: {
	items: WorkspaceActivityItem[];
	runtimeEvents: WorkspaceRuntimeEvent[];
	isLive: boolean;
	activitySummary: string;
	copy: WorkspaceCopy;
}) {
	const streamItems = providerChatItems(runtimeEvents);
	const hasProviderStream = streamItems.length > 0;
	const latestNodeTitle = runtimeEvents.findLast(
		(event) => event.nodeTitle,
	)?.nodeTitle;
	const visibleCount = hasProviderStream ? streamItems.length : items.length;
	const feedRef = useRef<HTMLDivElement>(null);
	const [isFollowingLatest, setIsFollowingLatest] = useState(true);

	const scrollToLatest = (behavior: ScrollBehavior = "auto") => {
		const feed = feedRef.current;
		if (!feed) return;
		feed.scrollTop = feed.scrollHeight;
		if (typeof feed.scrollTo === "function") {
			feed.scrollTo({ top: feed.scrollHeight, behavior });
		}
	};

	useEffect(() => {
		if (!isLive || !isFollowingLatest) return;
		scrollToLatest();
	}, [isFollowingLatest, isLive, items.length, runtimeEvents.length]);

	useEffect(() => {
		if (!isLive) setIsFollowingLatest(true);
	}, [isLive]);

	const handleScroll = () => {
		const feed = feedRef.current;
		if (!feed) return;
		const distanceFromLatest =
			feed.scrollHeight - feed.scrollTop - feed.clientHeight;
		setIsFollowingLatest(distanceFromLatest < 32);
	};

	const returnToLatest = () => {
		setIsFollowingLatest(true);
		scrollToLatest("smooth");
	};

	if (visibleCount === 0 && !isLive) return null;
	return (
		<section
			aria-label={copy.liveExecutionFeedAria ?? "Live execution activity"}
			className="mb-5 overflow-hidden rounded-2xl border border-primary/20 bg-card shadow-sm"
			data-testid="live-execution-feed"
		>
			<div className="border-b border-border/70 bg-primary/[0.03] px-4 py-3">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<span
								className={`size-2.5 rounded-full ${isLive ? "animate-pulse bg-primary motion-reduce:animate-none" : "bg-success"}`}
								aria-hidden
							/>
							<h3 className="text-sm font-semibold text-foreground">
								{isLive
									? (copy.liveExecutionTitle ?? "Live execution")
									: (copy.executionHistoryTitle ?? "Execution history")}
							</h3>
							<span className="text-xs text-muted-foreground">
								{visibleCount} {copy.liveExecutionEventsUnit ?? "events"}
							</span>
						</div>
						<p
							className="mt-1 text-xs text-muted-foreground"
							aria-live={isLive ? "polite" : undefined}
						>
							{latestNodeTitle ||
								activitySummary ||
								(isLive
									? (copy.liveExecutionDescription ??
										"Chrona is receiving runtime events.")
									: (copy.completedActivityDescription ??
										"Execution events and tool activity for this run."))}
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						{isLive && !isFollowingLatest ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-7 rounded-full px-2.5 text-[11px]"
								onClick={returnToLatest}
							>
								{copy.liveExecutionReturnToLatest ?? "Return to latest"}
							</Button>
						) : null}
					</div>
				</div>
			</div>
			<div
				ref={feedRef}
				onScroll={handleScroll}
				tabIndex={0}
				className="max-h-[26rem] overflow-y-auto overscroll-contain bg-background/50"
				aria-label={copy.liveExecutionScrollAria ?? "Execution events"}
				data-runtime-presentation={
					hasProviderStream ? "execution-stream" : "timeline-fallback"
				}
			>
				{hasProviderStream ? (
					<LiveExecutionStream
						items={streamItems}
						isLive={isLive}
						copy={copy}
					/>
				) : (
					<div className="px-3 py-3">
						<ActivityTimeline
							items={items}
							density="detailed"
							active={isLive}
						/>
					</div>
				)}
			</div>
			{isLive && !isFollowingLatest ? (
				<div className="border-t border-border/70 bg-card px-4 py-2 text-right text-xs text-muted-foreground">
					{copy.liveExecutionNewActivity ?? "New activity is available."}
				</div>
			) : null}
		</section>
	);
}

function ExecutionResults(props: ExecutionResultsProps) {
	const {
		taskId,
		workspaceCopy,
		active,
		status,
		hasAvailableResult,
		isLive,
		finalizationRetryError,
		onRetryFinalization,
		isRetryingFinalization,
		nodeOptions,
		selectedNodeId,
		onSelectedNodeIdChange,
		onCollapseCommand,
		outputSpec,
		handlers,
		resultCollapseCommand,
		runtimeEvents,
		activityItems,
	} = props;
	return (
		<section
			aria-label={
				active
					? (workspaceCopy.stageResultsTitle ?? "Stage results")
					: (workspaceCopy.finalResultTitle ?? "Final result")
			}
			className="min-h-0 flex-1 overflow-y-auto"
		>
			<div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-3">
				<div className="min-w-0 space-y-1">
					<ResultStatusInfo
						status={status}
						hasAvailableResult={hasAvailableResult}
						copy={workspaceCopy}
						isProducingOutput={isLive}
					/>
					{status === "failed" ? (
						<FinalizationRetry
							copy={workspaceCopy}
							error={finalizationRetryError}
							isRetrying={isRetryingFinalization}
							onRetry={onRetryFinalization}
						/>
					) : null}
				</div>
				<ResultsToolbar
					copy={workspaceCopy}
					nodeOptions={nodeOptions}
					selectedNodeId={selectedNodeId}
					onSelectedNodeIdChange={onSelectedNodeIdChange}
					onCollapseCommand={onCollapseCommand}
				/>
			</div>
			{active ? (
				<LiveExecutionFeed
					items={activityItems}
					runtimeEvents={runtimeEvents}
					isLive={isLive}
					activitySummary={props.activitySummary ?? ""}
					copy={workspaceCopy}
				/>
			) : null}

			{!active || hasAvailableResult ? (
				<div
					className="mt-6 border-t border-border/70 pt-5"
					data-testid="execution-result-output"
				>
					<div className="mb-3 flex items-center gap-3">
						<span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
							Result output
						</span>
						<div className="h-px flex-1 bg-border/60" />
					</div>
					<SpecRenderer
						spec={outputSpec}
						handlers={handlers}
						resultCollapseCommand={resultCollapseCommand}
						resultCollapseStorageKey={`task:${taskId}:execution-result`}
					/>
				</div>
			) : null}
		</section>
	);
}

type TranscriptProps = {
	copy: CommandCenterCopy;
	workspaceCopy: WorkspaceCopy;
	waitingForHuman: boolean;
	isLive: boolean;
	activityItems: WorkspaceActivityItem[];
	activitySummary: string;
	provider: string | null | undefined;
	runtimeEvents: WorkspaceRuntimeEvent[];
};

export function ExecutionEvidence({
	items,
	runtimeEvents,
	isLive,
	activitySummary,
	copy,
}: {
	items: WorkspaceActivityItem[];
	runtimeEvents: WorkspaceRuntimeEvent[];
	isLive: boolean;
	activitySummary: string;
	copy: WorkspaceCopy;
}) {
	return (
		<LiveExecutionFeed
			items={items}
			runtimeEvents={runtimeEvents}
			isLive={isLive}
			activitySummary={activitySummary}
			copy={copy}
		/>
	);
}

function Transcript({
	waitingForHuman,
	isLive,
	activityItems,
	activitySummary,
	provider,
	runtimeEvents,
	workspaceCopy,
}: TranscriptProps) {
	const activityContent = (
		<ActivityTimeline
			items={activityItems}
			density="detailed"
			active={isLive}
			transcript
		/>
	);
	const statusLabel = isLive
		? (workspaceCopy.runtimeTranscriptLive ?? "Live")
		: waitingForHuman
			? (workspaceCopy.runtimeTranscriptPaused ?? "Paused")
			: (workspaceCopy.runtimeTranscriptCompleted ?? "Completed");
	return (
		<CompletedTranscriptSheet
			count={activityItems.length}
			content={activityContent}
			statusLabel={statusLabel}
			isLive={isLive}
			activitySummary={activitySummary}
			provider={provider}
			runtimeEvents={runtimeEvents}
			workspaceCopy={workspaceCopy}
		/>
	);
}

function CompletedTranscriptSheet({
	count,
	content,
	statusLabel,
	isLive,
	activitySummary,
	provider,
	runtimeEvents,
	workspaceCopy,
}: {
	count: number;
	content: ReactNode;
	statusLabel: string;
	isLive: boolean;
	activitySummary: string;
	provider?: string | null;
	runtimeEvents: WorkspaceRuntimeEvent[];
	workspaceCopy: WorkspaceCopy;
}) {
	return (
		<Sheet>
			<SheetTrigger
				render={
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="fixed right-4 top-20 z-40 inline-flex h-9 touch-manipulation items-center gap-2 rounded-full border-border/80 bg-background/95 px-3 shadow-md backdrop-blur transition-colors supports-[backdrop-filter]:bg-background/85"
						aria-label={`Open ${workspaceCopy.runtimeTranscriptTitle ?? "Agent transcript"} · ${count} events`}
					/>
				}
			>
				<span className="flex items-center gap-2">
					<Activity className="size-4 text-primary" aria-hidden />
					<span className="text-xs font-semibold">
						{workspaceCopy.runtimeTranscriptTitle ?? "Agent transcript"}
					</span>
					<Badge
						variant={isLive ? "default" : "secondary"}
						className="h-5 min-w-5 px-1.5 text-[10px]"
					>
						{count}
					</Badge>
					<span className="sr-only">{statusLabel}</span>
				</span>
			</SheetTrigger>
			<SheetContent className="w-[92vw] max-w-[62rem] gap-0 overflow-hidden data-[side=right]:w-[92vw] data-[side=right]:sm:w-[72vw] data-[side=right]:sm:max-w-[62rem]">
				<SheetHeader className="z-10 shrink-0 border-b border-border/60 bg-popover/95 backdrop-blur supports-[backdrop-filter]:bg-popover/85">
					<SheetTitle className="flex items-center gap-2">
						<TerminalSquare className="size-4 text-primary" aria-hidden />
						{workspaceCopy.runtimeTranscriptTitle ?? "Agent transcript"}
						<Badge variant={isLive ? "default" : "secondary"}>
							{statusLabel}
						</Badge>
						{provider ? (
							<span className="ml-auto text-xs font-medium text-muted-foreground">
								{provider}
							</span>
						) : null}
					</SheetTitle>
					<SheetDescription>
						{workspaceCopy.runtimeTranscriptDescription ??
							"Intent, tool calls, results, and execution state. Latest activity appears first."}
						{activitySummary ? ` ${activitySummary}` : ""}
					</SheetDescription>
				</SheetHeader>
				<div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-4">
					{runtimeEvents.length > 0 ? (
						<ProviderChatTranscript
							events={runtimeEvents}
							isLive={isLive}
							copy={workspaceCopy}
						/>
					) : (
						<div className="mt-1">{content}</div>
					)}
					{runtimeEvents.length > 0 ? (
						<details className="mt-4 rounded-xl border border-border/70 bg-muted/20">
							<summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-muted-foreground">
								{workspaceCopy.runtimeTranscriptTimeline ??
									"Execution timeline"}
							</summary>
							<div className="border-t border-border/60 p-3">{content}</div>
						</details>
					) : null}
				</div>
			</SheetContent>
		</Sheet>
	);
}

export type ExecutionOverviewContentProps = Omit<
	ExecutionResultsProps,
	"active" | "workspaceCopy"
> &
	TranscriptProps & {
		failureAlert: ReactNode;
		executionIsActive: boolean;
		workspaceCopy: WorkspaceCopy;
	};

export function ExecutionOverviewContent({
	failureAlert,
	executionIsActive,
	workspaceCopy,
	...props
}: ExecutionOverviewContentProps) {
	const results = (
		<ExecutionResults
			{...props}
			workspaceCopy={workspaceCopy}
			active={executionIsActive}
		/>
	);
	const transcript = <Transcript {...props} workspaceCopy={workspaceCopy} />;
	return (
		<section
			aria-label={workspaceCopy.executionOverviewAria}
			className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
		>
			{failureAlert}
			<div className="min-h-0 flex-1">{results}</div>
			{transcript}
		</section>
	);
}
