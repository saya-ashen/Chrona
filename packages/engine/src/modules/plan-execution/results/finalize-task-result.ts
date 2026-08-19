/* eslint-disable complexity, max-lines-per-function, max-statements, max-lines -- Result finalization keeps artifact, plan output, and canonical outcome authority atomic. */
import { z } from "zod";
import { db, type Prisma } from "@chrona/db";
import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import type {
	NodeDeliverableDeclaration,
	NodeResult,
	PlanOutputState,
	ResultManifest,
} from "@chrona/contracts/ai";
import { agentControlActionBodySchema } from "@chrona/contracts/api";
import {
	chronaResultComponentGuide,
	chronaResultSpecJsonSchema,
	validateChronaSpec,
	type UiDocument,
} from "@chrona/ui-protocol";
import {
	getAiClientForTask,
	runProviderRequest,
	buildFeatureTerminalTool,
	CHRONA_FEATURE_TERMINAL_TOOL_NAME,
	type ProviderFeatureRequest,
} from "../../ai";
import type { ProviderJsonValue } from "@chrona/providers-foundation";
import { submitNodeResultActionFromControl } from "../../agent-tools/node-result-action";
import { getPlanRun, savePlanRunGuarded } from "../persistence/plan-run-store";
import {
	schedulerWorkSignal,
	withPlanExecutionDurability,
} from "../persistence/scheduler-durability";
import { getAcceptedCompiledPlanForTask } from "../persistence/execution-scope";
import {
	aiArtifactRef,
	registerNodeDeliverables,
} from "../use-cases/register-generated-plan-output-artifacts";
import { resolveFilePreview } from "../../tasks/file-preview";
import { aggregateResultManifest } from "./result-manifest";
import { buildSemanticRefHistory } from "../runtime/node-runtime-refs";

type LoadedPlanRun = NonNullable<Awaited<ReturnType<typeof getPlanRun>>>;

const providerJsonValueSchema: z.ZodType<ProviderJsonValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(providerJsonValueSchema),
		z.record(z.string(), providerJsonValueSchema),
	]),
);
const HOST_ONLY_KEYS: Readonly<Record<string, true>> = {
	downloadHref: true,
	accessTaskId: true,
	taskId: true,
	runId: true,
	runToken: true,
	providerRequest: true,
	provider: true,
	sourceNodeId: true,
	xChronaSourceNodeId: true,
};
const ARTIFACT_REF_PATTERN = /^AF[A-F0-9]{12}$/;
const BACKEND_ID_PATTERN = /^c[a-z0-9]{20,}$/;
const FINALIZATION_ARTIFACT_PREVIEW_BYTES = 24 * 1024;

type FinalizationArtifactContext = {
	artifactRef: string;
	title: string;
	kind: string;
	contentKind?: string;
	contentPreview?: string;
	contentTruncated?: boolean;
	contentBytes?: number;
	previewError?: string;
};

async function finalizationArtifactContext(
	taskId: string,
	manifest: ResultManifest,
): Promise<FinalizationArtifactContext[]> {
	const declaredRefs = new Set([
		...manifest.deliverables
			.filter((item) => item.status === "current")
			.map((item) => item.artifactRef),
		...manifest.evidence.reduce<string[]>(
			(refs, item) => (item.artifactRef ? [...refs, item.artifactRef] : refs),
			[],
		),
	]);
	if (declaredRefs.size === 0) return [];
	const task = await db.task.findUnique({
		where: { id: taskId },
		select: {
			artifacts: {
				select: { id: true, title: true, type: true, uri: true },
			},
		},
	});
	if (!task) return [];
	const context: FinalizationArtifactContext[] = [];
	for (const artifact of task.artifacts) {
		const artifactRef = aiArtifactRef(artifact.id);
		if (!declaredRefs.has(artifactRef)) continue;
		const preview = await resolveFilePreview(artifact.uri, {
			taskId,
			maxPreviewBytes: FINALIZATION_ARTIFACT_PREVIEW_BYTES,
		});
		context.push({
			artifactRef,
			title: artifact.title,
			kind: artifact.type,
			...(preview.contentKind ? { contentKind: preview.contentKind } : {}),
			...(preview.contentPreview
				? { contentPreview: preview.contentPreview }
				: {}),
			...(preview.contentTruncated !== undefined
				? { contentTruncated: preview.contentTruncated }
				: {}),
			...(preview.contentBytes !== undefined
				? { contentBytes: preview.contentBytes }
				: {}),
			...(preview.previewError ? { previewError: preview.previewError } : {}),
		});
	}
	return context;
}

