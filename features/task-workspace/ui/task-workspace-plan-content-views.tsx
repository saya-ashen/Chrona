import { GitBranch, ListChecks, Minimize2 } from "lucide-react";
import type { TaskPlanGraphPlan } from "../plan/task-plan-graph/types";
import { Badge, Button } from "@shared/ui";
import { TaskPlanGraphPanel } from "../panels/task-plan-graph-panel";
import type { PlanContentCopy } from "./task-workspace-plan-brief";

type GraphMode = "full" | "compact";
type SelectedNodeChange = Parameters<
	typeof TaskPlanGraphPanel
>[0]["onSelectedNodeChange"];

type SharedPlanGraphProps = {
	copy: PlanContentCopy;
	graphPlan: TaskPlanGraphPlan;
	label: string;
	onSelectedNodeChange?: SelectedNodeChange;
	planSummary: string | null;
};

type PlanContentBodyProps = SharedPlanGraphProps & {
	graphMode: GraphMode;
	onGraphModeChange: (mode: GraphMode) => void;
	reviewing: boolean;
	usesPlanWorkbench: boolean;
	view: "steps" | "flow";
	onViewChange: (view: "steps" | "flow") => void;
};

function isHumanPauseNode(node: TaskPlanGraphPlan["nodes"][number]): boolean {
	const nodeType = node.type ?? node.kind ?? "task";
	return Boolean(
		node.requiresHumanInput ||
			node.checkpoint ||
			["checkpoint", "condition", "wait", "user_input"].includes(nodeType),
	);
}

function GraphModeControls({
	copy,
	graphMode,
	onGraphModeChange,
}: Pick<PlanContentBodyProps, "copy" | "graphMode" | "onGraphModeChange">) {
	return (
		<div
			className="flex w-full flex-wrap items-stretch gap-1 sm:w-auto sm:justify-end"
			role="group"
			aria-label={copy.graphModeLabel}
		>
			<Button
				type="button"
				variant={graphMode === "full" ? "default" : "ghost"}
				size="sm"
				className="h-auto min-w-0 flex-1 items-start justify-start rounded-xl px-3 py-2 text-left text-xs sm:flex-none"
				onClick={() => onGraphModeChange("full")}
				aria-pressed={graphMode === "full"}
				title={copy.graphFullHint}
			>
				<GitBranch className="mt-0.5 size-3.5 shrink-0" />
				<span className="flex min-w-0 flex-col items-start leading-tight">
					<span className="truncate">{copy.graphFullMode}</span>
					<span className="hidden text-[10px] font-normal opacity-75 md:inline">
						{copy.graphFullHint}
					</span>
				</span>
			</Button>
			<Button
				type="button"
				variant={graphMode === "compact" ? "default" : "ghost"}
				size="sm"
				className="h-auto min-w-0 flex-1 items-start justify-start rounded-xl px-3 py-2 text-left text-xs sm:flex-none"
				onClick={() => onGraphModeChange("compact")}
				aria-pressed={graphMode === "compact"}
				title={copy.graphCompactHint}
			>
				<Minimize2 className="mt-0.5 size-3.5 shrink-0" />
				<span className="flex min-w-0 flex-col items-start leading-tight">
					<span className="truncate">{copy.graphCompactMode}</span>
					<span className="hidden text-[10px] font-normal opacity-75 md:inline">
						{copy.graphCompactHint}
					</span>
				</span>
			</Button>
		</div>
	);
}

function PlanStep({
	copy,
	index,
	node,
	nodes,
	onSelectedNodeChange,
	reviewing,
}: SharedPlanGraphProps & {
	index: number;
	node: TaskPlanGraphPlan["nodes"][number];
	nodes: TaskPlanGraphPlan["nodes"];
	reviewing: boolean;
}) {
	const needsUser = isHumanPauseNode(node);
	const dependencyCount = node.dependencies?.length ?? 0;
	return (
		<li>
			<button
				type="button"
				className="flex w-full gap-3 rounded-xl border border-border/65 bg-background px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
				onClick={() => onSelectedNodeChange?.(node, nodes)}
			>
				<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
					{index + 1}
				</span>
				<span className="min-w-0 flex-1">
					<span className="flex flex-wrap items-center gap-2">
						<span className="font-medium text-foreground">{node.title}</span>
						{needsUser ? (
							<Badge variant="secondary">
								{reviewing
									? (copy.planNeedsReview ?? "Needs review")
									: (copy.planHumanPause ?? "Human pause")}
							</Badge>
						) : null}
					</span>
					{node.objective ? (
						<span className="mt-1 block text-sm leading-5 text-muted-foreground">
							{node.objective}
						</span>
					) : null}
					<span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
						{node.estimatedMinutes ? (
							<span>About {node.estimatedMinutes} min</span>
						) : null}
						{dependencyCount > 0 ? (
							<span>
								After {dependencyCount} step{dependencyCount === 1 ? "" : "s"}
							</span>
						) : (
							<span>No dependencies</span>
						)}
					</span>
				</span>
			</button>
		</li>
	);
}

