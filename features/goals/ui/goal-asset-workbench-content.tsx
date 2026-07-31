"use client";
import { lazy, Suspense, useState } from "react";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { goalDataTableContentSchema, isStructuredResultAssetContent, type StructuredResultAssetContent } from "@chrona/contracts";
import { isCatalogCompatible, validateChronaSpec } from "@chrona/ui-protocol";
import { workspaceRegistry } from "@features/task-workspace/ui";
import {
  File,
  Search,
  PanelLeftClose,
} from "lucide-react";

import { Button, Input } from "@shared/ui";

import {
  type GoalAssetWorkbenchData,
} from "../workbench-api";
import {
  FormEditor,
  ICON_BY_KIND,
  KIND_TONE,
  kindLabel,
  parseContent,
  type AssetWorkbenchCopy,
} from "./goal-asset-workbench-shared";
import { MarkdownAssetCanvas } from "./goal-asset-canvas-markdown";
import { SpreadsheetAssetCanvas } from "./goal-asset-canvas-spreadsheet";

import { csvFromGoalDataTable, goalDataTableFromCsv } from "./goal-asset-canvas-csv";
const GoalAssetFilePreview = lazy(() => import("./goal-asset-file-preview"));
function hydrateStructuredArtifactLinks(
  content: StructuredResultAssetContent,
  goalId: string,
  assetId: string,
  versionId: string,
  linkedAssets: Array<{ ref: string; assetId: string }>,
) {
  const refs = new Set(content.artifactRefs.map((artifact) => artifact.ref));
  const linkedAssetByRef = new Map(linkedAssets.map((asset) => [asset.ref, asset.assetId]));
  return {
    ...content.spec,
    elements: Object.fromEntries(Object.entries(content.spec.elements).map(([key, element]) => {
      const props = element.props as Record<string, unknown>;
      const ref = typeof props.path === "string" && refs.has(props.path) ? props.path : null;
      const linkedAssetId = ref ? linkedAssetByRef.get(ref) : null;
      return [key, ref ? {
        ...element,
        props: {
          ...props,
          downloadHref: `/api/goals/${encodeURIComponent(goalId)}/assets/${encodeURIComponent(assetId)}/artifacts/${encodeURIComponent(ref)}/download?versionId=${encodeURIComponent(versionId)}`,
          ...(linkedAssetId ? {
            openAssetHref: `?section=workbench&asset=${encodeURIComponent(linkedAssetId)}`,
            suppressContentPreview: true,
          } : {}),
        },
      } : element];
    })),
  };
}

function StructuredResultViewer({ value, copy, goalId, assetId, versionId, linkedAssets }: {
  value: unknown;
  copy: AssetWorkbenchCopy;
  goalId: string;
  assetId: string;
  versionId: string;
  linkedAssets: Array<{ ref: string; assetId: string }>;
}) {
  if (!isStructuredResultAssetContent(value) || !isCatalogCompatible(value.catalogVersion)) {
    return (
      <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        {copy.invalidStructuredResult}
      </p>
    );
  }
  const canonicalValidation = validateChronaSpec(value.spec);
  if (!canonicalValidation.ok) {
    return (
      <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        {copy.invalidStructuredResult}
      </p>
    );
  }
  const spec = hydrateStructuredArtifactLinks(value, goalId, assetId, versionId, linkedAssets);
  return (
    <section
      aria-label={copy.structuredResultContent}
      data-asset-canvas="structured-result"
      data-asset-canvas-mode="read"
      data-ui-surface-kind="ai-authored"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background shadow-xs"
    >
      <div className="flex min-h-11 shrink-0 items-center border-b bg-muted/20 px-4 py-2">
        <p className="text-xs text-muted-foreground">{copy.structuredResultDescription}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 sm:py-6">
        <div className="mx-auto w-full max-w-5xl">
          <JSONUIProvider registry={workspaceRegistry} handlers={{}}>
            <Renderer spec={spec} registry={workspaceRegistry} />
          </JSONUIProvider>
        </div>
      </div>
    </section>
  );
}