const FINALIZED_RESULT_INSTRUCTIONS = [
	"You are Chrona's restricted result finalizer.",
	"This is the only presentation phase: compose the final Chrona result UI from the immutable semantic manifest after all execution nodes have completed. The preceding nodes provide content and artifacts only.",
	"The input also includes artifactContext and designSystem. artifactContext contains bounded, safe previews of declared deliverables; use it to understand tables, JSON, Markdown, and text without inventing data or exposing file paths. designSystem is generated from the live Chrona result registry and describes the available visual language.",
	"Transform the supplied immutable ResultManifest into one concise, operational Chrona result workspace. The manifest is semantic source material, not a page outline. Do not reproduce it as a linear report or map its arrays one-to-one into sections.",
	"Do not invent facts, numbers, paths, URLs, artifact identities, task IDs, run IDs, provider data, execution status, or readiness. Every statement and metric must be directly supported by the manifest or a declared artifact preview.",
	"Copy factual strings from the manifest and artifact previews faithfully, including punctuation, spacing, repository descriptions, and field values. Do not silently rewrite or normalize source text.",
	"For time-sensitive or snapshot-based results, surface the manifest's capturedAt or obtainedAt timestamp near the outcome or result scope, not only inside a downloadable artifact preview.",
	"Return one complete validated Spec. Do not call tools, request input, emit actions, or use dynamic state bindings.",
	"Before constructing the Spec, privately identify the user's primary result question and the smallest visual surface that answers it directly. Classify the answer shape as a bounded collection, comparison or decision, dataset, document or media, code or change, timeline or process, or justified mixture. Do not emit this classification and do not turn it into a fixed template.",
	"The finalized workspace must pass the direct-answer test: unless the requested result is itself a document, media item, archive, or other file, removing every Preview, Download, supporting Artifact, and Evidence block must still leave a visible first-content region that answers the user's primary request. Artifact cards are delivery controls, not substitutes for result content.",
	"Choose one primary answer surface. Use ResultComparison for bounded collections, rankings, shortlists, or comparisons with at most 12 rows, and expose the useful item-level fields directly. Use a file-backed Table for larger structured datasets only when the artifact preview root is an array or has a top-level rows or data array. Use ResultChangeSummary for concrete code, configuration, or document changes. Use ResultTimeline for chronological results. Use ResultDeliverable as the primary answer only when the deliverable itself is what the user asked to consume, such as a document, image, archive, or media file.",
	"Design bounded collection rows for user comprehension, not maximum metric density. Preserve the smallest complete field set that lets a user identify each item, understand what it is, and use the requested ordering or comparison. When source rows provide a description, summary, purpose, rationale, scope, status, owner, or another interpretation-critical field, expose the relevant field directly; names plus numeric metrics are not a complete answer unless the user explicitly requested a numbers-only result. If component column limits require tradeoffs, drop lower-value secondary metrics before explanatory or task-defining fields. Preserve explicit missing-value markers instead of deleting a field because some rows lack it.",
	"Default composition order is: concise ResultOverview; direct answer surface; interpretation-changing readiness or caveats; primary deliverable; collapsed supporting files; collapsed evidence. A blocked result may place ResultReadiness before the answer. Any caveat that changes a recommendation or action must appear before that recommendation or action. Do not place ResultDeliverable before a structured direct answer merely because a current Artifact exists.",
	"The element graph MUST be a tree. Root children contain top-level elements only: when an element is referenced by a parent element's children, never also list it as a root child or under another parent. Every element key may occur through exactly one rendered path, and every child must resolve to one declared element.",
	"Use ResultOverview for the editorial lead in ordinary results. Legacy ResultHero is allowed only when readiness itself is the result's dominant message, not as the default first block. Keep the overview title under 96 characters and synthesize its summary from manifest.outcome rather than copying a long node summary into the title.",
	"If readiness is ready_with_caveats, partial, or blocked, render ResultReadiness as its own visible component wherever the limitation affects interpretation or action. Do not hide non-ready semantics inside a hero badge or evidence appendix, and never describe a non-ready result as unconditionally ready.",
	"Use ResultSection to create meaningful regions with stack, grid, split, or rail layout. Use density compact for short supporting sections when an outer tone or background would only repeat the child component's framing. Set ResultComparison.rowHeaderLabel to the actual semantic meaning of the first column, such as Repository, Candidate, or Dimension; use Rank only for a genuine ranking. Use ResultChecklist only for unfinished operational steps, and ResultMetricGrid only for exact manifest-supported values.",
	"Use ResultDeliverable only for current deliverables that add a distinct user capability, and set artifactRef to its opaque manifest artifactRef. At most one may have role primary and at most three deliverables may appear in the Spec. Do not render an Artifact merely because it exists in the manifest, repeat artifactRefs, or expose paths as prose. When multiple downloads appear in the Spec, make the primary deliverable clear and group secondary downloads in one concise supporting-files region.",
	"Workflow-stage variants of the same result are not distinct user capabilities. Do not expose raw, verified, summarized, or reformatted copies of substantially the same dataset as peer downloads. Choose one canonical human-readable deliverable; add at most one machine-readable version when it enables reuse, and add evidence only when the task or a material caveat makes separate audit material useful. Omit intermediate artifacts from the Spec rather than asking the user to decide which version is authoritative.",
	"Do not use ResultDeliverable as a second overview. Its title may identify the Artifact, but its description must not repeat the overview summary. Do not repeat the same title, summary, metric, or factual claim across adjacent components when one stronger component can carry it.",
	"Omit a next action when it asks the user or agent to summarize, verify, format, or produce something already completed by the current result. A visible next action must describe genuinely unfinished work, materially extend the result, and remain supported by a manifest nextAction key.",
	"Legacy ResultInsight, ResultActionPlan, ResultCaveats, ResultEvidence, and ResultHero exist for persisted result compatibility. Prefer ResultSection, ResultComparison, ResultTimeline, ResultChecklist, ResultReadiness, and CollapsibleBlock in newly finalized results. Do not emit more than two legacy ResultInsight blocks, and do not recreate the sequence Hero → Deliverables → Insights → ActionPlan → Caveats → Evidence.",
	"Use RichMarkdown, Table, JsonView, Card, Heading, Text, Badge, Alert, Separator, FileRef, ResultSummary, CollapsibleText, and CollapsibleBlock when their semantics fit. Do not wrap every item in a card and do not generate more than two consecutive isomorphic blocks when a comparison, collection, or synthesis is clearer.",
	"Every element that states, transforms, or summarizes manifest or artifact-preview content MUST set sourceKeys to the exact manifest keys it covers. Valid keys are deliverableKey values plus finding, decision, caveat, nextAction, and evidence keys. Elements containing only manifest.outcome or manifest.readiness may omit sourceKeys.",
	"Keep the first viewport useful: show what the result is, its direct answer or start of that answer, and any limitation needed to interpret it. Keep supporting observations, secondary files, and raw evidence collapsed unless the task explicitly requests audit, provenance review, or file inspection. Keep the complete Spec under 48 elements, nesting at most five levels, and avoid long prose when a comparison, checklist, timeline, metric group, Table, or Artifact preview expresses the result better.",
	"Examples of valid variation: a research list may lead with ResultOverview and a complete bounded ResultComparison before its report Artifact; a decision may lead with ResultComparison and then its caveats; a code task may lead with ResultChangeSummary and a validation checklist; a large data task may lead with exact metrics and a compatible file-backed Table; a document or media task may lead with its primary ResultDeliverable. These are examples, not templates.",
].join("\n");
const FINALIZED_RESULT_REVIEW_INSTRUCTIONS = [
	"You are Chrona's result composition reviewer.",
	"Review candidateSpec against the immutable manifest, bounded artifactContext, and live designSystem. Return one complete revised Chrona UiDocument through the terminal tool, even when only small changes are needed.",
	"Preserve a candidate's useful content-driven architecture only when it directly answers the user's primary result question. Do not replace it with a fixed report template.",
	"Treat candidateSpec as structurally unacceptable and reconstruct it when the primary answer exists only inside Preview, Download, or an Artifact card; a bounded collection is summarized but its useful rows are not visible; supporting files appear before the direct answer; Overview and Deliverable repeat the same narrative; a next action repeats completed work; Evidence or raw diagnostics are expanded without an audit requirement; readiness is prominent but the actual result is not; or the first viewport explains the result process more than the result itself.",
	"Audit bounded collections field by field against artifactContext. A collection is structurally unacceptable when rows show names and ranking or comparison metrics but omit an available description, summary, purpose, rationale, status, or other field needed to understand or use each item, unless the user explicitly requested a numbers-only result. Reconstruct it with the smallest complete field set, dropping lower-value secondary metrics before explanatory or task-defining fields, and retain explicit missing-value markers.",
	"You may reorder, regroup, omit low-value blocks, or replace component choices. Preserve facts and sourceKeys, not the candidate's layout. For non-file results, the revised Spec must pass the direct-answer test without relying on Preview, Download, supporting Artifact, or Evidence blocks.",
	"Correct repeated element references or root descendants, misleading readiness, inappropriate component choices, excessive card repetition, and violations of the tree constraint. Keep material caveats visible before any recommendation or action they affect; keep supporting files and evidence collapsed by default.",
	"Audit downloads by user capability, not artifact identity or filename. Reconstruct candidateSpec when it presents workflow-stage variants or substantially overlapping copies as peer deliverables. Keep one canonical human-readable file, optionally one machine-readable reuse format, and separate evidence only when audit value is material; omit intermediate files from the presentation.",
	"Preserve factual strings from the manifest and artifact previews exactly when they are retained; do not introduce punctuation, spacing, or wording drift.",
	"Use artifact previews only as factual source material. Never expose file paths, backend identifiers, provider data, or undeclared Artifact refs.",
	"Every transformed manifest or artifact-preview statement must retain exact sourceKeys. Keep the result under 48 elements and five nesting levels, and return only the complete revised Spec.",
].join("\n");
const finalizationInputSchema = z
	.object({
		manifest: providerJsonValueSchema,
		artifactContext: providerJsonValueSchema,
		designSystem: providerJsonValueSchema,
		candidateSpec: providerJsonValueSchema.optional(),
	})
	.strict();
