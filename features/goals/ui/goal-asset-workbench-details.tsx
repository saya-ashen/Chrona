"use client";

import {
  Archive,
  Download,
  History,
  PanelRightClose,
  Sparkles,
} from "lucide-react";
import { Badge } from "@shared/ui";
import { Button } from "@shared/ui";




import { Input } from "@shared/ui";
import { Label } from "@shared/ui";


import { Separator } from "@shared/ui";


import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shared/ui";
import { Textarea } from "@shared/ui";
import {
  archiveGoalAsset,
  createGoalAssetModificationTask,
  renameGoalAsset,
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
type AssetDetailsProps = {
  goalId: string; workspaceId: string; asset: GoalAssetWorkbenchData;
  current: GoalAssetWorkbenchData["versions"][number] | undefined;
  label: string; setLabel: (label: string) => void; description: string; setDescription: (description: string) => void;
  instruction: string; setInstruction: (instruction: string) => void; pending: boolean; copy: AssetWorkbenchCopy;
  act: (action: () => Promise<unknown>, success: string) => Promise<void>;
  downloadSubmission: (asset: GoalAssetWorkbenchData, submission: GoalAssetWorkbenchData["submissions"][number]) => void;
  onCollapse?: () => void;
};

function AssetIdentityDetails({ goalId, asset, current, label, setLabel, description, setDescription, pending, copy, act }: Pick<AssetDetailsProps, "goalId" | "asset" | "current" | "label" | "setLabel" | "description" | "setDescription" | "pending" | "copy" | "act">) {
  return <section className="space-y-3"><div className="space-y-2"><Label htmlFor={`asset-title-${asset.id}`}>{copy.titleLabel}</Label><Input id={`asset-title-${asset.id}`} value={label} onChange={(event) => setLabel(event.target.value)} /></div><div className="space-y-2"><Label htmlFor={`asset-description-${asset.id}`}>{copy.descriptionLabel}</Label><Textarea id={`asset-description-${asset.id}`} value={description} maxLength={400} onChange={(event) => setDescription(event.target.value)} className="min-h-20 resize-y" /></div><Button size="sm" variant="outline" disabled={!label.trim() || (label === asset.label && description === (asset.description ?? "")) || pending} onClick={() => void act(() => renameGoalAsset(goalId, asset.id, label, description || null), copy.renamed)}>{copy.save}</Button><div className="rounded-lg border bg-background p-3 text-sm"><p className="font-medium">{copy.futureTaskImpact}</p><p className="mt-1 text-muted-foreground">{asset.drafts.length ? copy.draftVersionImpact : copy.activeVersionImpact}</p></div><dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm"><div><dt className="text-muted-foreground">{copy.type}</dt><dd>{kindLabel(asset.kind, copy)}</dd></div><div><dt className="text-muted-foreground">{copy.purpose}</dt><dd>{roleLabel(asset.role, copy)}</dd></div><div><dt className="text-muted-foreground">{copy.formalVersion}</dt><dd>v{current?.version ?? 1}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">{copy.source}</dt><dd className="break-words">{asset.sourceArtifact.title}</dd></div>{current?.originalFilename ? <div className="col-span-2"><dt className="text-muted-foreground">{copy.originalFilename}</dt><dd className="break-all">{current.originalFilename}</dd></div> : null}<div className="col-span-2 min-w-0"><dt className="text-muted-foreground">{copy.updated}</dt><dd>{new Date(asset.updatedAt).toLocaleDateString()}</dd></div></dl></section>;
}

function AssetDetailsHeader({ copy, onCollapse }: Pick<AssetDetailsProps, "copy" | "onCollapse">) {
  return <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3"><p className="font-medium">{copy.assetDetails}</p>{onCollapse ? <Button size="icon-sm" variant="ghost" aria-label={copy.collapseDetails} onClick={onCollapse}><PanelRightClose className="size-4" /></Button> : null}</div>;
}

function AssetUsageHistory({ asset, copy }: Pick<AssetDetailsProps, "asset" | "copy">) {
  return <section className="space-y-3"><h3 className="font-medium">{copy.usageHistory}</h3>{asset.usageHistory?.length ? <ul className="space-y-2 text-sm">{asset.usageHistory.map((usage) => <li key={`${usage.taskTitle}-${usage.version}-${usage.completedAt}`} className="rounded-lg border bg-background p-3"><p>{formatCopy(copy.usageHistoryEntry, { version: usage.version, task: usage.taskTitle })}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(usage.completedAt).toLocaleString()}</p></li>)}</ul> : <p className="text-sm text-muted-foreground">{copy.usageHistoryEmpty}</p>}</section>;
}

