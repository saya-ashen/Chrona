"use client";

import { useState } from "react";
import {
	Archive,
	History,
	MoreHorizontal,
	PanelRightClose,
	Pencil,
	Sparkles,
} from "lucide-react";
import {
	Badge,
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@shared/ui";
import {
	archiveGoalAsset,
	restoreGoalAssetVersion,
	type GoalAssetWorkbenchData,
} from "../workbench-api";
import {
	formatCopy,
	kindLabel,
	roleLabel,
	sourceLabel,
	type AssetWorkbenchCopy,
} from "./goal-asset-workbench-shared";
import {
	AiModificationDialog,
	AssetInfoDialog,
	FreshnessDialog,
	UseTaskDialog,
} from "./goal-asset-workbench-detail-dialogs";

type AssetDetailsProps = {
	goalId: string;
	workspaceId: string;
	asset: GoalAssetWorkbenchData;
	current: GoalAssetWorkbenchData["versions"][number] | undefined;
	label: string;
	setLabel: (label: string) => void;
	description: string;
	setDescription: (description: string) => void;
	instruction: string;
	setInstruction: (instruction: string) => void;
	pending: boolean;
	copy: AssetWorkbenchCopy;
	act: (action: () => Promise<unknown>, success: string) => Promise<void>;
	downloadSubmission: (
		asset: GoalAssetWorkbenchData,
		submission: GoalAssetWorkbenchData["submissions"][number],
	) => void;
	onCollapse?: () => void;
};

function AssetDetailsHeader({
	goalId,
	workspaceId,
	asset,
	pending,
	copy,
	act,
	onCollapse,
}: Pick<
	AssetDetailsProps,
	"goalId" | "workspaceId" | "asset" | "pending" | "copy" | "act" | "onCollapse"
>) {
	return (
		<div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
			<p className="font-medium">{copy.assetDetails}</p>
			<div className="flex items-center gap-1">
				<DropdownMenu>
					<DropdownMenuTrigger
						className="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
						aria-label={copy.moreAssetActions}
					>
						<MoreHorizontal className="size-4" />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem
							disabled={pending}
							onClick={() =>
								void act(
									() =>
										archiveGoalAsset(
											goalId,
											asset.id,
											workspaceId,
											asset.archivedAt ? "restore" : "archive",
										),
									asset.archivedAt ? copy.assetRestored : copy.assetArchived,
								)
							}
						>
							<Archive className="size-4" />
							{asset.archivedAt ? copy.restoreAsset : copy.archiveAsset}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				{onCollapse ? (
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label={copy.collapseDetails}
						onClick={onCollapse}
					>
						<PanelRightClose className="size-4" />
					</Button>
				) : null}
			</div>
		</div>
	);
}

function AssetIdentitySummary({
	asset,
	current,
	copy,
	onEdit,
}: Pick<AssetDetailsProps, "asset" | "current" | "copy"> & {
	onEdit: () => void;
}) {
	return (
		<section className="space-y-4">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h3 className="break-words font-medium">{asset.label}</h3>
					<p className="mt-1 text-sm leading-5 text-muted-foreground">
						{asset.description || copy.missingAssetDescription}
					</p>
				</div>
				<Button
					size="icon-sm"
					variant="ghost"
					className="shrink-0"
					aria-label={copy.editAssetInfo}
					onClick={onEdit}
				>
					<Pencil className="size-4" />
				</Button>
			</div>
			<dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
				<div>
					<dt className="text-xs text-muted-foreground">{copy.type}</dt>
					<dd>{kindLabel(asset.kind, copy)}</dd>
				</div>
				<div>
					<dt className="text-xs text-muted-foreground">{copy.purpose}</dt>
					<dd>{roleLabel(asset.role, copy)}</dd>
				</div>
				<div>
					<dt className="text-xs text-muted-foreground">{copy.updated}</dt>
					<dd>{new Date(asset.updatedAt).toLocaleDateString()}</dd>
				</div>
				<div>
					<dt className="text-xs text-muted-foreground">
						{copy.formalVersion}
					</dt>
					<dd>v{current?.version ?? 1}</dd>
				</div>
			</dl>
		</section>
	);
}

function CurrentVersionSummary({
	asset,
	current,
	copy,
}: Pick<AssetDetailsProps, "asset" | "current" | "copy">) {
	return (
		<section className="rounded-lg border bg-background p-3">
			<div className="flex items-center justify-between gap-2">
				<h3 className="text-sm font-medium">{copy.currentVersion}</h3>
				<Badge variant="outline">v{current?.version ?? 1}</Badge>
			</div>
			<p className="mt-2 text-xs leading-5 text-muted-foreground">
				{copy.newTasksUseCurrentVersion}
				<br />
				{copy.existingTasksKeepVersion}
			</p>
			<dl className="mt-3 space-y-2 border-t pt-3 text-sm">
				<div>
					<dt className="text-xs text-muted-foreground">{copy.source}</dt>
					<dd className="break-words">{asset.sourceArtifact.title}</dd>
				</div>
				{current?.originalFilename ? (
					<div>
						<dt className="text-xs text-muted-foreground">
							{copy.originalFilename}
						</dt>
						<dd className="break-all">{current.originalFilename}</dd>
					</div>
				) : null}
			</dl>
		</section>
	);
}

function FreshnessSummary({
	asset,
	current,
	copy,
	onOpen,
}: Pick<AssetDetailsProps, "asset" | "current" | "copy"> & {
	onOpen: () => void;
}) {
	const review = asset.reviews.find((item) => item.versionId === current?.id);
	return (
		<section className="flex items-start justify-between gap-3 border-t pt-4">
			<div>
				<h3 className="text-sm font-medium">{copy.freshness}</h3>
				{review ? (
					<p className="mt-1 text-xs leading-5 text-muted-foreground">
						{copy.lastVerified}:{" "}
						{new Date(review.verifiedAt).toLocaleDateString()}
						{review.nextReviewAt
							? ` · ${copy.nextReview}: ${new Date(review.nextReviewAt).toLocaleDateString()}`
							: ""}
					</p>
				) : (
					<p className="mt-1 text-xs text-muted-foreground">{copy.noReview}</p>
				)}
			</div>
			<Button size="sm" variant="outline" className="shrink-0" onClick={onOpen}>
				{review ? copy.updateVerification : copy.recordVerification}
			</Button>
		</section>
	);
}

function OverviewTab(props: AssetDetailsProps) {
	const [editOpen, setEditOpen] = useState(false);
	const [taskOpen, setTaskOpen] = useState(false);
	const [aiOpen, setAiOpen] = useState(false);
	const [reviewOpen, setReviewOpen] = useState(false);
	const { asset, current, copy } = props;
	return (
		<TabsContent value="overview" className="m-0 space-y-4 p-4">
			<AssetIdentitySummary
				asset={asset}
				current={current}
				copy={copy}
				onEdit={() => setEditOpen(true)}
			/>
			<CurrentVersionSummary asset={asset} current={current} copy={copy} />
			<div className="grid gap-2">
				<Button variant="outline" onClick={() => setTaskOpen(true)}>
					{copy.useForTask}
				</Button>
				<Button variant="outline" onClick={() => setAiOpen(true)}>
					<Sparkles className="size-4" />
					{copy.modifyWithAi}
				</Button>
			</div>
			<FreshnessSummary
				asset={asset}
				current={current}
				copy={copy}
				onOpen={() => setReviewOpen(true)}
			/>
			<AssetInfoDialog {...props} open={editOpen} onOpenChange={setEditOpen} />
			<UseTaskDialog {...props} open={taskOpen} onOpenChange={setTaskOpen} />
			<AiModificationDialog {...props} open={aiOpen} onOpenChange={setAiOpen} />
			<FreshnessDialog
				{...props}
				open={reviewOpen}
				onOpenChange={setReviewOpen}
			/>
		</TabsContent>
	);
}

function VersionsTab({
	goalId,
	workspaceId,
	asset,
	current,
	pending,
	copy,
	act,
}: Pick<
	AssetDetailsProps,
	"goalId" | "workspaceId" | "asset" | "current" | "pending" | "copy" | "act"
>) {
	return (
		<TabsContent value="versions" className="m-0 space-y-3 p-4">
			{asset.versions.map((version) => (
				<article
					key={version.id}
					className="rounded-lg border bg-background p-3"
				>
					<div className="flex items-center justify-between gap-2">
						<span className="font-medium">v{version.version}</span>
						<Badge variant="outline">
							{version.id === current?.id
								? copy.currentVersion
								: sourceLabel(version.source, copy)}
						</Badge>
					</div>
					<p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">
						{version.changeSummary ?? copy.formalVersionFallback}
					</p>
					<p className="mt-2 text-xs text-muted-foreground">
						{new Date(version.createdAt).toLocaleString()}
					</p>
					{version.id !== current?.id ? (
						<Button
							size="sm"
							variant="ghost"
							className="mt-2"
							disabled={pending}
							onClick={() =>
								void act(
									() =>
										restoreGoalAssetVersion(
											goalId,
											asset.id,
											version.id,
											workspaceId,
											`Restore v${version.version}`,
										),
									formatCopy(copy.recoveredVersion, {
										version: version.version,
									}),
								)
							}
						>
							<History className="size-4" />
							{copy.restoreAsNewVersion}
						</Button>
					) : null}
				</article>
			))}
		</TabsContent>
	);
}

function ActivityTab({
	asset,
	copy,
}: Pick<AssetDetailsProps, "asset" | "copy">) {
	return (
		<TabsContent value="activity" className="m-0 space-y-4 p-4">
			<section className="space-y-3">
				<h3 className="text-sm font-medium">{copy.usageHistory}</h3>
				{asset.usageHistory?.length ? (
					<ul className="space-y-2 text-sm">
						{asset.usageHistory.map((usage) => (
							<li
								key={`${usage.taskTitle}-${usage.version}-${usage.completedAt}`}
								className="rounded-lg border bg-background p-3"
							>
								<p>
									{formatCopy(copy.usageHistoryEntry, {
										version: usage.version,
										task: usage.taskTitle,
									})}
								</p>
								<p className="mt-1 text-xs text-muted-foreground">
									{new Date(usage.completedAt).toLocaleString()}
								</p>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground">
						{copy.usageHistoryEmpty}
					</p>
				)}
			</section>
		</TabsContent>
	);
}

function SubmissionsTab({
	asset,
	copy,
	downloadSubmission,
}: Pick<AssetDetailsProps, "asset" | "copy" | "downloadSubmission">) {
	return (
		<TabsContent value="submissions" className="m-0 space-y-3 p-4">
			{asset.submissions.length === 0 ? (
				<p className="text-sm text-muted-foreground">{copy.noSubmissions}</p>
			) : (
				asset.submissions.map((submission) => (
					<article key={submission.id} className="rounded-lg border p-3">
						<p className="text-xs text-muted-foreground">
							{new Date(submission.createdAt).toLocaleString()}
						</p>
						<pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-xs">
							{JSON.stringify(submission.content, null, 2)}
						</pre>
						<Button
							size="sm"
							variant="ghost"
							className="mt-2"
							onClick={() => downloadSubmission(asset, submission)}
						>
							{copy.downloadSubmission}
						</Button>
					</article>
				))
			)}
		</TabsContent>
	);
}

export function AssetDetails(props: AssetDetailsProps) {
	const { asset, copy } = props;
	const tabColumns = asset.kind === "form" ? "grid-cols-4" : "grid-cols-3";
	return (
		<div className="flex h-full min-h-0 flex-col bg-muted/10">
			<AssetDetailsHeader {...props} />
			<Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
				<div className="shrink-0 border-b px-3 py-2">
					<TabsList className={`grid w-full ${tabColumns}`}>
						<TabsTrigger value="overview">{copy.overview}</TabsTrigger>
						<TabsTrigger value="versions">{copy.versions}</TabsTrigger>
						<TabsTrigger value="activity">{copy.activity}</TabsTrigger>
						{asset.kind === "form" ? (
							<TabsTrigger value="submissions">{copy.submissions}</TabsTrigger>
						) : null}
					</TabsList>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto">
					<OverviewTab {...props} />
					<VersionsTab {...props} />
					<ActivityTab asset={asset} copy={copy} />
					{asset.kind === "form" ? <SubmissionsTab {...props} /> : null}
				</div>
			</Tabs>
		</div>
	);
}