const finalizationProviderPayloadSchema = z
	.object({ parsed: providerJsonValueSchema })
	.passthrough();

function finalizationProviderRequest(input: {
	planRunId: string;
	workBlockId: string | null;
	executionEpoch: number;
	taskId: string;
	sourceRevision: number;
	attempt: number;
	manifest: ResultManifest;
	artifactContext: FinalizationArtifactContext[];
	phase?: "compose" | "review";
	candidateSpec?: UiDocument;
}): ProviderFeatureRequest {
	const phase = input.phase ?? "compose";
	const clientOperationId = [
		"result-finalization",
		phase,
		input.taskId,
		input.planRunId,
		input.workBlockId ?? "task-scope",
		input.executionEpoch,
		input.sourceRevision,
		input.attempt,
	].join(":");
	const structuredOutputSchema = {
		name: "chrona_finalized_result_spec",
		description: "One complete Chrona json-render result workspace.",
		schema: z
			.record(z.string(), providerJsonValueSchema)
			.parse(chronaResultSpecJsonSchema),
	};
	return {
		clientOperationId,
		sessionId: clientOperationId,
		sessionKey: clientOperationId,
		instructions:
			phase === "review"
				? FINALIZED_RESULT_REVIEW_INSTRUCTIONS
				: FINALIZED_RESULT_INSTRUCTIONS,
		input: finalizationInputSchema.parse({
			manifest: input.manifest,
			artifactContext: input.artifactContext,
			designSystem: { components: chronaResultComponentGuide() },
			...(input.candidateSpec ? { candidateSpec: input.candidateSpec } : {}),
		}),
		structuredOutputSchema,
		tools: [buildFeatureTerminalTool(structuredOutputSchema)],
		terminalToolName: CHRONA_FEATURE_TERMINAL_TOOL_NAME,
		toolPolicy: "terminal_only",
		stream: true,
	};
}

