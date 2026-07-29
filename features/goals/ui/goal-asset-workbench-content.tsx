"use client";

import { useState } from "react";
import { JSONUIProvider, Renderer } from "@json-render/react";
import {
  goalDataTableContentSchema,
  isStructuredResultAssetContent,
  type GoalDataTableContent,
  type StructuredResultAssetContent,
} from "@chrona/contracts";
import { isCatalogCompatible, validateChronaSpec } from "@chrona/ui-protocol";
import {
  VirtualizedCsvPreview,
  workspaceRegistry,
} from "@features/task-workspace/ui";
import { File, Search, PanelLeftClose } from "lucide-react";
import { MarkdownContent } from "@shared/ui";
import { Button } from "@shared/ui";

import { Input } from "@shared/ui";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shared/ui";
import { Textarea } from "@shared/ui";
import { type GoalAssetWorkbenchData } from "../workbench-api";
import {
  FormEditor,
  ICON_BY_KIND,
  KIND_TONE,
  kindLabel,
  parseContent,
  type AssetWorkbenchCopy,
} from "./goal-asset-workbench-shared";
function hydrateStructuredArtifactLinks(
  content: StructuredResultAssetContent,
  goalId: string,
  assetId: string,
  versionId: string,
  linkedAssets: Array<{ ref: string; assetId: string }>,
) {
  const refs = new Set(content.artifactRefs.map((artifact) => artifact.ref));
  const linkedAssetByRef = new Map(
    linkedAssets.map((asset) => [asset.ref, asset.assetId]),
  );
  return {
    ...content.spec,
    elements: Object.fromEntries(
      Object.entries(content.spec.elements).map(([key, element]) => {
        const props = element.props as Record<string, unknown>;
        const ref =
          typeof props.path === "string" && refs.has(props.path)
            ? props.path
            : null;
        const linkedAssetId = ref ? linkedAssetByRef.get(ref) : null;
        return [
          key,
          ref
            ? {
                ...element,
                props: {
                  ...props,
                  downloadHref: `/api/goals/${encodeURIComponent(goalId)}/assets/${encodeURIComponent(assetId)}/artifacts/${encodeURIComponent(ref)}/download?versionId=${encodeURIComponent(versionId)}`,
                  ...(linkedAssetId
                    ? {
                        openAssetHref: `?section=workbench&asset=${encodeURIComponent(linkedAssetId)}`,
                        suppressContentPreview: true,
                      }
                    : {}),
                },
              }
            : element,
        ];
      }),
    ),
  };
}

function StructuredResultViewer({
  value,
  copy,
  goalId,
  assetId,
  versionId,
  linkedAssets,
}: {
  value: unknown;
  copy: AssetWorkbenchCopy;
  goalId: string;
  assetId: string;
  versionId: string;
  linkedAssets: Array<{ ref: string; assetId: string }>;
}) {
  if (
    !isStructuredResultAssetContent(value) ||
    !isCatalogCompatible(value.catalogVersion)
  ) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
      >
        {copy.invalidStructuredResult}
      </p>
    );
  }
  const canonicalValidation = validateChronaSpec(value.spec);
  if (!canonicalValidation.ok) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
      >
        {copy.invalidStructuredResult}
      </p>
    );
  }
  const spec = hydrateStructuredArtifactLinks(
    value,
    goalId,
    assetId,
    versionId,
    linkedAssets,
  );
  return (
    <section
      aria-label={copy.structuredResultContent}
      data-ui-surface-kind="ai-authored"
      className="min-w-0 space-y-3 rounded-xl border bg-background p-4 sm:p-6"
    >
      <p className="text-xs text-muted-foreground">
        {copy.structuredResultDescription}
      </p>
      <JSONUIProvider registry={workspaceRegistry} handlers={{}}>
        <Renderer spec={spec} registry={workspaceRegistry} />
      </JSONUIProvider>
    </section>
  );
}

function versionFormat(
  asset: GoalAssetWorkbenchData,
  currentVersionId?: string,
) {
  const version =
    asset.versions.find((item) => item.id === currentVersionId) ??
    asset.versions[0];
  const mimeType = version?.mimeType?.toLowerCase() ?? "";
  const filename = version?.originalFilename?.toLowerCase() ?? "";
  return {
    markdown:
      mimeType === "text/markdown" ||
      filename.endsWith(".md") ||
      filename.endsWith(".markdown"),
    csv: mimeType === "text/csv" || filename.endsWith(".csv"),
  };
}

function PageAssetContent({
  asset,
  value,
  copy,
}: {
  asset: GoalAssetWorkbenchData;
  value: string;
  copy: AssetWorkbenchCopy;
}) {
  const content = parseContent(value);
  const source =
    typeof content === "string"
      ? content
      : `<pre>${value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</pre>`;
  return (
    <div className="space-y-3">
      <div
        role="alert"
        className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
      >
        {copy.pageSafetyWarning}
      </div>
      <div className="h-full min-h-[30rem] overflow-hidden rounded-lg border bg-white">
        <iframe
          title={asset.label}
          sandbox="allow-scripts allow-forms allow-modals"
          srcDoc={source}
          className="h-full min-h-[30rem] w-full"
        />
      </div>
    </div>
  );
}

function FileAssetContent({
  asset,
  formalValue,
  csv,
  copy,
}: {
  asset: GoalAssetWorkbenchData;
  formalValue: string;
  csv: boolean;
  copy: AssetWorkbenchCopy;
}) {
  if (csv)
    return (
      <section aria-label={copy.csvPreview} className="min-w-0 space-y-3">
        <VirtualizedCsvPreview
          content={formalValue}
          contentBytes={new TextEncoder().encode(formalValue).byteLength}
        />
      </section>
    );
  return (
    <div className="flex min-h-[16rem] flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 px-5 text-center sm:min-h-[22rem]">
      <File className="size-14 text-muted-foreground" />
      <p className="mt-4 font-medium">{asset.sourceArtifact.title}</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {copy.genericFileDescription}
      </p>
    </div>
  );
}

