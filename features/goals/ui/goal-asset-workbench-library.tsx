"use client";

import {
  Archive,
  ChevronDown,
  FileText,
  Inbox,
  Search,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import { Badge } from "@shared/ui";
import { Button } from "@shared/ui";
import { Input } from "@shared/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/ui";
import { TabsList, TabsTrigger } from "@shared/ui";
import type {
  GoalAssetKind,
  GoalAssetWorkbenchData,
  GoalInboxCandidateData,
} from "../workbench-api";
import { formatCopy, type AssetWorkbenchCopy } from "./goal-asset-workbench-shared";
import { AssetTile, kindLabel } from "./goal-asset-workbench-shared";
import { InboxCandidate } from "./goal-asset-workbench-candidates";

type SelectAsset = (assetId: string) => void;
type SourceTask = { id: string; label: string };

export function WorkbenchHeader({
  copy,
  assetCount,
}: {
  copy: AssetWorkbenchCopy;
  assetCount: number;
}) {
  return (
    <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h2 id="goal-asset-workbench" className="text-2xl font-semibold tracking-tight">
          {copy.title}
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          {copy.description}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">{assetCount} {copy.assetCount}</p>
    </div>
  );
}

type WorkbenchGuidance = {
  title: string;
  description: string;
  action?: string;
  view?: "inbox";
  assetId?: string;
};

export function WorkbenchGuidanceCard({
  guidance,
  onAction,
}: {
  guidance: WorkbenchGuidance;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <p className="font-semibold">{guidance.title}</p>
        <p className="max-w-3xl text-sm leading-5 text-muted-foreground">
          {guidance.description}
        </p>
      </div>
      {guidance.action ? <Button onClick={onAction}>{guidance.action}</Button> : null}
    </div>
  );
}

export function WorkbenchTabsList({
  copy,
  candidateCount,
}: {
  copy: AssetWorkbenchCopy;
  candidateCount: number;
}) {
  return (
    <TabsList className="bg-muted/60">
      <TabsTrigger value="library"><FileText className="size-4" />{copy.library}</TabsTrigger>
      <TabsTrigger value="inbox" className={candidateCount ? "text-warning data-[state=active]:text-warning" : ""}>
        <Inbox className="size-4" />{copy.inbox}
        <Badge variant={candidateCount ? "destructive" : "secondary"}>{candidateCount}</Badge>
      </TabsTrigger>
      <TabsTrigger value="archived"><Archive className="size-4" />{copy.archived}</TabsTrigger>
    </TabsList>
  );
}

export function AssetFilters({
  copy,
  query,
  kind,
  sourceTaskId,
  state,
  sort,
  sourceTasks,
  onQuery,
  onKind,
  onSourceTask,
  onState,
  onSort,
  onClear,
}: {
  copy: AssetWorkbenchCopy;
  query: string;
  kind: "all" | GoalAssetKind;
  sourceTaskId: string;
  state: string;
  sort: string;
  sourceTasks: SourceTask[];
  onQuery: (value: string) => void;
  onKind: (value: "all" | GoalAssetKind) => void;
  onSourceTask: (value: string) => void;
  onState: (value: string) => void;
  onSort: (value: string) => void;
  onClear: () => void;
}) {
  const filtersActive = kind !== "all" || sourceTaskId !== "all" || state !== "active" || sort !== "updated_desc";
  return (
    <div className="space-y-3 border-b pb-5">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label={copy.searchAssets} value={query} onChange={(event) => onQuery(event.target.value)} placeholder={copy.searchAssets} className="pl-9" />
        </div>
        <Select value={kind} onValueChange={(value) => onKind(value as "all" | GoalAssetKind)}>
          <SelectTrigger aria-label={copy.allTypes}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{copy.allTypes}</SelectItem><SelectItem value="document">{copy.documents}</SelectItem><SelectItem value="form">{copy.forms}</SelectItem><SelectItem value="page">{copy.pages}</SelectItem><SelectItem value="file">{copy.files}</SelectItem><SelectItem value="structured_result">{copy.structuredResults}</SelectItem>
          </SelectContent>
        </Select>
        <details className="group">
          <summary className="flex h-9 cursor-pointer list-none items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm font-medium [&::-webkit-details-marker]:hidden"><SlidersHorizontal className="size-4" />{copy.filters}<ChevronDown className="size-4 transition-transform group-open:rotate-180" /></summary>
          <div className="mt-3 grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-3">
            <Select value={sourceTaskId} onValueChange={onSourceTask}><SelectTrigger aria-label={copy.allSources}><SelectValue placeholder={copy.allSources} /></SelectTrigger><SelectContent><SelectItem value="all">{copy.allSources}</SelectItem>{sourceTasks.map((source) => <SelectItem key={source.id} value={source.id}>{source.label}</SelectItem>)}</SelectContent></Select>
            <Select value={state} onValueChange={onState}><SelectTrigger aria-label={copy.allStatuses}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">{copy.allStatuses}</SelectItem><SelectItem value="draft">{copy.draft}</SelectItem><SelectItem value="running">{copy.processing}</SelectItem><SelectItem value="failed">{copy.failed}</SelectItem></SelectContent></Select>
            <Select value={sort} onValueChange={onSort}><SelectTrigger aria-label={copy.recentlyUpdated}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="updated_desc">{copy.recentlyUpdated}</SelectItem><SelectItem value="updated_asc">{copy.oldestUpdated}</SelectItem><SelectItem value="name_asc">{copy.name}</SelectItem></SelectContent></Select>
          </div>
        </details>
      </div>
      {filtersActive ? <ActiveFilters copy={copy} kind={kind} sourceTaskId={sourceTaskId} state={state} sourceTasks={sourceTasks} onClear={onClear} /> : null}
    </div>
  );
}

function ActiveFilters({
  copy,
  kind,
  sourceTaskId,
  state,
  sourceTasks,
  onClear,
}: {
  copy: AssetWorkbenchCopy;
  kind: "all" | GoalAssetKind;
  sourceTaskId: string;
  state: string;
  sourceTasks: SourceTask[];
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{copy.activeFilters}</span>
      {kind !== "all" ? <Badge variant="outline">{kindLabel(kind, copy)}</Badge> : null}
      {sourceTaskId !== "all" ? <Badge variant="outline">{sourceTasks.find((source) => source.id === sourceTaskId)?.label}</Badge> : null}
      {state !== "active" ? <Badge variant="outline">{state}</Badge> : null}
      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onClear}>{copy.clearFilters}</Button>
    </div>
  );
}

