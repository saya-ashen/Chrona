import { z } from "zod";
import { defineCatalog } from "@json-render/core";
import { shadcnComponentDefinitions as shadcn } from "@json-render/shadcn/catalog";
import { chronaSchema } from "../schema";
import {
	UI_ACTION,
	commandCenterPrimaryPayloadSchema,
	acceptPlanPayloadSchema,
	dispatchExecutionPayloadSchema,
	locateWorkspaceNodePayloadSchema,
	generatePlanPayloadSchema,
	submitCheckpointPayloadSchema,
	recoveryRetryPayloadSchema,
	recoveryEditInstructionPayloadSchema,
	recoveryCancelPayloadSchema,
} from "../actions/actions";

const toneSchema = z
	.enum(["neutral", "info", "success", "warning", "danger"])
	.optional();

const activityToolSchema = z.object({
	name: z.string().optional(),
	label: z.string().optional(),
	preview: z.string().optional(),
	inputSummary: z.string().optional(),
	durationMs: z.number().optional(),
	error: z.string().optional(),
	state: z.enum(["started", "progress", "completed", "failed"]),
});

const activityGroupSchema = z.object({
	kind: z.enum(["plan_generation", "execution_node", "provider_run"]),
	id: z.string(),
});

const occurrenceOptionSchema = z.object({
	value: z.string(),
	label: z.string(),
	taskId: z.string(),
	date: z.string().nullable(),
	workBlockId: z.string().nullable(),
});

const activityItemSchema = z.object({
	id: z.string(),
	kind: z.string(),
	title: z.string(),
	summary: z.string().optional(),
	tone: toneSchema,
	timestamp: z.string().nullable().optional(),
	sourceNodeTitle: z.string().optional(),
	provider: z.string().optional(),
	runtimeName: z.string().optional(),
	tool: activityToolSchema.optional(),
	activityGroup: activityGroupSchema.optional(),
	assistant: z.object({ text: z.string() }).optional(),
});

const paragraphSchema = z.object({
	text: z.string().optional(),
	content: z.string().optional(),
	variant: z.string().optional(),
});

const tableColumnSchema = z
	.object({
		key: z.string(),
		label: z.string().optional(),
		type: z.enum(["text", "number", "link"]).optional(),
		hrefKey: z.string().optional(),
	})
	.strict();

const collapsiblePresentationProps = {
	collapsible: z.boolean().optional(),
	defaultCollapsed: z.boolean().optional(),
	collapseTitle: z.string().optional(),
	collapsedSummary: z.string().optional(),
};
const simpleCollapsiblePresentationProps = {
	collapsible: z.boolean().optional(),
	defaultCollapsed: z.boolean().optional(),
	collapseTitle: z.string().optional(),
};
const sourceMetadataProps = {
	sourceNodeId: z.string().optional(),
	xChronaSourceNodeId: z.string().optional(),
};

const resultPresentationProps = {
	...collapsiblePresentationProps,
	...sourceMetadataProps,
};

const simpleResultPresentationProps = {
	...simpleCollapsiblePresentationProps,
	...sourceMetadataProps,
};

const cardComponentDefinition = {
	...shadcn.Card,
	props: shadcn.Card.props.extend({
		...simpleCollapsiblePresentationProps,
		...sourceMetadataProps,
	}),
	description: `${shadcn.Card.description} Host-rendered Chrona result cards may set defaultCollapsed to request an open or closed collapsible shell; do not emit CollapsibleBlock for ordinary cards.`,
};

const markdownPropsSchema = z.object({
	content: z.string(),
	title: z.string().optional(),
	...simpleResultPresentationProps,
});

const jsonViewPropsSchema = z.object({
	value: z.unknown(),
	title: z.string().optional(),
	...simpleResultPresentationProps,
});