function parsedProviderPayload(payload: unknown): ProviderJsonValue {
	const providerPayload = providerJsonValueSchema.safeParse(payload);
	const envelope = finalizationProviderPayloadSchema.safeParse(
		providerPayload.success ? providerPayload.data : undefined,
	);
	if (!envelope.success) {
		throw new Error(
			"Result finalization provider did not submit a terminal tool payload",
		);
	}
	return providerJsonValueSchema.parse(envelope.data.parsed);
}

function stripHostOnly(value: ProviderJsonValue): ProviderJsonValue {
	if (Array.isArray(value)) return value.map(stripHostOnly);
	if (!value || typeof value !== "object") return value;
	const result: Record<string, ProviderJsonValue> = {};
	for (const [key, child] of Object.entries(value)) {
		if (!(key in HOST_ONLY_KEYS)) result[key] = stripHostOnly(child);
	}
	return result;
}

function forbiddenValue(value: ProviderJsonValue): string | null {
	if (typeof value === "string") {
		if (value.startsWith("generated://")) return "generated file URI";
		if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value))
			return "absolute file path";
		if (BACKEND_ID_PATTERN.test(value)) return "backend identifier";
		return null;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			const forbidden = forbiddenValue(item);
			if (forbidden) return forbidden;
		}
		return null;
	}
	if (!value || typeof value !== "object") return null;
	for (const child of Object.values(value)) {
		const forbidden = forbiddenValue(child);
		if (forbidden) return forbidden;
	}
	return null;
}

function artifactRefs(value: ProviderJsonValue): string[] {
	const refs: string[] = [];
	const visit = (candidate: ProviderJsonValue) => {
		if (Array.isArray(candidate)) return void candidate.forEach(visit);
		if (!candidate || typeof candidate !== "object") return;
		for (const [key, child] of Object.entries(candidate)) {
			if (key === "artifactRef" && typeof child === "string") {
				refs.push(child);
			} else if (
				(key === "path" || key === "uri") &&
				typeof child === "string" &&
				child.startsWith("AF")
			) {
				refs.push(child);
			}
			visit(child);
		}
	};
	visit(value);
	return refs;
}

