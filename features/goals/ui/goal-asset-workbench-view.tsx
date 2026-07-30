"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRevalidator, useSearchParams } from "react-router-dom";
import { Sheet, SheetContent, Tabs, TabsContent } from "@shared/ui";
import type { GoalAssetKind, GoalAssetWorkbenchData, GoalInboxCandidateData } from "../workbench-api";
import type { GoalCopy } from "../model/goal-types";
import { AssetEditor } from "./goal-asset-workbench-editor";
import {
  ArchivedContent,
  AssetFilters,
  AssetLibraryContent,
  InboxContent,
  WorkbenchGuidanceCard,
  WorkbenchHeader,
  WorkbenchTabsList,
} from "./goal-asset-workbench-library";
import { formatCopy } from "./goal-asset-workbench-shared";

type WorkbenchProps = {
  goalId: string; workspaceId: string; copy: GoalCopy["assetWorkbench"];
  initialAssets: GoalAssetWorkbenchData[]; initialRecent: GoalAssetWorkbenchData[]; initialCandidates: GoalInboxCandidateData[];
};

function updateSearchParams(searchParams: URLSearchParams, setSearchParams: ReturnType<typeof useSearchParams>[1], patch: Record<string, string | null>) {
  const next = new URLSearchParams(searchParams);
  for (const [key, value] of Object.entries(patch)) { if (value !== null) next.set(key, value); else next.delete(key); }
  setSearchParams(next, { replace: true });
}

type AssetFilters = { query: string; kind: "all" | GoalAssetKind; sourceTaskId: string; state: string; sort: string };

function assetMatchesState(asset: GoalAssetWorkbenchData, state: string) {
  if (asset.archivedAt) return false;
  if (state === "active") return true;
  if (state === "draft") return asset.drafts.length > 0;
  return asset.jobs.some((job) => state === "running" ? job.status === "Queued" || job.status === "Processing" : job.status === "Failed");
}

function filteredAssets(assets: GoalAssetWorkbenchData[], filters: AssetFilters) {
  const { query, kind, sourceTaskId, state, sort } = filters;
  return assets.filter((asset) => assetMatchesState(asset, state) && (!query || asset.label.toLowerCase().includes(query.toLowerCase())) && (kind === "all" || asset.kind === kind) && (sourceTaskId === "all" || asset.sourceArtifact.taskId === sourceTaskId)).sort((left, right) => sort === "name_asc" ? left.label.localeCompare(right.label) : sort === "updated_asc" ? left.updatedAt.localeCompare(right.updatedAt) : right.updatedAt.localeCompare(left.updatedAt));
}

