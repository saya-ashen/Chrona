import type { WorkspaceActivityItem } from "./task-workspace-types";

/**
 * Stable, provider-agnostic activity vocabulary used by the runtime transcript.
 * Providers may call the same operation `exec`, `shell`, or `Bash`; the UI
 * should render one predictable tool identity.
 */
export type TaskRuntimeTool =
	| "bash"
	| "read"
	| "edit"
	| "write"
	| "grep"
	| "glob"
	| "task"
	| "web"
	| "generic";

export type TaskRuntimeToolStatus =
	| "running"
	| "complete"
	| "error"
	| "waiting_approval";

export type TaskRuntimeActivity =
	| {
			kind: "assistant" | "reasoning";
			id: string;
			text: string;
			status: "streaming" | "complete";
			timestamp?: string | null;
			nodeTitle?: string;
	  }
	| {
			kind: "tool";
			id: string;
			tool: TaskRuntimeTool;
			status: TaskRuntimeToolStatus;
			title: string;
			path?: string;
			command?: string;
			cwd?: string;
			input?: unknown;
			output?: unknown;
			diff?: string;
			durationMs?: number;
			timestamp?: string | null;
			nodeTitle?: string;
	  }
	| {
			kind: "approval";
			id: string;
			status: "waiting_approval";
			title: string;
			summary: string;
			timestamp?: string | null;
			nodeTitle?: string;
	  }
	| {
			kind: "step";
			id: string;
			status: "pending" | "running" | "complete" | "blocked" | "error";
			title: string;
			summary?: string;
			timestamp?: string | null;
			nodeTitle?: string;
	  };

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object"
		? (value as Record<string, unknown>)
		: undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function payloadString(
	input: unknown,
	keys: readonly string[],
): string | undefined {
	const record = asRecord(input);
	if (!record) return undefined;
	for (const key of keys) {
		const value = stringValue(record[key]);
		if (value) return value;
	}
	return undefined;
}

function toolLabel(item: WorkspaceActivityItem) {
	return item.tool?.label ?? item.tool?.name ?? item.title;
}

/** Map provider-specific tool labels to the stable runtime vocabulary. */
export function taskRuntimeToolForLabel(
	label: string | undefined,
): TaskRuntimeTool {
	const normalized = (label ?? "").trim().toLowerCase();
	if (
		/^(bash|shell|terminal|exec|execute|command|run_command)(?:\b|_)/.test(
			normalized,
		)
	)
		return "bash";
	if (/^(read|read_file|cat|file_read)(?:\b|_)/.test(normalized)) return "read";
	if (/^(edit|edit_file|patch|apply_patch|file_edit)(?:\b|_)/.test(normalized))
		return "edit";
	if (/^(write|write_file|create_file|file_write)(?:\b|_)/.test(normalized))
		return "write";
	if (/^(grep|rg|ripgrep|search_text)(?:\b|_)/.test(normalized)) return "grep";
	if (/^(glob|find|find_files|list_files|ls)(?:\b|_)/.test(normalized))
		return "glob";
	if (/^(task|agent|subagent|delegate|spawn)(?:\b|_)/.test(normalized))
		return "task";
	if (
		/^(web|browser|webfetch|web_search|search_web|fetch)(?:\b|_)/.test(
			normalized,
		)
	)
		return "web";
	return "generic";
}

function toolStatus(item: WorkspaceActivityItem): TaskRuntimeToolStatus {
	if (item.kind === "approval") return "waiting_approval";
	if (item.tool?.state === "failed" || item.tone === "danger") return "error";
	if (item.tool?.state === "completed" || item.tone === "success")
		return "complete";
	return "running";
}

function stepStatus(
	item: WorkspaceActivityItem,
): "pending" | "running" | "complete" | "blocked" | "error" {
	if (item.kind === "approval" || item.tone === "warning") return "blocked";
	if (item.tone === "danger") return "error";
	if (item.tone === "success") return "complete";
	return "running";
}

/**
 * Normalize persisted and live workspace items before they reach a transcript
 * component. Unknown payloads remain available for an explicit details view;
 * no provider payload is silently discarded.
 */
export function workspaceActivityToTaskRuntimeActivity(
	item: WorkspaceActivityItem,
): TaskRuntimeActivity {
	if (item.kind === "provider_run") {
		const reasoning = item.title.toLowerCase().includes("reasoning");
		return {
			kind: reasoning ? "reasoning" : "assistant",
			id: item.id,
			text: item.summary || item.description,
			status: item.tone === "success" ? "complete" : "streaming",
			timestamp: item.timestamp,
			nodeTitle: item.sourceNodeTitle,
		};
	}

	if (
		item.kind === "tool_started" ||
		item.kind === "tool_progress" ||
		item.kind === "tool_completed"
	) {
		const input = item.providerInput;
		const output = item.providerOutput;
		return {
			kind: "tool",
			id: item.id,
			tool: taskRuntimeToolForLabel(toolLabel(item)),
			status: toolStatus(item),
			title: toolLabel(item),
			path: payloadString(input, ["path", "filePath", "file_path", "filename"]),
			command: payloadString(input, ["command", "cmd", "shell"]),
			cwd: payloadString(input, ["cwd", "workingDirectory", "workdir"]),
			input,
			output,
			diff:
				payloadString(output, ["diff", "patch", "unifiedDiff"]) ??
				payloadString(item.providerRaw, ["diff", "patch", "unifiedDiff"]),
			durationMs: item.tool?.durationMs,
			timestamp: item.timestamp,
			nodeTitle: item.sourceNodeTitle,
		};
	}

	if (item.kind === "approval") {
		return {
			kind: "approval",
			id: item.id,
			status: "waiting_approval",
			title: toolLabel(item),
			summary: item.summary || item.description,
			timestamp: item.timestamp,
			nodeTitle: item.sourceNodeTitle,
		};
	}

	return {
		kind: "step",
		id: item.id,
		status: stepStatus(item),
		title: item.title,
		summary: item.summary || item.description,
		timestamp: item.timestamp,
		nodeTitle: item.sourceNodeTitle,
	};
}

export function workspaceActivitiesToTaskRuntimeActivity(
	items: WorkspaceActivityItem[],
): TaskRuntimeActivity[] {
	return items.map(workspaceActivityToTaskRuntimeActivity);
}

export function taskRuntimeToolLabel(tool: TaskRuntimeTool): string {
	return {
		bash: "Bash",
		read: "Read",
		edit: "Edit",
		write: "Write",
		grep: "Grep",
		glob: "Glob",
		task: "Task",
		web: "Web",
		generic: "Tool",
	}[tool];
}