const MAX_FINALIZED_RESULT_ELEMENTS = 48;
const MAX_FINALIZED_RESULT_DEPTH = 5;

function manifestContentKeys(manifest: ResultManifest) {
	return new Set([
		...manifest.deliverables
			.filter((item) => item.status === "current")
			.map((item) => item.deliverableKey),
		...manifest.findings.map((item) => item.key),
		...manifest.decisions.map((item) => item.key),
		...manifest.caveats.map((item) => item.key),
		...manifest.nextActions.map((item) => item.key),
		...manifest.evidence.map((item) => item.key),
	]);
}

function validateSemanticComposition(
	manifest: ResultManifest,
	spec: UiDocument,
) {
	const entries = Object.entries(spec.elements);
	if (entries.length > MAX_FINALIZED_RESULT_ELEMENTS) {
		throw new Error(
			`Finalized result exceeds the ${MAX_FINALIZED_RESULT_ELEMENTS}-element complexity limit`,
		);
	}
	const allowedSourceKeys = manifestContentKeys(manifest);
	const referencedSourceKeys = new Set<string>();
	for (const [elementKey, element] of entries) {
		const props = element.props;
		const sourceKeys = props.sourceKeys;
		if (sourceKeys === undefined) continue;
		if (!Array.isArray(sourceKeys) || sourceKeys.length === 0) {
			throw new Error(
				`Finalized result element ${elementKey} has invalid sourceKeys`,
			);
		}
		for (const sourceKey of sourceKeys) {
			if (typeof sourceKey !== "string" || !allowedSourceKeys.has(sourceKey)) {
				throw new Error(
					`Finalized result element ${elementKey} references unknown source key ${String(sourceKey)}`,
				);
			}
			referencedSourceKeys.add(sourceKey);
		}
	}

	const visit = (elementKey: string, depth: number) => {
		if (depth > MAX_FINALIZED_RESULT_DEPTH) {
			throw new Error(
				`Finalized result exceeds the ${MAX_FINALIZED_RESULT_DEPTH}-level nesting limit`,
			);
		}
		for (const child of spec.elements[elementKey].children ?? [])
			visit(child, depth + 1);
	};
	visit(spec.root, 1);

	const primaryKeys = [
		...manifest.deliverables
			.filter(
				(item) => item.status === "current" && item.placement === "primary",
			)
			.map((item) => item.deliverableKey),
		...manifest.findings
			.filter((item) => item.importance === "primary")
			.map((item) => item.key),
		...manifest.decisions
			.filter((item) => item.importance === "primary")
			.map((item) => item.key),
		...manifest.caveats
			.filter((item) => item.importance === "primary")
			.map((item) => item.key),
		...manifest.nextActions
			.filter((item) => item.importance === "primary")
			.map((item) => item.key),
	];
	if (
		primaryKeys.length > 0 &&
		!primaryKeys.some((key) => referencedSourceKeys.has(key))
	) {
		throw new Error(
			"Finalized result does not cover any primary manifest content",
		);
	}

	const deliverables = entries.filter(
		([, element]) => element.type === "ResultDeliverable",
	);
	const primaryDeliverables = deliverables.filter(
		([, element]) => element.props.role === "primary",
	);
	if (deliverables.length > 3 || primaryDeliverables.length > 1) {
		throw new Error("Finalized result exceeds the narrative deliverable limit");
	}
	const legacyInsights = entries.filter(
		([, element]) => element.type === "ResultInsight",
	);
	if (legacyInsights.length > 2) {
		throw new Error("Finalized result repeats too many legacy insight blocks");
	}

	if (manifest.readiness.status !== "ready") {
		const readinessVisible = entries.some(
			([, element]) =>
				element.type === "ResultReadiness" ||
				element.type === "ResultCaveats" ||
				element.type === "Alert",
		);
		if (!readinessVisible) {
			throw new Error("Finalized result omits non-ready result readiness");
		}
	}
}