const tableComponentDefinition = {
	props: z
		.object({
			title: z.string().optional(),
			description: z.string().optional(),
			uri: z.string().optional(),
			path: z.string().optional(),
			displayPath: z.string().optional(),
			columns: z.array(z.union([z.string(), tableColumnSchema])).optional(),
			pageSize: z.number().int().positive().max(100).optional(),
			contentKind: z.enum(["json", "csv", "text", "markdown"]).optional(),
			contentPreview: z.string().optional(),
			contentTruncated: z.boolean().optional(),
			contentBytes: z.number().optional(),
			previewError: z
				.enum(["unsafe_path", "not_found", "unsupported_type", "read_failed"])
				.optional(),
			...simpleResultPresentationProps,
		})
		.strict(),
	description:
		'File-backed data table. Reference a safe repo-relative JSON or CSV file with path or uri; do not inline rows. Optional columns may be strings or { key, label, type, hrefKey }. Use type: "link" or hrefKey for link cells. Prefer pageSize 10 for workspace readability; do not set pageSize equal to total rows merely to show everything. Use larger pageSize only for dense datasets or explicit user requests. Example: { path: ".chrona/outputs/N20260706-01/trending.json", columns: [{ key: "repo", label: "Repo" }, { key: "url", label: "URL", type: "link" }], pageSize: 10 }.',
	example: {
		path: ".chrona/outputs/N20260706-01/trending.json",
		columns: [
			{ key: "repo", label: "Repo" },
			{ key: "url", label: "URL", type: "link" },
		],
		pageSize: 10,
	},
};

const resultMetricSchema = z
	.object({
		label: z.string(),
		value: z.string(),
	})
	.strict();

const resultSourceProps = {
	sourceKeys: z.array(z.string()).min(1).max(64).optional(),
};

const resultOverviewComponentDefinition = {
	props: z
		.object({
			eyebrow: z.string().optional(),
			title: z.string(),
			summary: z.string(),
			metrics: z.array(resultMetricSchema).max(4).optional(),
			...resultSourceProps,
		})
		.strict(),
	description:
		"Concise outcome overview without imposing readiness, deliverable, or page-order semantics. Use when the result needs an editorial lead rather than the legacy all-in-one ResultHero.",
};

const resultReadinessComponentDefinition = {
	props: z
		.object({
			status: z.enum(["ready", "ready_with_caveats", "partial", "blocked"]),
			summary: z.string(),
			items: z.array(z.string()).max(3).optional(),
			...resultSourceProps,
		})
		.strict(),
	description:
		"Result readiness and material limitations. May appear wherever readiness matters in the chosen composition; do not use it as a generic status badge.",
};

const resultSectionComponentDefinition = {
	props: z
		.object({
			title: z.string(),
			summary: z.string().optional(),
			layout: z.enum(["stack", "grid", "split", "rail"]).optional(),
			tone: z.enum(["default", "subtle", "accent"]).optional(),
			defaultCollapsed: z.boolean().optional(),
		})
		.strict(),
	slots: ["default"],
	description:
		"Semantic result section whose children may use a stack, responsive grid, two-column split, or horizontal rail. Choose sections from the result's information architecture rather than a fixed report outline.",
};

const resultMetricItemSchema = resultMetricSchema.extend({
	detail: z.string().optional(),
	tone: z.enum(["neutral", "info", "success", "warning", "danger"]).optional(),
});

const resultMetricGridComponentDefinition = {
	props: z
		.object({
			title: z.string().optional(),
			items: z.array(resultMetricItemSchema).min(1).max(8),
			...resultSourceProps,
		})
		.strict(),
	description:
		"Compact evidence-backed metrics. Use only for exact values in the manifest; never derive or estimate counts.",
};

const resultComparisonColumnSchema = z
	.object({ key: z.string(), label: z.string() })
	.strict();
const resultComparisonRowSchema = z
	.object({
		label: z.string(),
		values: z.record(z.string(), z.string()),
		emphasis: z.enum(["recommended", "warning", "muted"]).optional(),
	})
	.strict();

const resultComparisonComponentDefinition = {
	props: z
		.object({
			title: z.string(),
			summary: z.string().optional(),
			columns: z.array(resultComparisonColumnSchema).min(1).max(6),
			rows: z.array(resultComparisonRowSchema).min(1).max(12),
			...resultSourceProps,
		})
		.strict(),
	description:
		"Inline comparison matrix for a bounded set of options. Keep cells concise; use a file-backed Table for large datasets.",
};

const resultTimelineItemSchema = z
	.object({
		label: z.string(),
		title: z.string(),
		summary: z.string().optional(),
		status: z.enum(["completed", "current", "upcoming", "blocked"]).optional(),
	})
	.strict();

const resultTimelineComponentDefinition = {
	props: z
		.object({
			title: z.string(),
			summary: z.string().optional(),
			items: z.array(resultTimelineItemSchema).min(1).max(12),
			...resultSourceProps,
		})
		.strict(),
	description:
		"Ordered milestones, events, or dated next steps. The label must be manifest-supported text such as a date, phase, or sequence marker.",
};