function PlanStepsView({
	copy,
	graphPlan,
	onSelectedNodeChange,
	reviewing,
}: Pick<
	PlanContentBodyProps,
	"copy" | "graphPlan" | "onSelectedNodeChange" | "reviewing"
>) {
	return (
		<div
			className="min-h-0 flex-1 overflow-y-auto p-3"
			aria-label={copy.planSteps ?? "Execution steps"}
		>
			<ol className="space-y-2">
				{graphPlan.nodes.map((node, index) => (
					<PlanStep
						key={node.id}
						copy={copy}
						graphPlan={graphPlan}
						label=""
						planSummary={null}
						index={index}
						node={node}
						nodes={graphPlan.nodes}
						onSelectedNodeChange={onSelectedNodeChange}
						reviewing={reviewing}
					/>
				))}
			</ol>
		</div>
	);
}

function PlanWorkbench({
	copy,
	graphPlan,
	label,
	onSelectedNodeChange,
	onViewChange,
	planSummary,
	reviewing,
	view,
}: Pick<
	PlanContentBodyProps,
	| "copy"
	| "graphPlan"
	| "label"
	| "onSelectedNodeChange"
	| "onViewChange"
	| "planSummary"
	| "reviewing"
	| "view"
>) {
	const count = graphPlan.nodes.length;
	return (
		<>
			<div className="flex items-center justify-between gap-3 border-b border-border/55 bg-muted/20 px-3 py-2.5">
				<div
					className="flex gap-1"
					role="group"
					aria-label={
						reviewing
							? (copy.planReviewViewAria ?? "Plan review view")
							: (copy.acceptedPlanViewAria ?? "Accepted plan view")
					}
				>
					<Button
						type="button"
						size="sm"
						variant={view === "steps" ? "default" : "ghost"}
						onClick={() => onViewChange("steps")}
						aria-pressed={view === "steps"}
					>
						<ListChecks className="size-4" />
						{copy.planStepsView ?? "Steps"}
					</Button>
					<Button
						type="button"
						size="sm"
						variant={view === "flow" ? "default" : "ghost"}
						onClick={() => onViewChange("flow")}
						aria-pressed={view === "flow"}
					>
						<GitBranch className="size-4" />
						{copy.planFlowView ?? "Flow"}
					</Button>
				</div>
				<p className="hidden text-xs text-muted-foreground md:block">
					{view === "steps"
						? `${count} step${count === 1 ? "" : "s"} in execution order`
						: (copy.planFlowHint ?? "Inspect dependencies and branches")}
				</p>
			</div>
			{view === "steps" ? (
				<PlanStepsView
					copy={copy}
					graphPlan={graphPlan}
					onSelectedNodeChange={onSelectedNodeChange}
					reviewing={reviewing}
				/>
			) : (
				<div
					className="min-h-0 flex-1 p-2"
					role="region"
					aria-label="Execution graph"
				>
					<TaskPlanGraphPanel
						label={label}
						plan={graphPlan}
						mode="full"
						summary={planSummary}
						className="min-h-[520px] min-w-0 w-full"
						showOverview
						onSelectedNodeChange={onSelectedNodeChange}
					/>
				</div>
			)}
		</>
	);
}

function requiresGraphLayout(graphPlan: TaskPlanGraphPlan): boolean {
	return (
		graphPlan.nodes.length > 3 ||
		graphPlan.nodes.some(
			(node) => isHumanPauseNode(node) || (node.dependencies?.length ?? 0) > 1,
		)
	);
}

function StandardPlanGraph({
	copy,
	graphMode,
	graphPlan,
	label,
	onGraphModeChange,
	onSelectedNodeChange,
	planSummary,
}: Pick<
	PlanContentBodyProps,
	| "copy"
	| "graphMode"
	| "graphPlan"
	| "label"
	| "onGraphModeChange"
	| "onSelectedNodeChange"
	| "planSummary"
>) {
	const required = requiresGraphLayout(graphPlan);
	const graphClass =
		graphMode === "compact"
			? "min-h-0 min-w-0 w-full flex-1"
			: "min-h-[28rem] min-w-0 w-full md:min-h-[36rem]";
	return (
		<>
			<div className="flex min-w-0 flex-col gap-2 border-b border-border/55 bg-muted/35 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0">
					<p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
						{label}
					</p>
					{planSummary ? (
						<p className="mt-0.5 truncate text-xs text-muted-foreground">
							{planSummary}
						</p>
					) : null}
				</div>
				<div className={required ? "" : "opacity-70"}>
					<GraphModeControls
						copy={copy}
						graphMode={graphMode}
						onGraphModeChange={onGraphModeChange}
					/>
				</div>
			</div>
			<div
				className={
					required
						? "min-h-[30rem] flex-1 p-2"
						: "min-h-[30rem] flex-1 border-t border-border/40 bg-muted/15 p-2 opacity-75"
				}
				aria-label={
					required ? "Execution graph" : "Execution graph diagnostics"
				}
				role="region"
			>
				<TaskPlanGraphPanel
					label={label}
					plan={graphPlan}
					mode={graphMode}
					summary={planSummary}
					className={graphClass}
					fillHeight
					showOverview={graphMode === "full"}
					onSelectedNodeChange={onSelectedNodeChange}
				/>
			</div>
		</>
	);
}

export function PlanContentBody(props: PlanContentBodyProps) {
	return props.usesPlanWorkbench ? (
		<PlanWorkbench {...props} />
	) : (
		<StandardPlanGraph {...props} />
	);
}