function versionFormat(asset: GoalAssetWorkbenchData, currentVersionId?: string) {
  const version = asset.versions.find((item) => item.id === currentVersionId) ?? asset.versions[0];
  const mimeType = version?.mimeType?.toLowerCase() ?? "";
  const filename = version?.originalFilename?.toLowerCase() ?? "";
  return {
    markdown: mimeType === "text/markdown" || filename.endsWith(".md") || filename.endsWith(".markdown"),
    csv: mimeType === "text/csv" || filename.endsWith(".csv"),
  };
}


function PageAssetContent({ asset, value, copy }: { asset: GoalAssetWorkbenchData; value: string; copy: AssetWorkbenchCopy }) {
  const content = parseContent(value);
  const source = typeof content === "string" ? content : `<pre>${value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</pre>`;
  return <div className="space-y-3"><div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{copy.pageSafetyWarning}</div><div className="h-full min-h-[30rem] overflow-hidden rounded-lg border bg-white"><iframe title={asset.label} sandbox="allow-scripts allow-forms allow-modals" srcDoc={source} className="h-full min-h-[30rem] w-full" /></div></div>;
}

function FileAssetContent({ asset, currentVersionId, value, csv, editable, setValue, copy }: { asset: GoalAssetWorkbenchData; currentVersionId?: string; value: string; csv: boolean; editable: boolean; setValue: (value: string) => void; copy: AssetWorkbenchCopy }) {
  if (csv) {
    const table = goalDataTableFromCsv(value);
    if (!table) return <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{copy.dataTableInvalid}</p>;
    const summary = copy.dataTableSummary.replace("{rows}", String(table.rows.length)).replace("{columns}", String(table.columns.length));
    return (
      <SpreadsheetAssetCanvas
        assetId={asset.id}
        label={asset.label}
        locale={typeof document !== "undefined" && document.documentElement.lang.startsWith("zh") ? "zh" : "en"}
        mode={editable ? "edit" : "read"}
        table={table}
        summary={summary}
        onChange={(next) => setValue(csvFromGoalDataTable(next))}
      />
    );
  }
  const version = asset.versions.find((item) => item.id === currentVersionId) ?? asset.versions[0];
  if (!version) return <GenericFileFallback asset={asset} copy={copy} />;
  const source = `/api/goals/${encodeURIComponent(asset.goalId)}/assets/${encodeURIComponent(asset.id)}/download?versionId=${encodeURIComponent(version.id)}&mode=source`;
  return (
    <Suspense fallback={<GenericFileFallback asset={asset} copy={copy} />}>
      <GoalAssetFilePreview source={source} filename={version.originalFilename ?? asset.sourceArtifact.title} mimeType={version.mimeType} locale={typeof document !== "undefined" && document.documentElement.lang.startsWith("zh") ? "zh-CN" : "en-US"} description={copy.genericFileDescription} />
    </Suspense>
  );
}

function GenericFileFallback({ asset, copy }: { asset: GoalAssetWorkbenchData; copy: AssetWorkbenchCopy }) {
  return <div className="flex min-h-[16rem] flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 px-5 text-center sm:min-h-[22rem]"><File className="size-14 text-muted-foreground" /><p className="mt-4 font-medium">{asset.sourceArtifact.title}</p><p className="mt-1 max-w-md text-sm text-muted-foreground">{copy.genericFileDescription}</p></div>;
}