const resultChecklistItemSchema = z
	.object({
		label: z.string(),
		detail: z.string().optional(),
		status: z.enum(["todo", "next", "in_progress", "done", "blocked"]),
		statusLabel: z.string().optional(),
	})
	.strict();

const resultChecklistComponentDefinition = {
	props: z
		.object({
			title: z.string(),
			summary: z.string().optional(),
			items: z.array(resultChecklistItemSchema).min(1).max(12),
			...resultSourceProps,
		})
		.strict(),
	description:
		"Read-only operational checklist. It communicates recommended or completed work but never mutates task state.",
};

const resultChangeItemSchema = z
	.object({
		path: z.string(),
		summary: z.string(),
		status: z.enum(["added", "modified", "deleted", "renamed"]),
		statusLabel: z.string().optional(),
		validation: z.string().optional(),
	})
	.strict();

const resultChangeSummaryComponentDefinition = {
	props: z
		.object({
			title: z.string(),
			summary: z.string().optional(),
			items: z.array(resultChangeItemSchema).min(1).max(20),
			...resultSourceProps,
		})
		.strict(),
	description:
		"Code, configuration, or document change summary with repository-relative paths and observed validation evidence.",
};

const resultHeroComponentDefinition = {
	props: z
		.object({
			title: z.string(),
			summary: z.string(),
			readiness: z.enum(["ready", "ready_with_caveats", "partial", "blocked"]),
			readinessSummary: z.string(),
			metrics: z.array(resultMetricSchema).max(4).optional(),
			...resultSourceProps,
		})
		.strict(),
	description:
		"Primary finalized-result brief. Use exactly once as the first content block. Keep summary concise, use manifest readiness verbatim, and include at most four evidence-backed metrics.",
	example: {
		title: "Research package ready for review",
		summary:
			"The verified sources, search strategy, and maintenance guide are assembled for immediate use.",
		readiness: "ready_with_caveats",
		readinessSummary:
			"Ready to use after confirming two access-limited sources.",
		metrics: [
			{ label: "Deliverables", value: "5" },
			{ label: "Verified sources", value: "37" },
		],
	},
};

const resultDeliverableComponentDefinition = {
	props: z
		.object({
			title: z.string(),
			summary: z.string().optional(),
			artifactRef: z.string(),
			role: z.enum(["primary", "supporting", "evidence"]),
			kind: z.enum([
				"document",
				"table",
				"dataset",
				"image",
				"archive",
				"code",
				"other",
			]),
			formatLabel: z.string().optional(),
			path: z.string().optional(),
			downloadHref: z.string().optional(),
			displayPath: z.string().optional(),
			contentKind: z.enum(["markdown", "json", "text", "csv"]).optional(),
			contentPreview: z.string().optional(),
			contentTruncated: z.boolean().optional(),
			contentBytes: z.number().optional(),
			previewError: z
				.enum([
					"unsafe_path",
					"not_found",
					"unsupported_type",
					"read_failed",
					"permission_required",
				])
				.optional(),
			...resultSourceProps,
			accessTaskId: z.string().optional(),
			accessRequestedPath: z.string().optional(),
		})
		.strict(),
	description:
		"One generated deliverable with host-hydrated preview and download controls. Use exactly one primary deliverable when any current deliverable exists; render remaining current files as supporting or evidence. artifactRef must be an opaque manifest artifactRef.",
	example: {
		title: "Primary research guide",
		summary: "Complete workflow and verified source directory.",
		artifactRef: "AF111111111111",
		role: "primary",
		kind: "document",
		formatLabel: "Markdown",
	},
};

const resultInsightComponentDefinition = {
	props: z
		.object({
			title: z.string(),
			summary: z.string(),
			emphasis: z.enum(["lead", "supporting"]).optional(),
			points: z.array(z.string()).max(4).optional(),
			...resultSourceProps,
		})
		.strict(),
	description:
		"A synthesized finding or decision theme. Merge related manifest contributions; emit no more than six insights and use lead emphasis at most once.",
	example: {
		title: "Official and discovery sources serve different roles",
		summary:
			"Confirm openings on official pages while using research networks for earlier discovery.",
		emphasis: "lead",
		points: [
			"Official sources confirm",
			"Networks discover",
			"Lab updates signal early",
		],
	},
};

