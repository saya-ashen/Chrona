import { describe, expect, it } from "bun:test";
import type { ResultManifest } from "@chrona/contracts/ai";
import { __resultFinalizationTestHooks } from "./finalize-task-result";

const manifest: ResultManifest = {
	schemaVersion: 1,
	sourceRevision: 3,
	outcome: { title: "Complete", summary: "The report is ready." },
	readiness: { status: "ready", summary: "Ready for review." },
	deliverables: [
		{
			deliverableKey: "report",
			title: "Report",
			kind: "document",
			artifactRef: "AF111111111111",
			status: "current",
			sourceNodeRef: "N1",
			presentation: { primary: "file", allowDownload: true },
			placement: "primary",
		},
	],
	findings: [],
	decisions: [],
	caveats: [],
	nextActions: [],
	evidence: [],
};

function resultSpec(fileRef = "AF111111111111") {
	return {
		root: "root",
		elements: {
			root: {
				type: "Stack",
				props: { gap: "md" },
				children: ["summary", "file"],
			},
			summary: {
				type: "ResultSummary",
				props: { title: "Complete", summary: "The report is ready." },
			},
			file: {
				type: "ResultDeliverable",
				props: {
					artifactRef: fileRef,
					title: "Report",
					role: "primary",
					kind: "document",
					sourceKeys: ["report"],
				},
			},
		},
	};
}