function AssetVersionsTab({ goalId, workspaceId, asset, current, pending, copy, act }: Pick<AssetDetailsProps, "goalId" | "workspaceId" | "asset" | "current" | "pending" | "copy" | "act">) {
  return <TabsContent value="versions" className="space-y-3 pt-3">{asset.versions.map((version) => <div key={version.id} className="rounded-lg border bg-background p-3"><div className="flex items-center justify-between gap-2"><span className="font-medium">v{version.version}</span><Badge variant="outline">{version.id === current?.id ? copy.currentVersion : sourceLabel(version.source, copy)}</Badge></div><p className="mt-2 text-xs text-muted-foreground">{version.changeSummary ?? copy.formalVersionFallback}</p><p className="mt-2 text-xs text-muted-foreground">{new Date(version.createdAt).toLocaleString()}</p>{version.id !== current?.id ? <Button size="sm" variant="ghost" className="mt-2" disabled={pending} onClick={() => void act(() => restoreGoalAssetVersion(goalId, asset.id, version.id, workspaceId, `Restore v${version.version}`), formatCopy(copy.recoveredVersion, { version: version.version }))}><History className="size-4" />{copy.recover}</Button> : null}</div>)}</TabsContent>;
}

function AssetSubmissionsTab({ asset, copy, downloadSubmission }: Pick<AssetDetailsProps, "asset" | "copy" | "downloadSubmission">) {
  return <TabsContent value="submissions" className="space-y-3 pt-3">{asset.submissions.length === 0 ? <p className="text-sm text-muted-foreground">{copy.noSubmissions}</p> : asset.submissions.map((submission) => <div key={submission.id} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{new Date(submission.createdAt).toLocaleString()}</p><pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(submission.content, null, 2)}</pre><Button size="sm" variant="ghost" className="mt-2" onClick={() => downloadSubmission(asset, submission)}><Download className="size-4" />{copy.downloadSubmission}</Button></div>)}</TabsContent>;
}

function AssetAiTab({ goalId, workspaceId, asset, current, instruction, setInstruction, pending, copy, act }: Pick<AssetDetailsProps, "goalId" | "workspaceId" | "asset" | "current" | "instruction" | "setInstruction" | "pending" | "copy" | "act">) {
  return <TabsContent value="ai" className="space-y-3 pt-3"><div className="rounded-lg border border-info/20 bg-info/[0.05] p-3"><div className="flex items-center gap-2 text-sm font-medium text-info"><Sparkles className="size-4" />{copy.ai}</div><p className="mt-1.5 text-xs leading-5 text-muted-foreground">{copy.aiModificationDescription}</p></div><Label htmlFor={`asset-ai-instruction-${asset.id}`}>{copy.modificationRequest}</Label><Textarea id={`asset-ai-instruction-${asset.id}`} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={copy.modificationPlaceholder} /><Button className="w-full" disabled={!instruction.trim() || !current || pending} onClick={() => current && void act(() => createGoalAssetModificationTask(goalId, asset.id, { workspaceId, versionId: current.id, instruction, expectedOutcome: formatCopy(copy.expectedModifiedOutcome, { asset: asset.label }) }), copy.versionBoundTaskCreated)}><Sparkles className="size-4" />{copy.createAiTask}</Button></TabsContent>;
}

function AssetDetailsTabs(props: AssetDetailsProps) {
  const { asset, copy } = props;
  return <Tabs defaultValue="versions"><TabsList className={`grid w-full ${asset.kind === "form" ? "grid-cols-3" : "grid-cols-2"}`}><TabsTrigger value="versions">{copy.versions}</TabsTrigger>{asset.kind === "form" ? <TabsTrigger value="submissions">{copy.submissions}</TabsTrigger> : null}<TabsTrigger value="ai">{copy.ai}</TabsTrigger></TabsList><AssetVersionsTab {...props} />{asset.kind === "form" ? <AssetSubmissionsTab {...props} /> : null}<AssetAiTab {...props} /></Tabs>;
}

function AssetLifecycleAction({ goalId, workspaceId, asset, pending, copy, act }: Pick<AssetDetailsProps, "goalId" | "workspaceId" | "asset" | "pending" | "copy" | "act">) {
  return <Button variant="outline" className="w-full justify-start" disabled={pending} onClick={() => void act(() => archiveGoalAsset(goalId, asset.id, workspaceId, asset.archivedAt ? "restore" : "archive"), asset.archivedAt ? copy.assetRestored : copy.assetArchived)}><Archive className="size-4" />{asset.archivedAt ? copy.restoreAsset : copy.archiveAsset}</Button>;
}

export function AssetDetails(props: AssetDetailsProps) {
  return <div className="flex h-full min-h-0 flex-col bg-muted/10"><AssetDetailsHeader {...props} /><div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4"><AssetIdentityDetails {...props} /><Separator /><AssetUsageHistory {...props} /><Separator /><AssetDetailsTabs {...props} /><Separator /><AssetLifecycleAction {...props} /></div></div>;
}