const resultActionPhaseSchema = z
	.object({
		timeframe: z.enum(["now", "this_week", "later"]),
		title: z.string(),
		actions: z.array(z.string()).min(1).max(5),
	})
	.strict();

const resultActionPlanComponentDefinition = {
	props: z
		.object({
			title: z.string().optional(),
			summary: z.string().optional(),
			phases: z.array(resultActionPhaseSchema).min(1).max(3),
			...resultSourceProps,
		})
		.strict(),
	description:
		"Time-ordered next-action route. Consolidate manifest nextActions into no more than three phases: now, this_week, then later. Use once.",
	example: {
		title: "Recommended route",
		phases: [
			{
				timeframe: "now",
				title: "Confirm constraints",
				actions: ["Choose target regions", "Confirm funding requirements"],
			},
			{
				timeframe: "this_week",
				title: "Configure monitoring",
				actions: ["Enable priority alerts"],
			},
		],
	},
};

const resultCaveatsComponentDefinition = {
	props: z
		.object({
			title: z.string().optional(),
			items: z.array(z.string()).min(1).max(3),
			...resultSourceProps,
		})
		.strict(),
	description:
		"Prominent acceptance caveats. Include at most three material caveats, only when supplied by the manifest. Use once and omit when there are none.",
	example: {
		title: "Before accepting",
		items: [
			"Confirm access-limited sources manually",
			"Use official pages as the final authority",
		],
	},
};

const resultEvidenceComponentDefinition = {
	props: z
		.object({
			title: z.string().optional(),
			summary: z.string().optional(),
			items: z.array(z.string()).min(1),
			...resultSourceProps,
			defaultCollapsed: z.boolean().optional(),
		})
		.strict(),
	description:
		"Secondary evidence and source-boundary list. Use once as the final block and set defaultCollapsed true.",
	example: {
		title: "Evidence and source boundaries",
		summary: "20 source records",
		items: [
			"Official sources were checked directly",
			"One directory requires manual verification",
		],
		defaultCollapsed: true,
	},
};

const collapsibleTextComponentDefinition = {
	props: z.object({ text: z.string(), threshold: z.number().optional() }),
	description:
		'Long text with a show-more collapse. threshold MUST be a JSON number such as 800, not a string such as "800".',
	example: { text: "Long output...", threshold: 800 },
};

const collapsibleBlockComponentDefinition = {
	props: z
		.object({
			title: z.string().optional(),
			summary: z.string().optional(),
			defaultCollapsed: z.boolean().optional(),
		})
		.strict(),
	slots: ["default"],
	description:
		"Component-level collapsible wrapper for an entire result block. Use for long logs, raw JSON, large file previews, secondary evidence, or diagnostics; do not wrap the primary result summary.",
	example: {
		title: "Raw details",
		summary: "Long diagnostic output",
		defaultCollapsed: true,
	},
};

const nodeResultSectionComponentDefinition = {
	props: z
		.object({
			nodeId: z.string(),
			nodeTitle: z.string(),
			status: z.string().optional(),
			defaultCollapsed: z.boolean().optional(),
			itemCount: z.number().int().nonnegative().optional(),
		})
		.strict(),
	slots: ["default"],
	description:
		"Host-generated lightweight section wrapper for output owned by one execution node. AI-authored finalized results should not emit this component.",
};

const sectionSchema = z.object({
	title: z.string().optional(),
});

const stateBindingSchema = z.object({ $bindState: z.string() });

const toolDetailLabelsSchema = z.object({
	tool: z.string(),
	input: z.string(),
	preview: z.string(),
	duration: z.string(),
	error: z.string(),
});
const filePreviewKindSchema = z.enum(["markdown", "json", "text", "csv"]);

const filePreviewErrorSchema = z.enum([
	"unsafe_path",
	"not_found",
	"unsupported_type",
	"read_failed",
	"permission_required",
]);

const fileViewPropsSchema = z.object({
	title: z.string().optional(),
	uri: z.string().optional(),
	path: z.string().optional(),
	downloadHref: z.string().optional(),
	displayPath: z.string().optional(),
	contentKind: filePreviewKindSchema.optional(),
	contentPreview: z.string().optional(),
	contentTruncated: z.boolean().optional(),
	contentBytes: z.number().optional(),
	previewError: filePreviewErrorSchema.optional(),
	accessTaskId: z.string().optional(),
	accessRequestedPath: z.string().optional(),
	description: z.string().optional(),
	language: z.string().optional(),
	...resultPresentationProps,
});