function validateFinalizedResultSpec(input: {
	manifest: ResultManifest;
	payload: unknown;
}): UiDocument {
	const payload = providerJsonValueSchema.parse(input.payload);
	const stripped = stripHostOnly(payload);
	const forbidden = forbiddenValue(stripped);
	if (forbidden) {
		throw new Error(`Finalized result contains a forbidden ${forbidden}`);
	}
	const allowed = new Set(
		input.manifest.deliverables.map((item) => item.artifactRef),
	);
	for (const ref of artifactRefs(stripped)) {
		if (!ARTIFACT_REF_PATTERN.test(ref) || !allowed.has(ref as never)) {
			throw new Error(`Finalized result references undeclared artifact ${ref}`);
		}
	}
	const validation = validateChronaSpec(stripped);
	if (!validation.ok) {
		throw new Error(
			`Finalized result is not a valid Chrona Spec: ${validation.issues
				.map((issue) => `${issue.path}: ${issue.message}`)
				.join("; ")}`,
		);
	}
	validateSemanticComposition(
		input.manifest,
		validation.spec as unknown as UiDocument,
	);
	return validation.spec as unknown as UiDocument;
}

async function restoreRecordedTerminalResults(
	input: {
		taskId: string;
		accepted: NonNullable<
			Awaited<ReturnType<typeof getAcceptedCompiledPlanForTask>>
		>;
		persisted: LoadedPlanRun;
	},
	suppliedTx?: Prisma.TransactionClient,
): Promise<LoadedPlanRun> {
	if (!suppliedTx) {
		return withPlanExecutionDurability((tx) =>
			restoreRecordedTerminalResults(input, tx),
		);
	}
	const tx = suppliedTx;
	const persistedGraph = input.persisted.graph;
	if (!persistedGraph)
		throw new Error("No persisted execution graph is available");
	const actions = await tx.taskPlanTerminalAction.findMany({
		where: {
			taskId: input.taskId,
			kind: "complete",
			nodeAttemptId: { not: null },
			nodeAttempt: { planRunId: input.persisted.id },
		},
		orderBy: { recordedAt: "asc" },
	});
	const semanticRefs = buildSemanticRefHistory(
		resolveEffectivePlanGraph({
			graph: persistedGraph,
			attempts: input.persisted.attempts,
			results: input.persisted.results,
		}),
	);
	if (actions.length === 0) return input.persisted;

	const byAttempt = new Map(
		actions.map((action) => [action.nodeAttemptId!, action]),
	);
	let changed = false;
	const results: NodeResult[] = [];
	for (const result of input.persisted.results) {
		const action = result.attemptId
			? byAttempt.get(result.attemptId)
			: undefined;
		if (!action || result.status !== "current") {
			results.push(result);
			continue;
		}
		const parsedWithSession = submitNodeResultActionFromControl({
			body: agentControlActionBodySchema.parse({
				kind: action.kind,
				payload: action.payload,
			}),
			sessionId: action.taskSessionId ?? undefined,
		});
		const parsed = parsedWithSession
			? (({ sessionId: _sessionId, ...action }) => action)(parsedWithSession)
			: null;
		if (parsed?.action !== "complete_manual_node") {
			results.push(result);
			continue;
		}
		const sourceNodeId = result.nodeId ?? action.nodeId ?? "unknown-node";
		const sourceNodeRef = semanticRefs.nodeRefs.find(
			(binding) =>
				binding.nodeId === sourceNodeId || binding.backendId === sourceNodeId,
		)?.ref;
		const deliverables = parsed.deliverables?.length
			? await registerNodeDeliverables(
					{
						workspaceId: input.accepted.workspaceId,
						taskId: input.taskId,
						taskSessionId: action.taskSessionId,
						workBlockId: input.accepted.workBlockId,
						runId: action.runId,
						sourceNodeId,
						sourceNodeRef,
						declarations: parsed.deliverables as NodeDeliverableDeclaration[],
					},
					tx,
				)
			: result.deliverables;
		const restored: NodeResult = {
			...result,
			outputSummary: parsed.summary ?? result.outputSummary,
			deliverables,
			findings: parsed.findings,
			decisions: parsed.decisions,
			caveats: parsed.caveats,
			nextActions: parsed.nextActions,
			resultEvidence: parsed.evidenceItems?.map((item) => ({
				...item,
				sourceNodeRef: sourceNodeRef ?? "",
			})),
		};
		if (JSON.stringify(restored) !== JSON.stringify(result)) changed = true;
		results.push(restored);
	}
	if (!changed) return input.persisted;

	const manifest = aggregateResultManifest({
		results,
		previous: input.persisted.planOutput.manifest,
		sourceNodeRef: (nodeId) =>
			semanticRefs.nodeRefs.find(
				(binding) => binding.nodeId === nodeId || binding.backendId === nodeId,
			)?.ref ?? nodeId,
	});
	const planOutput: PlanOutputState = {
		...input.persisted.planOutput,
		manifest,
		finalizedResult: null,
		finalization: {
			status: "Pending",
			sourceRevision: manifest.sourceRevision,
		},
		revision: input.persisted.planOutput.revision + 1,
		updatedAt: new Date().toISOString(),
		updatedByNodeId: null,
	};
	const saved = await savePlanRunGuarded(
		{
			workspaceId: input.accepted.workspaceId,
			taskId: input.taskId,
			planId: input.accepted.compiledPlan.editablePlanId,
			workBlockId: input.accepted.workBlockId,
			expectedEpoch: input.persisted.executionEpoch,
			run: input.persisted.planRun,
			compiledPlan: input.accepted.compiledPlan,
			graph: persistedGraph,
			attempts: input.persisted.attempts,
			results,
			executionContextSnapshots: input.persisted.executionContextSnapshots,
			planOutput,
		},
		tx,
	);
	if (!saved.committed)
		throw new Error("Recorded terminal results changed concurrently");
	return (await getPlanRun(
		input.taskId,
		input.accepted.compiledPlan.editablePlanId,
		input.accepted.workBlockId,
		tx,
	))!;
}
export const __resultFinalizationTestHooks = {
	parsedProviderPayload,
	validateFinalizedSpec: validateFinalizedResultSpec,
	restoreRecordedTerminalResults,
	validateSemanticComposition,
	createProviderRequest: finalizationProviderRequest,
};