export function AssetLibraryContent({
  assets,
  recent,
  copy,
  onSelectAsset,
}: {
  assets: GoalAssetWorkbenchData[];
  recent: GoalAssetWorkbenchData[];
  copy: AssetWorkbenchCopy;
  onSelectAsset: SelectAsset;
}) {
  const visibleRecent = recent.filter((asset) => !asset.archivedAt);
  return (
    <>
      {assets.length > 6 && visibleRecent.length > 0 ? <AssetGrid title={copy.recent} assets={visibleRecent} copy={copy} onSelectAsset={onSelectAsset} /> : null}
      <AssetGrid title={copy.allAssets} assets={assets} copy={copy} onSelectAsset={onSelectAsset} emptyIcon={<Upload className="mx-auto size-8 text-muted-foreground" />} emptyTitle={copy.noAssets} emptyDescription={copy.noAssetsDescription} />
    </>
  );
}

export function InboxContent({
  candidates,
  goalId,
  workspaceId,
  assets,
  copy,
  onRefresh,
}: {
  candidates: GoalInboxCandidateData[];
  goalId: string;
  workspaceId: string;
  assets: GoalAssetWorkbenchData[];
  copy: AssetWorkbenchCopy;
  onRefresh: () => void;
}) {
  if (candidates.length === 0) return <EmptyPanel icon={<Inbox className="mx-auto size-8 text-success" />} title={copy.inboxClear} description={copy.inboxClearDescription} />;
  const groups = Array.from(candidates.reduce((map, candidate) => {
    const group = map.get(candidate.sourceTaskId);
    if (group) group.push(candidate);
    else map.set(candidate.sourceTaskId, [candidate]);
    return map;
  }, new Map<string, GoalInboxCandidateData[]>()).values());
  return <div className="space-y-5">{groups.map((group) => {
    const sourceTask = group[0]!.sourceTask.title;
    return <section key={group[0]!.sourceTaskId} aria-label={formatCopy(copy.candidateGroupTitle, { task: sourceTask })} className="space-y-3 rounded-xl border bg-muted/15 p-3 sm:p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{copy.sourceTask}</p><h3 className="text-lg font-semibold">{sourceTask}</h3><p className="text-sm text-muted-foreground">{formatCopy(copy.candidateGroupDescription, { count: group.length })}</p></div><Badge variant="secondary">{formatCopy(copy.candidateProgress, { current: group.length, total: candidates.length })}</Badge></div>
      <div className="grid gap-4 xl:grid-cols-2">{group.map((candidate) => <InboxCandidate key={candidate.id} goalId={goalId} candidate={candidate} position={candidates.indexOf(candidate) + 1} total={candidates.length} workspaceId={workspaceId} assets={assets} copy={copy} onResolved={onRefresh} />)}</div>
    </section>;
  })}</div>;
}

export function ArchivedContent({
  assets,
  copy,
  onSelectAsset,
}: {
  assets: GoalAssetWorkbenchData[];
  copy: AssetWorkbenchCopy;
  onSelectAsset: SelectAsset;
}) {
  return <AssetGrid title={copy.archived} assets={assets} copy={copy} onSelectAsset={onSelectAsset} emptyIcon={<Archive className="mx-auto size-8 text-muted-foreground" />} emptyTitle={copy.archivedEmpty} emptyDescription={copy.archivedEmptyDescription} />;
}

function AssetGrid({
  title,
  assets,
  copy,
  onSelectAsset,
  emptyIcon,
  emptyTitle,
  emptyDescription,
}: {
  title: string;
  assets: GoalAssetWorkbenchData[];
  copy: AssetWorkbenchCopy;
  onSelectAsset: SelectAsset;
  emptyIcon?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">{title}</h3><span className="text-xs tabular-nums text-muted-foreground">{assets.length}</span></div>
      {assets.length === 0 ? <EmptyPanel icon={emptyIcon} title={emptyTitle} description={emptyDescription} /> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{assets.map((asset) => <AssetTile key={asset.id} asset={asset} copy={copy} onOpen={() => onSelectAsset(asset.id)} />)}</div>}
    </section>
  );
}

function EmptyPanel({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title?: string;
  description?: string;
}) {
  return <div className="rounded-xl border border-dashed px-5 py-10 text-center">{icon}<p className="mt-3 font-medium">{title}</p><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>;
}