const bindableNumberSchema = z
	.union([z.number(), stateBindingSchema])
	.optional();
const bindableStringSchema = z
	.union([z.string(), stateBindingSchema])
	.optional();

const checkpointChoiceFieldPropsSchema = z.object({
	label: z.string(),
	name: z.string(),
	description: z.string().optional(),
	selection: z.enum(["single", "multiple"]),
	options: z.array(
		z.object({
			value: z.string(),
			label: z.string(),
			description: z.string().optional(),
			recommended: z.boolean().optional(),
		}),
	),
	value: z
		.union([z.string(), z.array(z.string()), stateBindingSchema])
		.optional(),
	required: z.boolean().optional(),
});

/**
 * The Chrona workspace catalog: the single trust boundary shared by document
 * producers (AI for Node result; backend builders for Node action + Activity)
 * and the web renderer (plan §4.2).
 *
 * Standard primitives reuse the prebuilt, AI-tested `@json-render/shadcn`
 * definitions (server-safe `/catalog` entry — no React here). Only domain
 * components shadcn lacks (markdown/json/file result blocks, the activity row,
 * collapsible text) are defined locally. Form inputs reuse shadcn's
 * `Input`/`Textarea`/`Select`/`Button`, which already carry `name` (state
 * binding) and `checks`/`validateOn` (validation) — so the Node-action builder
 * composes these rather than bespoke field components.
 */
