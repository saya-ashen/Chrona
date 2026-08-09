"use client";

import type { PlanNodeDataModel } from "../plan/task-plan-graph/types";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@shared/ui";
import { ChevronRight } from "lucide-react";
import type { TaskWorkspaceDisplayState } from "../model/task-workspace-interaction";
import type { WorkspaceCopy } from "./task-workspace-plan-utils";
import { PlanNodeDetailMetadata } from "./task-workspace-plan-node-metadata";

function PlanNodeDetailCard({
	node,
	copy,
}: {
	node: PlanNodeDataModel | null;
	copy: WorkspaceCopy;
}) {
	if (!node) return null;
	return (
		<Card
			size="sm"
			className="gap-3 border-primary/20 bg-primary-soft/25 py-3"
			role="region"
			aria-label={copy.nodeDetailOverlayAria ?? "Selected node details"}
		>
			<CardHeader className="gap-2 px-3">
				<div className="flex min-w-0 items-start justify-between gap-2">
					<div className="min-w-0">
						<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
							{copy.nodeDetailOverlayTitle ?? "Node details"}
						</p>
						<CardTitle className="mt-1 truncate text-sm">
							{node.title}
						</CardTitle>
					</div>
					<Badge variant="outline">{node.statusLabel ?? node.status}</Badge>
				</div>
			</CardHeader>
			<CardContent className="space-y-2 px-3">
				<PlanNodeDetailMetadata node={node} copy={copy} />
			</CardContent>
		</Card>
	);
}

function SummaryList({
	title,
	items,
	empty,
}: {
	title: string;
	items: string[];
	empty: string;
}) {
	return (
		<div>
			<p className="font-semibold text-foreground">{title}</p>
			<ul className="mt-1 space-y-0.5 text-muted-foreground">
				{(items.length > 0 ? items : [empty]).map((item) => (
					<li key={item}>- {item}</li>
				))}
			</ul>
		</div>
	);
}

function PlanReviewSummaryCard({
	summary,
}: {
	summary: NonNullable<TaskWorkspaceDisplayState["planReviewSummary"]>;
}) {
	return (
		<Card
			size="sm"
			className="border-transparent bg-brand-peach/80 py-4"
			data-ui-surface-kind="product-authored"
		>
			<CardHeader className="px-4 pb-1">
				<CardTitle className="font-heading text-xl font-medium tracking-[-0.03em]">
					Plan review
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3 px-4 text-xs">
				<div className="flex flex-wrap gap-1.5">
					<Badge variant="outline" className="bg-background/75">
						{summary.stepCount} plan steps
					</Badge>
					<Badge variant="outline" className="bg-background/75">
						{summary.aiStepCount} AI steps
					</Badge>
					<Badge variant="outline" className="bg-background/75">
						{summary.checkpointCount} checkpoints
					</Badge>
					{summary.estimatedMinutes ? (
						<Badge variant="outline" className="bg-background/75">
							~{summary.estimatedMinutes} min
						</Badge>
					) : null}
				</div>
				{summary.changeSummary ? (
					<div className="rounded-2xl border border-background/70 bg-background/60 p-3">
						<p className="font-semibold text-foreground">Plan diff review</p>
						<p className="mt-1 text-foreground/70">{summary.changeSummary}</p>
					</div>
				) : null}
				<div className="grid gap-2 lg:grid-cols-3">
					<SummaryList
						title="Will produce"
						items={summary.outputIntents}
						empty="Task result"
					/>
					<SummaryList
						title="Needs you"
						items={summary.needsUser}
						empty="No planned manual stop"
					/>
					<SummaryList
						title="Potential risks"
						items={summary.risks}
						empty="No obvious risk flagged"
					/>
				</div>
			</CardContent>
		</Card>
	);
}

function StageBarCard({
	stage,
	displayMode,
	copy,
}: {
	stage: TaskWorkspaceDisplayState["stage"];
	displayMode: TaskWorkspaceDisplayState["mode"];
	copy: Pick<
		Record<string, string>,
		| "resultReadyTitle"
		| "resultReadyDescription"
		| "stageAria"
		| "stageBrief"
		| "stagePlan"
		| "stageReview"
		| "stageRun"
		| "stageResult"
	>;
}) {
	const visibleStage =
		displayMode === "reviewing_plan" ? "review" : stage.stage;
	const resultStage = visibleStage === "result";
	const statusLabel = resultStage
		? (copy.resultReadyTitle ?? stage.statusLabel)
		: stage.statusLabel;
	const nextActionLabel = resultStage
		? (copy.resultReadyDescription ?? stage.nextActionLabel)
		: stage.nextActionLabel;
	const stages: Array<{ id: typeof stage.stage; label: string }> = [
		{ id: "brief", label: copy.stageBrief ?? "Brief" },
		{ id: "plan", label: copy.stagePlan ?? "Plan" },
		{ id: "review", label: copy.stageReview ?? "Review" },
		{ id: "run", label: copy.stageRun ?? "Run" },
		{ id: "result", label: copy.stageResult ?? "Result" },
	];
	const activeIndex = stages.findIndex((item) => item.id === visibleStage);
	return (
		<div
			className="min-w-0 border-b border-border/60 bg-background px-3 pb-3 pt-3 sm:px-4"
			data-ui-surface-kind="runtime-control"
		>
			<div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
				<div className="no-scrollbar min-w-0 overflow-x-auto">
					<ol
						className="flex min-w-max items-center gap-0.5 text-xs sm:gap-1"
						aria-label={copy.stageAria ?? "Task stage"}
					>
						{stages.map((item, index) => (
							<li key={item.id} className="flex items-center gap-1">
								<span
									className={
										index === activeIndex
											? "rounded-lg bg-muted px-2.5 py-2 font-semibold text-foreground sm:px-3"
											: index < activeIndex
												? "rounded-lg px-2.5 py-2 font-medium text-foreground hover:bg-muted/70 sm:px-3"
												: "rounded-lg px-2.5 py-2 text-muted-foreground hover:bg-muted/70 hover:text-foreground sm:px-3"
									}
								>
									{item.label}
								</span>
								{index < stages.length - 1 ? (
									<ChevronRight
										className={
											index < activeIndex
												? "hidden size-3 text-primary sm:block sm:size-3.5"
												: "hidden size-3 text-muted-foreground/55 sm:block sm:size-3.5"
										}
										strokeWidth={2.25}
										aria-hidden
									/>
								) : null}
							</li>
						))}
					</ol>
				</div>
				<div className="flex min-w-0 items-center gap-2 px-1 text-xs lg:max-w-[34rem] lg:justify-end">
					<span className="shrink-0 font-semibold text-foreground">
						{statusLabel}
					</span>
					<span className="truncate text-muted-foreground">
						{nextActionLabel}
					</span>
					{stage.currentNodeLabel ? (
						<Badge
							variant="outline"
							className="hidden max-w-52 truncate bg-background xl:inline-flex"
						>
							{stage.currentNodeLabel}
						</Badge>
					) : null}
				</div>
			</div>
		</div>
	);
}

export { PlanNodeDetailCard, PlanReviewSummaryCard, StageBarCard };