function DataTableAssetContent({ asset, value, editable, setValue, copy }: { asset: GoalAssetWorkbenchData; value: string; editable: boolean; setValue: (value: string) => void; copy: AssetWorkbenchCopy }) {
  const parsed = goalDataTableContentSchema.safeParse(parseContent(value));
  if (!parsed.success) return <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{copy.dataTableInvalid}</p>;
  const table = parsed.data;
  return (
    <SpreadsheetAssetCanvas
      assetId={asset.id}
      label={asset.label}
      locale={typeof document !== "undefined" && document.documentElement.lang.startsWith("zh") ? "zh" : "en"}
      mode={editable ? "edit" : "read"}
      table={table}
      summary={copy.dataTableSummary.replace("{rows}", String(table.rows.length)).replace("{columns}", String(table.columns.length))}
      onChange={(next) => setValue(JSON.stringify(next))}
    />
  );
}

function DocumentAssetContent({ value, copy, setValue }: { value: string; copy: AssetWorkbenchCopy; setValue: (value: string) => void }) {
  return <MarkdownAssetCanvas value={value} ariaLabel={copy.documentContent} onChange={setValue} />;
}

export function AssetContentEditor({
  asset,
  currentVersionId,
  value,
  formalValue,
  editable,
  setValue,
  pending,
  copy,
  act,
}: {
  asset: GoalAssetWorkbenchData;
  currentVersionId?: string;
  value: string;
  formalValue: string;
  editable: boolean;
  setValue: (value: string) => void;
  pending: boolean;
  copy: AssetWorkbenchCopy;
  act: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const format = versionFormat(asset, currentVersionId);
  if (format.csv) return <FileAssetContent asset={asset} currentVersionId={currentVersionId} value={value} csv editable={editable} setValue={setValue} copy={copy} />;
  if (asset.kind === "structured_result") {
    return <StructuredResultViewer value={parseContent(formalValue)} copy={copy} goalId={asset.goalId} assetId={asset.id} versionId={currentVersionId ?? ""} linkedAssets={asset.linkedAssets ?? []} />;
  }
  if (asset.kind === "file") return <FileAssetContent asset={asset} currentVersionId={currentVersionId} value={value} csv={false} editable={false} setValue={setValue} copy={copy} />;
  if (asset.kind === "data_table") return <DataTableAssetContent asset={asset} value={value} editable={editable} setValue={setValue} copy={copy} />;
  if (asset.kind === "page") return <PageAssetContent asset={asset} value={value} copy={copy} />;
  if (asset.kind === "form") return <FormEditor asset={asset} currentVersionId={currentVersionId} value={value} formalValue={formalValue} setValue={setValue} pending={pending} copy={copy} act={act} />;
  return <DocumentAssetContent value={value} copy={copy} setValue={setValue} />;
}

export function AssetNavigation({
  assets,
  selectedId,
  copy,
  onSelect,
  onCollapse,
}: {
  assets: GoalAssetWorkbenchData[];
  selectedId: string;
  copy: AssetWorkbenchCopy;
  onSelect: (assetId: string) => void;
  onCollapse?: () => void;
}) {
  const [query, setQuery] = useState("");
  const visibleAssets = assets.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/20">
      <div className="shrink-0 border-b p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">{copy.assetsNavigation}</p>
          {onCollapse ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={copy.collapseAssets}
              onClick={onCollapse}
            >
              <PanelLeftClose className="size-4" />
            </Button>
          ) : null}
        </div>
        <div className="relative mt-3">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={`${copy.searchAssets} · ${copy.assetsNavigation}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 pl-8"
            placeholder={copy.searchAssets}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {visibleAssets.map((item) => {
          const Icon = ICON_BY_KIND[item.kind];
          const selected = item.id === selectedId;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={selected ? "page" : undefined}
              onClick={() => onSelect(item.id)}
              className={`flex w-full min-w-0 items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary/25 bg-background shadow-xs" : "border-transparent hover:bg-background/70"}`}
            >
              <span
                className={`flex size-8 shrink-0 items-center justify-center rounded-md ${KIND_TONE[item.kind]}`}
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {item.label}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {kindLabel(item.kind, copy)} · v
                  {item.versions[0]?.version ?? 1}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