export const chronaCatalog = defineCatalog(chronaSchema, {
	components: {
		// --- shadcn primitives (prebuilt definitions) ---
		Card: cardComponentDefinition,
		Stack: shadcn.Stack,
		Separator: shadcn.Separator,
		Text: shadcn.Text,
		DropdownMenu: shadcn.DropdownMenu,
		Heading: shadcn.Heading,
		Badge: shadcn.Badge,
		Alert: shadcn.Alert,
		Button: shadcn.Button,
		Link: shadcn.Link,
		Input: shadcn.Input,
		Textarea: shadcn.Textarea,
		Select: shadcn.Select,
		Checkbox: shadcn.Checkbox,
		Radio: shadcn.Radio,
		CheckpointChoiceField: {
			props: checkpointChoiceFieldPropsSchema,
			description:
				"Runtime-owned single or multiple choice field for structured checkpoint input.",
		},
		Tabs: shadcn.Tabs,
		Table: tableComponentDefinition,

		// --- lowercase compatibility aliases for AI-produced json-render specs ---
		heading: shadcn.Heading,
		paragraph: {
			props: paragraphSchema,
			description:
				"Compatibility alias for text paragraphs in AI-produced result specs.",
		},
		table: tableComponentDefinition,
		section: {
			props: sectionSchema,
			slots: ["default"],
			description:
				"Compatibility section container for AI-produced result specs.",
		},
		// --- Chrona-custom domain components ---
		WorkspaceOccurrenceCalendar: {
			props: z.object({
				label: z.string(),
				value: z.string(),
				options: z.array(occurrenceOptionSchema),
			}),
			description:
				"Compact occurrence calendar picker for recurring task workspace header.",
		},
		ResultHero: resultHeroComponentDefinition,
		ResultOverview: resultOverviewComponentDefinition,
		ResultReadiness: resultReadinessComponentDefinition,
		ResultSection: resultSectionComponentDefinition,
		ResultMetricGrid: resultMetricGridComponentDefinition,
		ResultComparison: resultComparisonComponentDefinition,
		ResultTimeline: resultTimelineComponentDefinition,
		ResultChecklist: resultChecklistComponentDefinition,
		ResultChangeSummary: resultChangeSummaryComponentDefinition,
		ResultDeliverable: resultDeliverableComponentDefinition,
		ResultInsight: resultInsightComponentDefinition,
		ResultActionPlan: resultActionPlanComponentDefinition,
		ResultCaveats: resultCaveatsComponentDefinition,
		ResultEvidence: resultEvidenceComponentDefinition,

		RichMarkdown: {
			props: markdownPropsSchema,
			description:
				"Rich Markdown result content rendered with CommonMark and GFM support.",
		},
		JsonView: {
			props: jsonViewPropsSchema,
			description: "Pretty-printed JSON result value.",
		},
		FileRef: {
			props: fileViewPropsSchema,
			description:
				"Reference to a produced file artifact, optionally hydrated with a safe server-side preview.",
		},
		FileView: {
			props: fileViewPropsSchema,
			description:
				"Produced file artifact preview hydrated server-side before browser rendering.",
		},
		ResultSummary: {
			props: z.object({
				text: z.string().optional(),
				copyText: z.string().optional(),
			}),
			description: "Result summary header with an optional copy affordance.",
		},
		ActivityRow: {
			props: z.object({
				title: z.string(),
				text: z.string().optional(),
				time: z.string().optional(),
				tone: toneSchema,
				kind: z.string().optional(),
				sourceNodeTitle: z.string().optional(),
				provider: z.string().optional(),
				runtimeName: z.string().optional(),
				toolState: z.enum(["started", "completed", "failed"]).optional(),
				density: z.enum(["compact", "detailed"]).optional(),
			}),
			slots: ["default"],
			description: "A single activity entry; optional ToolDetails child.",
		},
		ActivityStream: {
			props: z.object({
				items: z.union([z.array(activityItemSchema), stateBindingSchema]),
				liveCount: bindableNumberSchema,
				savedCount: bindableNumberSchema,
				provider: bindableStringSchema,
				emptyMessage: z.string().optional(),
				toolLabels: toolDetailLabelsSchema,
				density: z.enum(["rail"]).optional(),
				active: z.boolean().optional(),
			}),
			description: "Streaming activity feed backed by json-render state.",
		},
		ToolDetails: {
			props: z.object({
				rows: z.array(z.object({ label: z.string(), value: z.string() })),
			}),
			description: "Expandable tool invocation detail rows.",
		},
		CollapsibleText: collapsibleTextComponentDefinition,
		CollapsibleBlock: collapsibleBlockComponentDefinition,
		NodeResultSection: nodeResultSectionComponentDefinition,
		WorkspaceSummaryCard: {
			props: z.object({
				eyebrow: z.string().optional(),
				title: z.string(),
				description: z.string().optional(),
				statusLabel: z.string().optional(),
				sourceLabel: z.string().optional(),
				tone: toneSchema,
				icon: z
					.enum(["sparkles", "archive", "file", "warning", "check"])
					.optional(),
			}),
			slots: ["default"],
			description:
				"Compact Chrona workspace summary block with optional nested content.",
		},
		WorkspaceArtifactList: {
			props: z.object({
				emptyLabel: z.string(),
				maxCollapsed: z.number().optional(),
				showAllLabel: z.string().optional(),
				showFewerLabel: z.string().optional(),
			}),
			slots: ["default"],
			description:
				"Collapsible artifact index used by the task workspace command center.",
		},
		WorkspaceArtifactItem: {
			props: fileViewPropsSchema.extend({
				title: z.string(),
				type: z.string(),
				locateLabel: z.string().optional(),
			}),
			description:
				"One workspace artifact row with an optional locate action and server-hydrated preview.",
		},
		WorkspaceActionGroup: {
			props: z.object({
				label: z.string().optional(),
				layout: z.enum(["inline", "stack"]).optional(),
			}),
			slots: ["default"],
			description:
				"Compact action group used by command center checkpoint controls.",
		},
		WorkspaceActionCard: {
			props: z.object({
				title: z.string().optional(),
				tone: toneSchema,
			}),
			slots: ["default"],
			description: "Contained command center action with optional input field.",
		},
		WorkspaceDiffPreview: {
			props: z.object({
				summary: z.string(),
				confidence: z.string(),
				risks: z.array(z.string()),
				warnings: z.array(z.string()),
				taskDiffs: z.array(
					z.object({
						label: z.string(),
						key: z.string(),
						original: z.string(),
						proposed: z.string(),
					}),
				),
				planSummary: z.array(z.string()),
				addedNodes: z.array(
					z.object({
						title: z.string(),
						estimatedMinutes: z.number().optional(),
					}),
				),
				deletedNodeIds: z.array(z.string()),
			}),
			description: "Task workspace AI proposal diff preview display.",
		},
	},
	actions: {
		[UI_ACTION.commandCenterPrimary]: {
			params: commandCenterPrimaryPayloadSchema,
			description: "Run a host-owned primary command center action.",
		},
		[UI_ACTION.acceptPlan]: {
			params: acceptPlanPayloadSchema,
			description: "Accept the current generated plan.",
		},
		[UI_ACTION.generatePlan]: {
			params: generatePlanPayloadSchema,
			description: "Generate a plan for the current task.",
		},
		[UI_ACTION.dispatchExecution]: {
			params: dispatchExecutionPayloadSchema,
			description:
				"Dispatch a pre-defined execution action for the current node.",
		},
		[UI_ACTION.locateWorkspaceNode]: {
			params: locateWorkspaceNodePayloadSchema,
			description: "Select and reveal a task workspace plan node.",
		},
		[UI_ACTION.submitCheckpoint]: {
			params: submitCheckpointPayloadSchema,
			description:
				"Submit checkpoint form values (with an optional chosen action).",
		},
		[UI_ACTION.recoveryRetry]: {
			params: recoveryRetryPayloadSchema,
			description:
				"Retry the failed plan generation surfaced in the header error banner.",
		},
		[UI_ACTION.recoveryEditInstruction]: {
			params: recoveryEditInstructionPayloadSchema,
			description:
				"Open the plan regeneration instruction editor after a generation failure.",
		},
		[UI_ACTION.recoveryCancel]: {
			params: recoveryCancelPayloadSchema,
			description: "Dismiss the header error banner without retrying.",
		},
	},
});