export function GoalAssetWorkbench({ goalId, workspaceId, copy, initialAssets, initialRecent, initialCandidates }: WorkbenchProps) {
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get("assetQuery") ?? "");
  const [state, setState] = useState(() => searchParams.get("assetState") ?? "active");
  const [sourceTaskId, setSourceTaskId] = useState(() => searchParams.get("assetSourceTask") ?? "all");
  const [kind, setKind] = useState<"all" | GoalAssetKind>(() => (searchParams.get("assetKind") as GoalAssetKind | null) ?? "all");
  const [sort, setSort] = useState(() => searchParams.get("assetSort") ?? "updated_desc");
  const sourceTasks = useMemo(() => Array.from(new Map(initialAssets.map((asset) => [asset.sourceArtifact.taskId, { id: asset.sourceArtifact.taskId, label: asset.sourceArtifact.title }])).values()), [initialAssets]);
  const selectedAssetId = searchParams.get("asset");
  const selected = initialAssets.find((asset) => asset.id === selectedAssetId) ?? null;
  const requestedView = searchParams.get("assetView");
  const assetView = requestedView === "inbox" || requestedView === "archived" ? requestedView : "library";
  const update = (patch: Record<string, string | null>) => updateSearchParams(searchParams, setSearchParams, patch);
  useEffect(() => {
    setQuery(searchParams.get("assetQuery") ?? ""); setState(searchParams.get("assetState") ?? "active"); setSourceTaskId(searchParams.get("assetSourceTask") ?? "all"); setKind((searchParams.get("assetKind") as GoalAssetKind | null) ?? "all"); setSort(searchParams.get("assetSort") ?? "updated_desc");
  }, [searchParams]);
  const activeAssets = initialAssets.filter((asset) => !asset.archivedAt);
  const draftAssets = activeAssets.filter((asset) => asset.drafts.length > 0);
  const guidance = initialCandidates.length > 0 ? { title: formatCopy(copy.inboxActionTitle, { count: initialCandidates.length }), description: copy.inboxActionDescription, action: copy.reviewInbox, view: "inbox" as const } : draftAssets.length > 0 ? { title: formatCopy(copy.draftActionTitle, { count: draftAssets.length }), description: copy.draftActionDescription, action: copy.continueEditing, assetId: draftAssets[0]!.id } : { title: copy.readyTitle, description: formatCopy(copy.readyDescription, { count: activeAssets.length }) };
  const refresh = useCallback(() => revalidator.revalidate(), [revalidator]);
  const assets = useMemo(() => filteredAssets(initialAssets, { query, kind, sourceTaskId, state, sort }), [initialAssets, query, kind, sourceTaskId, state, sort]);
  return (
    <section aria-labelledby="goal-asset-workbench" className="space-y-5">
      <WorkbenchHeader copy={copy} assetCount={initialAssets.length} />
      {assetView !== "inbox" ? <WorkbenchGuidanceCard guidance={guidance} onAction={() => update(guidance.view === "inbox" ? { assetView: "inbox", asset: null } : { assetView: null, asset: guidance.assetId ?? null })} /> : null}
      <Tabs value={assetView} onValueChange={(value) => update({ assetView: value === "library" ? null : value, assetState: null, asset: null })}>
        <WorkbenchTabsList copy={copy} candidateCount={initialCandidates.length} />
        <TabsContent value="library" className="space-y-6 pt-4"><AssetFilters copy={copy} query={query} kind={kind} sourceTaskId={sourceTaskId} state={state} sort={sort} sourceTasks={sourceTasks} onQuery={(value) => { setQuery(value); update({ assetQuery: value || null }); }} onKind={(value) => { setKind(value); update({ assetKind: value === "all" ? null : value }); }} onSourceTask={(value) => { setSourceTaskId(value); update({ assetSourceTask: value === "all" ? null : value }); }} onState={(value) => { setState(value); update({ assetState: value === "active" ? null : value }); }} onSort={(value) => { setSort(value); update({ assetSort: value === "updated_desc" ? null : value }); }} onClear={() => update({ assetKind: null, assetSourceTask: null, assetState: null, assetSort: null })} /><AssetLibraryContent assets={assets} recent={initialRecent} copy={copy} onSelectAsset={(assetId) => update({ asset: assetId })} /></TabsContent>
        <TabsContent value="inbox" className="space-y-4 pt-4"><InboxContent candidates={initialCandidates} goalId={goalId} workspaceId={workspaceId} assets={initialAssets} copy={copy} onRefresh={refresh} /></TabsContent>
        <TabsContent value="archived" className="space-y-4 pt-4"><ArchivedContent assets={initialAssets.filter((asset) => asset.archivedAt)} copy={copy} onSelectAsset={(assetId) => update({ asset: assetId })} /></TabsContent>
      </Tabs>
      <Sheet open={selected !== null} onOpenChange={(open) => { if (!open) update({ asset: null }); }}><SheetContent side="right" showCloseButton={false} className="flex w-screen! max-w-none! flex-col gap-0 overflow-hidden p-0">{selected ? <AssetEditor goalId={goalId} workspaceId={workspaceId} asset={selected} assets={assetView === "archived" ? initialAssets : activeAssets} copy={copy} onSelectAsset={(assetId) => update({ asset: assetId })} onClose={() => update({ asset: null })} onRefresh={refresh} /> : null}</SheetContent></Sheet>
    </section>
  );
}