function DataTableAssetContent({
  value,
  setValue,
  copy,
}: {
  value: string;
  setValue: (value: string) => void;
  copy: AssetWorkbenchCopy;
}) {
  const parsed = goalDataTableContentSchema.safeParse(parseContent(value));
  if (!parsed.success)
    return (
      <p
        role="alert"
        className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
      >
        {copy.dataTableInvalid}
      </p>
    );
  const table = parsed.data as GoalDataTableContent;
  const update = (next: GoalDataTableContent) => setValue(JSON.stringify(next));
  return (
    <section className="min-w-0 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {copy.dataTableSummary
            .replace("{rows}", String(table.rows.length))
            .replace("{columns}", String(table.columns.length))}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            update({
              ...table,
              rows: [
                ...table.rows,
                {
                  id: crypto.randomUUID(),
                  values: Object.fromEntries(
                    table.columns.map((column) => [column.id, null]),
                  ),
                },
              ],
            })
          }
        >
          {copy.addRow}
        </Button>
      </div>
      <div className="max-h-[36rem] overflow-auto rounded-lg border">
        <table className="w-full min-w-max text-sm">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {table.columns.map((column) => (
                <th
                  key={column.id}
                  className="border-b px-3 py-2 text-left font-medium"
                >
                  {column.label}
                </th>
              ))}
              <th className="border-b px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.id} className="border-b last:border-b-0">
                {table.columns.map((column) => (
                  <td key={column.id} className="p-1">
                    <Input
                      value={
                        row.values[column.id] == null
                          ? ""
                          : String(row.values[column.id])
                      }
                      type={
                        column.type === "number"
                          ? "number"
                          : column.type === "date"
                            ? "date"
                            : column.type === "url"
                              ? "url"
                              : "text"
                      }
                      onChange={(event) =>
                        update({
                          ...table,
                          rows: table.rows.map((candidate) =>
                            candidate.id === row.id
                              ? {
                                  ...candidate,
                                  values: {
                                    ...candidate.values,
                                    [column.id]:
                                      column.type === "number"
                                        ? event.target.value === ""
                                          ? null
                                          : Number(event.target.value)
                                        : event.target.value,
                                  },
                                }
                              : candidate,
                          ),
                        })
                      }
                      className="min-w-32 border-transparent bg-transparent shadow-none focus-visible:border-input"
                    />
                  </td>
                ))}
                <td className="p-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      update({
                        ...table,
                        rows: table.rows.filter(
                          (candidate) => candidate.id !== row.id,
                        ),
                      })
                    }
                  >
                    {copy.deleteRow}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DocumentAssetContent({
  value,
  markdown,
  copy,
  setValue,
}: {
  value: string;
  markdown: boolean;
  copy: AssetWorkbenchCopy;
  setValue: (value: string) => void;
}) {
  if (!markdown)
    return (
      <Textarea
        aria-label={copy.documentContent}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="min-h-[30rem] resize-y font-mono text-sm leading-6"
      />
    );
  return (
    <Tabs defaultValue="preview" className="min-w-0">
      <TabsList aria-label={copy.documentViewMode}>
        <TabsTrigger value="preview">{copy.previewMode}</TabsTrigger>
        <TabsTrigger value="edit">{copy.editMode}</TabsTrigger>
      </TabsList>
      <TabsContent
        value="preview"
        className="mt-4 min-w-0 rounded-xl border bg-background px-4 py-5 sm:px-6"
      >
        <MarkdownContent className="py-0 text-base leading-7 [&>div]:space-y-4">
          {value}
        </MarkdownContent>
      </TabsContent>
      <TabsContent value="edit" className="mt-4">
        <Textarea
          aria-label={copy.documentContent}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="min-h-[30rem] resize-y font-mono text-sm leading-6"
        />
      </TabsContent>
    </Tabs>
  );
}

export function AssetContentEditor({
  asset,
  currentVersionId,
  value,
  formalValue,
  setValue,
  pending,
  copy,
  act,
}: {
  asset: GoalAssetWorkbenchData;
  currentVersionId?: string;
  value: string;
  formalValue: string;
  setValue: (value: string) => void;
  pending: boolean;
  copy: AssetWorkbenchCopy;
  act: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const format = versionFormat(asset, currentVersionId);
  if (asset.kind === "structured_result") {
    return (
      <StructuredResultViewer
        value={parseContent(formalValue)}
        copy={copy}
        goalId={asset.goalId}
        assetId={asset.id}
        versionId={currentVersionId ?? ""}
        linkedAssets={asset.linkedAssets ?? []}
      />
    );
  }
  if (asset.kind === "file")
    return (
      <FileAssetContent
        asset={asset}
        formalValue={formalValue}
        csv={format.csv}
        copy={copy}
      />
    );
  if (asset.kind === "data_table")
    return (
      <DataTableAssetContent value={value} setValue={setValue} copy={copy} />
    );
  if (asset.kind === "page")
    return <PageAssetContent asset={asset} value={value} copy={copy} />;
  if (asset.kind === "form")
    return (
      <FormEditor
        asset={asset}
        currentVersionId={currentVersionId}
        value={value}
        formalValue={formalValue}
        setValue={setValue}
        pending={pending}
        copy={copy}
        act={act}
      />
    );
  return (
    <DocumentAssetContent
      value={value}
      markdown={format.markdown}
      copy={copy}
      setValue={setValue}
    />
  );
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