export const chronaResultCatalog = defineCatalog(chronaSchema, {
	components: {
		Stack: shadcn.Stack,
		Card: cardComponentDefinition,
		Separator: shadcn.Separator,
		Heading: shadcn.Heading,
		Text: shadcn.Text,
		Badge: shadcn.Badge,
		Alert: shadcn.Alert,
		Table: tableComponentDefinition,
		ResultOverview: resultOverviewComponentDefinition,
		ResultReadiness: resultReadinessComponentDefinition,
		ResultSection: resultSectionComponentDefinition,
		ResultMetricGrid: resultMetricGridComponentDefinition,
		ResultComparison: resultComparisonComponentDefinition,
		ResultTimeline: resultTimelineComponentDefinition,
		ResultChecklist: resultChecklistComponentDefinition,
		ResultChangeSummary: resultChangeSummaryComponentDefinition,
		ResultHero: resultHeroComponentDefinition,
		ResultDeliverable: resultDeliverableComponentDefinition,
		ResultInsight: resultInsightComponentDefinition,
		ResultActionPlan: resultActionPlanComponentDefinition,
		ResultCaveats: resultCaveatsComponentDefinition,
		ResultEvidence: resultEvidenceComponentDefinition,
		RichMarkdown: {
			props: markdownPropsSchema,
			description:
				"Rich Markdown result content rendered with CommonMark and GFM support. Use for prose, bullets, checklists, command summaries, and compact technical reports. Use FileRef for generated files and downloads instead of Markdown links. Optional collapsible/defaultCollapsed controls collapse the whole component, not text inside it.",
			example: {
				title: "Summary",
				content: "- Completed implementation\n- Ran focused tests",
			},
		},
		JsonView: {
			props: jsonViewPropsSchema,
			description:
				"Pretty-printed JSON result value. Use only for diagnostics, API payloads, machine-readable evidence, or debugging details; prefer RichMarkdown/Table/Card for user-facing reports and summaries. Set defaultCollapsed true for large or secondary payloads.",
			example: {
				title: "Diagnostic payload",
				value: { status: "ok" },
				defaultCollapsed: true,
			},
		},
		FileRef: {
			props: z.object({
				path: z.string(),
				title: z.string().optional(),
				language: z.string().optional(),
				description: z.string().optional(),
				...simpleResultPresentationProps,
			}),
			description:
				"Reference to a produced or changed file artifact. Generated result files must use the generated:// referenceBase supplied in runtime context; explicit repository/code changes may use repo-relative paths.",
			example: {
				path: "generated://20260716/N20260716-01/report.json",
				title: "Generated report",
				language: "json",
			},
		},
		ResultSummary: {
			props: z.object({
				text: z.string().optional(),
				copyText: z.string().optional(),
			}),
			description:
				"Compact result summary header with optional copy text. Use once near the top of a finalized result.",
			example: { text: "Implementation complete; focused tests passed." },
		},
		CollapsibleText: collapsibleTextComponentDefinition,
		CollapsibleBlock: collapsibleBlockComponentDefinition,
	},
	actions: {},
});