describe("finalized result provider payload", () => {
	it("requires the terminal tool envelope", () => {
		expect(
			__resultFinalizationTestHooks.parsedProviderPayload({
				parsed: resultSpec(),
			}),
		).toEqual(resultSpec());
	});

	it("rejects native payloads and text fallbacks", () => {
		for (const payload of [
			resultSpec(),
			undefined,
			null,
			"ignored",
			[],
			{ parsed: undefined },
		]) {
			expect(() =>
				__resultFinalizationTestHooks.parsedProviderPayload(payload),
			).toThrow("terminal tool payload");
		}
	});
});
describe("finalized result provider request", () => {
	it("owns a stable operation identity and bounded local protocol", () => {
		const request = __resultFinalizationTestHooks.createProviderRequest({
			taskId: "task-1",
			planRunId: "plan-run-1",
			workBlockId: "work-block-1",
			executionEpoch: 7,
			sourceRevision: 3,
			attempt: 2,
			manifest,
			artifactContext: [],
		});
		expect(request.instructions).toContain("direct-answer test");
		expect(request.instructions).toContain(
			"Use ResultComparison for bounded collections",
		);
		expect(request.instructions).toContain(
			"Design bounded collection rows for user comprehension",
		);
		expect(request.instructions).toContain(
			"drop lower-value secondary metrics before explanatory",
		);
		expect(request.instructions).toContain(
			"Do not place ResultDeliverable before a structured direct answer",
		);
		expect(request.instructions).toContain(
			"Omit a next action when it asks the user or agent",
		);
		expect(request.instructions).toContain(
			"Workflow-stage variants of the same result are not distinct user capabilities",
		);
		expect(request.instructions).toContain(
			"one canonical human-readable deliverable",
		);
		expect(request).toMatchObject({
			clientOperationId:
				"result-finalization:compose:task-1:plan-run-1:work-block-1:7:3:2",
			sessionId:
				"result-finalization:compose:task-1:plan-run-1:work-block-1:7:3:2",
			sessionKey:
				"result-finalization:compose:task-1:plan-run-1:work-block-1:7:3:2",
			toolPolicy: "terminal_only",
			terminalToolName: "chrona_feature_complete",
			tools: expect.arrayContaining([
				expect.objectContaining({ name: "chrona_feature_complete" }),
			]),
			instructions: expect.stringContaining(
				"This is the only presentation phase",
			),
		});
		expect(request.input).toMatchObject({ manifest, artifactContext: [] });
		expect(JSON.stringify(request.input)).toContain(
			"never omit an available description, purpose, rationale",
		);
		const review = __resultFinalizationTestHooks.createProviderRequest({
			taskId: "task-1",
			planRunId: "plan-run-1",
			workBlockId: "work-block-1",
			executionEpoch: 7,
			sourceRevision: 3,
			attempt: 2,
			manifest,
			artifactContext: [],
			phase: "review",
			candidateSpec: resultSpec(),
		});
		expect(review.clientOperationId).toContain(":review:");
		expect(review.instructions).toContain("result composition reviewer");
		expect(
			review.instructions.includes(
				"Treat candidateSpec as structurally unacceptable and reconstruct it",
			),
		).toBe(true);
		expect(
			review.instructions.includes(
				"a bounded collection is summarized but its useful rows are not visible",
			),
		).toBe(true);
		expect(
			review.instructions.includes(
				"Preserve facts and sourceKeys, not the candidate's layout",
			),
		).toBe(true);
		expect(review.instructions).toContain(
			"Audit bounded collections field by field against artifactContext",
		);
		expect(review.instructions).toContain(
			"omit an available description, summary, purpose, rationale, status",
		);
		expect(review.instructions).toContain(
			"Audit downloads by user capability, not artifact identity or filename",
		);
		expect(review.instructions).toContain(
			"substantially overlapping copies as peer deliverables",
		);
		expect(review.input).toMatchObject({
			manifest,
			artifactContext: [],
			candidateSpec: resultSpec(),
		});
	});
});
describe("finalized result validation", () => {
	it("accepts only declared opaque Artifact refs and strips host provenance", () => {
		const spec = resultSpec() as Record<string, unknown>;
		const elements = spec.elements as Record<
			string,
			{ props: Record<string, unknown> }
		>;
		elements.file!.props.downloadHref = "/api/tasks/task-1/result-file";
		elements.file!.props.accessTaskId = "task-1";
		elements.file!.props.sourceNodeId = "node-1";
		elements.file!.props.provider = "omp";

		const validated = __resultFinalizationTestHooks.validateFinalizedSpec({
			manifest,
			payload: spec,
		});

		expect(validated.elements.file?.props).toEqual({
			artifactRef: "AF111111111111",
			title: "Report",
			role: "primary",
			kind: "document",
			sourceKeys: ["report"],
		});
	});

	it("rejects undeclared and malformed Artifact refs", () => {
		expect(() =>
			__resultFinalizationTestHooks.validateFinalizedSpec({
				manifest,
				payload: resultSpec("AF222222222222"),
			}),
		).toThrow("undeclared artifact AF222222222222");
		expect(() =>
			__resultFinalizationTestHooks.validateFinalizedSpec({
				manifest,
				payload: resultSpec("AFnot-opaque"),
			}),
		).toThrow("undeclared artifact AFnot-opaque");
		expect(() =>
			__resultFinalizationTestHooks.validateFinalizedSpec({
				manifest,
				payload: resultSpec("artifact-not-opaque"),
			}),
		).toThrow("undeclared artifact artifact-not-opaque");
	});

	it("rejects generated URIs, POSIX and Windows absolute paths, and backend IDs", () => {
		const forbidden = [
			"generated://report.md",
			"/tmp/report.md",
			"C:\\tmp\\report.md",
			"cmrz0bbj300dvf8fuo2ym3861",
		];
		for (const value of forbidden) {
			expect(() =>
				__resultFinalizationTestHooks.validateFinalizedSpec({
					manifest,
					payload: resultSpec(value),
				}),
			).toThrow("Finalized result contains a forbidden");
		}
	});

	it("rejects structurally invalid Chrona Specs", () => {
		expect(() =>
			__resultFinalizationTestHooks.validateFinalizedSpec({
				manifest,
				payload: { root: "missing", elements: {} },
			}),
		).toThrow("not a valid Chrona Spec");
	});

	it("accepts a non-template comparison composition with manifest provenance", () => {
		const payload = {
			root: "comparison",
			elements: {
				comparison: {
					type: "ResultComparison",
					props: {
						title: "Candidate comparison",
						columns: [{ key: "fit", label: "Fit" }],
						rows: [
							{
								label: "Report",
								values: { fit: "Primary" },
								emphasis: "recommended",
							},
						],
						sourceKeys: ["report"],
					},
				},
			},
		};

		expect(
			__resultFinalizationTestHooks.validateFinalizedSpec({ manifest, payload })
				.root,
		).toBe("comparison");
	});

	it("rejects unknown provenance and omission of all primary content", () => {
		expect(() =>
			__resultFinalizationTestHooks.validateFinalizedSpec({
				manifest,
				payload: {
					root: "overview",
					elements: {
						overview: {
							type: "ResultOverview",
							props: {
								title: "Complete",
								summary: "Ready",
								sourceKeys: ["unknown"],
							},
						},
					},
				},
			}),
		).toThrow("unknown source key unknown");

		expect(() =>
			__resultFinalizationTestHooks.validateFinalizedSpec({
				manifest,
				payload: {
					root: "overview",
					elements: {
						overview: {
							type: "ResultOverview",
							props: { title: "Complete", summary: "Ready" },
						},
					},
				},
			}),
		).toThrow("does not cover any primary manifest content");
	});

	it("requires visible non-ready semantics without fixing their page position", () => {
		const constrained = {
			...manifest,
			readiness: {
				status: "ready_with_caveats" as const,
				summary: "Confirm one item.",
			},
		};
		expect(() =>
			__resultFinalizationTestHooks.validateFinalizedSpec({
				manifest: constrained,
				payload: resultSpec(),
			}),
		).toThrow("omits non-ready result readiness");

		const payload = resultSpec();
		payload.elements.root.children?.push("readiness");
		Object.assign(payload.elements, {
			readiness: {
				type: "ResultReadiness",
				props: { status: "ready_with_caveats", summary: "Confirm one item." },
			},
		});
		expect(
			__resultFinalizationTestHooks.validateFinalizedSpec({
				manifest: constrained,
				payload,
			}).root,
		).toBe("root");
	});

	it("rejects fixed-template repetition and deliverable walls", () => {
		const repeatedInsights = {
			...resultSpec(),
			elements: {
				...resultSpec().elements,
				insight1: {
					type: "ResultInsight",
					props: { title: "One", summary: "One", sourceKeys: ["report"] },
				},
				insight2: {
					type: "ResultInsight",
					props: { title: "Two", summary: "Two", sourceKeys: ["report"] },
				},
				insight3: {
					type: "ResultInsight",
					props: { title: "Three", summary: "Three", sourceKeys: ["report"] },
				},
			},
		};
		repeatedInsights.elements.root.children?.push(
			"insight1",
			"insight2",
			"insight3",
		);
		expect(() =>
			__resultFinalizationTestHooks.validateFinalizedSpec({
				manifest,
				payload: repeatedInsights,
			}),
		).toThrow("too many legacy insight blocks");

		const deliverableWall = resultSpec();
		Object.assign(deliverableWall.elements, {
			file2: {
				...deliverableWall.elements.file,
				props: { ...deliverableWall.elements.file.props, role: "supporting" },
			},
			file3: {
				...deliverableWall.elements.file,
				props: { ...deliverableWall.elements.file.props, role: "supporting" },
			},
			file4: {
				...deliverableWall.elements.file,
				props: { ...deliverableWall.elements.file.props, role: "supporting" },
			},
		});
		deliverableWall.elements.root.children?.push("file2", "file3", "file4");
		expect(() =>
			__resultFinalizationTestHooks.validateFinalizedSpec({
				manifest,
				payload: deliverableWall,
			}),
		).toThrow("narrative deliverable limit");
	});
});