export async function finalizeTaskResult(input: {
	taskId: string;
	workBlockId?: string | null;
	force?: boolean;
}): Promise<PlanOutputState> {
	const accepted = await getAcceptedCompiledPlanForTask(input.taskId, {
		workBlockId: input.workBlockId,
	});
	if (!accepted)
		throw new Error("No accepted plan is available for result finalization");
	const initial = await getPlanRun(
		input.taskId,
		accepted.compiledPlan.editablePlanId,
		accepted.workBlockId,
	);
	if (!initial?.graph)
		throw new Error("No persisted execution graph is available");
	const persisted = await restoreRecordedTerminalResults({
		taskId: input.taskId,
		accepted,
		persisted: initial,
	});
	if (!persisted.graph)
		throw new Error(
			"No persisted execution graph is available after result restoration",
		);
	const sourceRevision = persisted.planOutput.manifest.sourceRevision;
	if (
		persisted.planOutput.finalization.status === "Ready" &&
		persisted.planOutput.finalizedResult?.sourceRevision === sourceRevision &&
		!input.force
	)
		return persisted.planOutput;
	const attempt =
		"attempt" in persisted.planOutput.finalization
			? persisted.planOutput.finalization.attempt + 1
			: 1;
	const running: PlanOutputState = {
		...persisted.planOutput,
		finalization: {
			status: "Running",
			sourceRevision,
			attempt,
			startedAt: new Date().toISOString(),
		},
	};
	const runningSave = await savePlanRunGuarded({
		workspaceId: accepted.workspaceId,
		taskId: input.taskId,
		planId: accepted.compiledPlan.editablePlanId,
		workBlockId: accepted.workBlockId,
		expectedEpoch: persisted.executionEpoch,
		run: persisted.planRun,
		compiledPlan: accepted.compiledPlan,
		graph: persisted.graph!,
		attempts: persisted.attempts,
		results: persisted.results,
		executionContextSnapshots: persisted.executionContextSnapshots,
		planOutput: running,
	});
	if (!runningSave.committed)
		throw new Error("Result finalization changed concurrently");
	const claimedExecutionEpoch = persisted.executionEpoch + 1;

	try {
		const client = await getAiClientForTask({
			taskId: input.taskId,
			purpose: "task.result_finalization",
		});
		if (!client?.providerClient) {
			throw new Error("No AI client is configured for result finalization");
		}
		let artifactContext: FinalizationArtifactContext[] = [];
		try {
			artifactContext = await finalizationArtifactContext(
				input.taskId,
				running.manifest,
			);
		} catch {
			// Artifact previews enrich composition but never block finalization.
			artifactContext = [];
		}
		const response = await runProviderRequest(client.providerClient, {
			...finalizationProviderRequest({
				taskId: input.taskId,
				planRunId: persisted.id,
				workBlockId: accepted.workBlockId,
				executionEpoch: claimedExecutionEpoch,
				sourceRevision,
				attempt,
				manifest: running.manifest,
				artifactContext,
			}),
			signal: schedulerWorkSignal(),
		});
		if (response.error || response.status !== "completed") {
			throw new Error(
				response.error ??
					`Result finalization provider ended with status ${response.status}`,
			);
		}
		const composedSpec = validateFinalizedResultSpec({
			manifest: running.manifest,
			payload: parsedProviderPayload(response.structuredPayload),
		});
		let spec = composedSpec;
		try {
			const reviewResponse = await runProviderRequest(client.providerClient, {
				...finalizationProviderRequest({
					taskId: input.taskId,
					planRunId: persisted.id,
					workBlockId: accepted.workBlockId,
					executionEpoch: claimedExecutionEpoch,
					sourceRevision,
					attempt,
					manifest: running.manifest,
					artifactContext,
					phase: "review",
					candidateSpec: composedSpec,
				}),
				signal: schedulerWorkSignal(),
			});
			if (!reviewResponse.error && reviewResponse.status === "completed") {
				spec = validateFinalizedResultSpec({
					manifest: running.manifest,
					payload: parsedProviderPayload(reviewResponse.structuredPayload),
				});
			}
		} catch {
			// Composition review is an editorial enhancement. A valid composed Spec
			// remains authoritative when the reviewer is unavailable or invalid.
			spec = composedSpec;
		}
		const latest = await getPlanRun(
			input.taskId,
			accepted.compiledPlan.editablePlanId,
			accepted.workBlockId,
		);
		const finalization = latest?.planOutput.finalization;
		if (
			!latest?.graph ||
			latest.executionEpoch !== claimedExecutionEpoch ||
			latest.planOutput.manifest.sourceRevision !== sourceRevision ||
			finalization?.status !== "Running" ||
			finalization.sourceRevision !== sourceRevision ||
			finalization.attempt !== attempt
		) {
			throw new Error(
				"Result finalization changed while the provider was running",
			);
		}
		const finalizedAt = new Date().toISOString();
		const ready: PlanOutputState = {
			...latest.planOutput,
			finalizedResult: {
				sourceRevision,
				manifest: latest.planOutput.manifest,
				spec,
				finalizedAt,
			},
			finalization: { status: "Ready", sourceRevision, attempt, finalizedAt },
		};
		const saved = await savePlanRunGuarded({
			workspaceId: accepted.workspaceId,
			taskId: input.taskId,
			planId: accepted.compiledPlan.editablePlanId,
			workBlockId: accepted.workBlockId,
			expectedEpoch: claimedExecutionEpoch,
			run: latest.planRun,
			compiledPlan: accepted.compiledPlan,
			graph: latest.graph,
			attempts: latest.attempts,
			results: latest.results,
			executionContextSnapshots: latest.executionContextSnapshots,
			planOutput: ready,
		});
		if (!saved.committed)
			throw new Error("Result finalization changed concurrently");
		return ready;
	} catch (error) {
		let latest = await getPlanRun(
			input.taskId,
			accepted.compiledPlan.editablePlanId,
			accepted.workBlockId,
		);
		let failureRecorded = false;
		for (let retry = 0; retry < 2; retry += 1) {
			if (
				!latest?.graph ||
				latest.executionEpoch !== claimedExecutionEpoch ||
				latest.planOutput.manifest.sourceRevision !== sourceRevision
			) {
				failureRecorded = true;
				break;
			}
			const finalization = latest.planOutput.finalization;
			if (
				(finalization.status === "Ready" || finalization.status === "Failed") &&
				finalization.sourceRevision === sourceRevision
			) {
				failureRecorded = true;
				break;
			}
			if (
				finalization.status !== "Running" ||
				finalization.sourceRevision !== sourceRevision ||
				finalization.attempt !== attempt
			) {
				failureRecorded = true;
				break;
			}
			const failedAt = new Date().toISOString();
			const failureOutput: PlanOutputState = latest.planOutput.finalizedResult
				? {
						...latest.planOutput,
						finalization: {
							status: "Ready",
							sourceRevision,
							attempt,
							finalizedAt: latest.planOutput.finalizedResult.finalizedAt,
						},
					}
				: {
						...latest.planOutput,
						finalizedResult: null,
						finalization: {
							status: "Failed",
							sourceRevision,
							attempt,
							failedAt,
							errorCode: "RESULT_FINALIZATION_FAILED",
							errorMessage: "Result finalization failed",
						},
					};
			const failedSave = await savePlanRunGuarded({
				workspaceId: accepted.workspaceId,
				taskId: input.taskId,
				planId: accepted.compiledPlan.editablePlanId,
				workBlockId: accepted.workBlockId,
				expectedEpoch: latest.executionEpoch,
				run: latest.planRun,
				compiledPlan: accepted.compiledPlan,
				graph: latest.graph,
				attempts: latest.attempts,
				results: latest.results,
				executionContextSnapshots: latest.executionContextSnapshots,
				planOutput: failureOutput,
			});
			if (failedSave.committed) {
				failureRecorded = true;
				break;
			}
			latest = await getPlanRun(
				input.taskId,
				accepted.compiledPlan.editablePlanId,
				accepted.workBlockId,
			);
		}
		if (!failureRecorded) {
			throw new Error("Result finalization failure changed concurrently", {
				cause: error,
			});
		}
		throw error;
	}
}