/**
 * Model-facing description of the currently registered result design language.
 *
 * The finalizer consumes this instead of maintaining a second hand-written
 * component allow-list. Component schemas still travel through the terminal
 * tool schema; this guide explains the editorial purpose of each component.
 */
export function chronaResultComponentGuide(): Array<{
	name: string;
	description: string;
}> {
	return Object.entries(chronaResultCatalog.data.components).map(
		([name, definition]) => ({
			name,
			description:
				typeof definition.description === "string"
					? definition.description
					: "Chrona result component",
		}),
	);
}

const resultComponentEntries = Object.entries(
	chronaResultCatalog.data.components,
);

const resultComponentNames = resultComponentEntries.map(([name]) => name) as [
	string,
	...string[],
];

export const chronaResultElementSchema = z
	.object({
		type: z.enum(resultComponentNames),
		props: z.record(z.string(), z.unknown()).optional(),
		children: z.array(z.string()).optional(),
		visible: z.unknown().optional(),
	})
	.strict();

function resultElementVariantJsonSchema(
	name: string,
	component: (typeof resultComponentEntries)[number][1],
): z.core.JSONSchema.JSONSchema {
	return {
		type: "object",
		properties: {
			type: { type: "string", enum: [name] },
			props: resultComponentPropsJsonSchema(component),
			children: { type: "array", items: { type: "string" } },
			visible: {},
		},
		required: ["type", "props"],
		additionalProperties: false,
	};
}

function withoutSchemaKeyword(schema: z.core.JSONSchema.JSONSchema) {
	const { $schema: _schema, ...rest } = schema as Record<string, unknown>;
	return rest as z.core.JSONSchema.JSONSchema;
}

function resultComponentPropsJsonSchema(
	component: (typeof resultComponentEntries)[number][1],
): z.core.JSONSchema.JSONSchema {
	return withoutSchemaKeyword(
		z.toJSONSchema(component.props, {
			target: "draft-07",
			unrepresentable: "any",
		}) as z.core.JSONSchema.JSONSchema,
	);
}

export function chronaResultElementJsonSchema(): z.core.JSONSchema.JSONSchema {
	return {
		oneOf: resultComponentEntries.map(([name, component]) =>
			resultElementVariantJsonSchema(name, component),
		),
	};
}

export function chronaResultSpecJsonSchemaFromCatalog(): z.core.JSONSchema.JSONSchema {
	return {
		type: "object",
		properties: {
			root: { type: "string" },
			elements: {
				type: "object",
				additionalProperties: chronaResultElementJsonSchema(),
			},
			state: { type: "object", additionalProperties: true },
		},
		required: ["root", "elements"],
		additionalProperties: false,
	};
}

export const chronaResultSpecJsonSchema =
	chronaResultSpecJsonSchemaFromCatalog();
const chronaResultSpecBaseSchema = z
	.object({
		root: z.string(),
		elements: z.record(z.string(), chronaResultElementSchema),
		state: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

export const chronaResultSpecSchema = chronaResultSpecBaseSchema.superRefine(
	(spec, context) => {
		if (!(spec.root in spec.elements)) {
			context.addIssue({
				code: "custom",
				path: ["root"],
				message: "Root element does not exist",
			});
		}
		const definitions = chronaResultCatalog.data.components as Record<
			string,
			{ props: z.ZodObject<Record<string, z.ZodType>> }
		>;
		for (const [elementKey, element] of Object.entries(spec.elements)) {
			const parsedProps = definitions[element.type]?.props
				.partial()
				.safeParse(element.props ?? {});
			if (parsedProps && !parsedProps.success) {
				for (const issue of parsedProps.error.issues) {
					context.addIssue({
						code: "custom",
						path: ["elements", elementKey, "props", ...issue.path],
						message: issue.message,
					});
				}
			}
			for (const childKey of element.children ?? []) {
				if (!(childKey in spec.elements)) {
					context.addIssue({
						code: "custom",
						path: ["elements", elementKey, "children"],
						message: `Child element ${childKey} does not exist`,
					});
				}
			}
		}
	},
);

export type ChronaResultCatalog = typeof chronaResultCatalog;
export type ChronaResultComponentName =
	keyof typeof chronaResultCatalog.data.components;
export type ChronaCatalog = typeof chronaCatalog;
export type ChronaComponentName = keyof typeof chronaCatalog.data.components;
