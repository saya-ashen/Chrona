"use client";

import { useEffect, useRef, useState } from "react";
import {
  Eye,
  Pencil,
  ChevronDown,
  Download,
  Info,
  PanelLeftOpen,
  PanelRightOpen,
  X,
} from "lucide-react";
import { Button } from "@shared/ui";


import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@shared/ui";


import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@shared/ui";
import {
  createGoalAssetJob,
  saveGoalAssetDraft,
  submitGoalAssetDraft,
  type GoalAssetWorkbenchData,
} from "../workbench-api";
import {
  AssetContentEditor,
  AssetNavigation,
  type AssetCanvasMode,
} from "./goal-asset-workbench-content";
import {
  assetDisplayLabel,
  assetDisplayKind,
  contentText,
  ICON_BY_KIND,
  KIND_TONE,
  parseContent,
  type AssetWorkbenchCopy,
} from "./goal-asset-workbench-shared";
import { AssetDetails } from "./goal-asset-workbench-details";
type AssetEditorProps = {
  goalId: string; workspaceId: string; asset: GoalAssetWorkbenchData; assets: GoalAssetWorkbenchData[];
  copy: AssetWorkbenchCopy; onSelectAsset: (assetId: string) => void; onClose: () => void; onRefresh: () => void;
};

type AssetEditorActions = {
  pending: boolean; save: () => void; publish: () => void; downloadSource: () => void;
  exportAsset: (format: string) => void; exportFormats: Array<{ format: string; label: string }>;
};

function assetExportFormats(asset: GoalAssetWorkbenchData, copy: AssetWorkbenchCopy) {
  if (asset.kind === "structured_result") return [{ format: "md", label: copy.exportMarkdown }, { format: "pdf", label: copy.exportPdf }, { format: "json", label: copy.exportJson }];
  if (asset.kind === "document") return [{ format: "md", label: copy.exportMarkdown }, { format: "pdf", label: copy.exportPdf }];
  if (asset.kind === "page") return [{ format: "html", label: "HTML" }, { format: "pdf", label: copy.exportPdf }];
  return [{ format: "json", label: copy.exportJson }];
}

function AssetEditorHeader({ asset, current, draft, copy, editable, mode, actions, onClose, openAssets, openDetails, onModeChange, message }: {
  asset: GoalAssetWorkbenchData; current: GoalAssetWorkbenchData["versions"][number] | undefined; draft: GoalAssetWorkbenchData["drafts"][number] | undefined;
  copy: AssetWorkbenchCopy; editable: boolean; mode: AssetCanvasMode; actions: AssetEditorActions; onClose: () => void; openAssets: () => void; openDetails: () => void; onModeChange: (mode: AssetCanvasMode) => void; message: string | null;
}) {
  const Icon = ICON_BY_KIND[asset.kind];
  return <SheetHeader className="shrink-0 border-b px-4 py-3 sm:px-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="flex min-w-0 items-center gap-3"><span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${KIND_TONE[asset.kind]}`}><Icon className="size-4" /></span><div className="min-w-0"><SheetTitle className="truncate">{asset.label}</SheetTitle><SheetDescription className="flex flex-wrap items-center gap-1.5"><span>{assetDisplayLabel(asset, copy)}</span><span aria-hidden>·</span><span>v{current?.version ?? 1}</span><span aria-hidden>·</span><span className={draft ? "text-warning" : ""}>{draft ? copy.draftAvailable : copy.noDraft}</span></SheetDescription></div></div><div className="flex flex-wrap items-center gap-2 [&_button]:max-sm:min-h-11"><Button variant="outline" size="sm" className="xl:hidden" onClick={openAssets}><PanelLeftOpen className="size-4" />{copy.openAssets}</Button><Button variant="outline" size="sm" className="xl:hidden" onClick={openDetails}><Info className="size-4" />{copy.openDetails}</Button>{editable ? <Button size="sm" variant={mode === "edit" ? "secondary" : "outline"} aria-pressed={mode === "edit"} onClick={() => onModeChange(mode === "edit" ? "read" : "edit")}>{mode === "edit" ? <Eye className="size-4" /> : <Pencil className="size-4" />}{mode === "edit" ? copy.previewMode : copy.editMode}</Button> : null}{editable && mode === "edit" ? <Button size="sm" variant="outline" disabled={actions.pending} onClick={actions.save}>{copy.saveDraft}</Button> : null}{editable && mode === "edit" ? <Button size="sm" disabled={actions.pending} onClick={actions.publish}>{copy.publishVersion}</Button> : null}<Button size="sm" variant="outline" onClick={actions.downloadSource}><Download className="size-4" />{copy.downloadSource}</Button><DropdownMenu><DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>{copy.export}<ChevronDown className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end">{actions.exportFormats.map((entry) => <DropdownMenuItem key={entry.format} onClick={() => actions.exportAsset(entry.format)}>{entry.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu><Button size="icon-sm" variant="ghost" aria-label={copy.closeAssetWorkspace} onClick={onClose}><X className="size-4" /></Button></div></div>{message ? <p role="status" className="text-xs text-muted-foreground">{message}</p> : null}</SheetHeader>;
}

function CollapsibleAssetNavigation({ assets, asset, copy, collapsed, setCollapsed, onSelect }: { assets: GoalAssetWorkbenchData[]; asset: GoalAssetWorkbenchData; copy: AssetWorkbenchCopy; collapsed: boolean; setCollapsed: (value: boolean) => void; onSelect: (id: string) => void }) {
  return <aside data-asset-panel={collapsed ? "assets-collapsed" : "assets"} className="hidden min-h-0 border-r bg-muted/20 xl:block">{collapsed ? <div className="flex h-full justify-center pt-3"><Button size="icon-sm" variant="ghost" aria-label={copy.openAssets} onClick={() => setCollapsed(false)}><PanelLeftOpen className="size-4" /></Button></div> : <AssetNavigation assets={assets} selectedId={asset.id} copy={copy} onSelect={onSelect} onCollapse={() => setCollapsed(true)} />}</aside>;
}

function CollapsibleAssetDetails({ details, copy, collapsed, setCollapsed }: { details: React.ReactElement<React.ComponentProps<typeof AssetDetails>>; copy: AssetWorkbenchCopy; collapsed: boolean; setCollapsed: (value: boolean) => void }) {
  return <aside data-asset-panel={collapsed ? "details-collapsed" : "details"} className="hidden min-h-0 border-l bg-muted/10 xl:block">{collapsed ? <div className="flex h-full justify-center pt-3"><Button size="icon-sm" variant="ghost" aria-label={copy.openDetails} onClick={() => setCollapsed(false)}><PanelRightOpen className="size-4" /></Button></div> : <AssetDetails {...details.props} onCollapse={() => setCollapsed(true)} />}</aside>;
}

function MobileAssetDrawers({ assetsOpen, setAssetsOpen, detailsOpen, setDetailsOpen, assets, asset, copy, onSelectAsset, details }: { assetsOpen: boolean; setAssetsOpen: (value: boolean) => void; detailsOpen: boolean; setDetailsOpen: (value: boolean) => void; assets: GoalAssetWorkbenchData[]; asset: GoalAssetWorkbenchData; copy: AssetWorkbenchCopy; onSelectAsset: (id: string) => void; details: React.ReactElement<React.ComponentProps<typeof AssetDetails>> }) {
  return <><Sheet open={assetsOpen} onOpenChange={setAssetsOpen}><SheetContent side="left" className="w-[min(88vw,22rem)]! max-w-none! gap-0 p-0 xl:hidden"><SheetTitle className="sr-only">{copy.assetsNavigation}</SheetTitle><AssetNavigation assets={assets} selectedId={asset.id} copy={copy} onSelect={(assetId) => { onSelectAsset(assetId); setAssetsOpen(false); }} /></SheetContent></Sheet><Sheet open={detailsOpen} onOpenChange={setDetailsOpen}><SheetContent side="right" className="w-[min(92vw,28rem)]! max-w-none! gap-0 p-0 xl:hidden"><SheetTitle className="sr-only">{copy.assetDetails}</SheetTitle>{details}</SheetContent></Sheet></>;
}

function useAssetEditorState(asset: GoalAssetWorkbenchData, current: GoalAssetWorkbenchData["versions"][number] | undefined, draft: GoalAssetWorkbenchData["drafts"][number] | undefined) {
  const initialContent = contentText(draft?.content ?? current?.content ?? asset.sourceArtifact.contentPreview ?? "");
  const [value, setValue] = useState(initialContent);
  const [label, setLabel] = useState(asset.label);
  const [description, setDescription] = useState(asset.description ?? "");
  const [instruction, setInstruction] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const initialValue = useRef(value);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const nextValue = contentText(draft?.content ?? current?.content ?? asset.sourceArtifact.contentPreview ?? "");
    clearTimeout(autosaveTimer.current);
    setValue(nextValue); setLabel(asset.label); setDescription(asset.description ?? ""); setInstruction(""); setMessage(null); initialValue.current = nextValue;
  }, [asset.id]);
  return { value, setValue, label, setLabel, description, setDescription, instruction, setInstruction, message, setMessage, initialValue, autosaveTimer };
}

function useAssetEditorActions({ goalId, workspaceId, asset, current, value, initialValue, autosaveTimer, copy, onRefresh, setPending, setMessage }: {
  goalId: string; workspaceId: string; asset: GoalAssetWorkbenchData; current: GoalAssetWorkbenchData["versions"][number] | undefined; value: string; initialValue: React.MutableRefObject<string>; autosaveTimer: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>; copy: AssetWorkbenchCopy; onRefresh: () => void; setPending: (value: boolean) => void; setMessage: (value: string | null) => void;
}) {
  async function act(action: () => Promise<unknown>, success: string) { setPending(true); setMessage(null); try { await action(); setMessage(success); onRefresh(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : copy.actionFailed); } finally { setPending(false); } }
  async function ensureDraft() { if (!current) return null; const created = await saveGoalAssetDraft(goalId, asset.id, { workspaceId, baseVersionId: current.id, authorType: "user", content: parseContent(value) as string | Record<string, unknown> | unknown[] }); initialValue.current = value; return created.id; }
  function save() { if (!current) return; clearTimeout(autosaveTimer.current); void act(async () => { await ensureDraft(); }, copy.draftSaved); }
  function publish() { if (!current) return; clearTimeout(autosaveTimer.current); void act(async () => { const draftId = await ensureDraft(); if (!draftId) return; await submitGoalAssetDraft(goalId, asset.id, { workspaceId, draftId, changeSummary: copy.manualEditSummary }); }, copy.newFormalVersionCreated); }
  function downloadSource() { if (!current) return; const anchor = document.createElement("a"); anchor.href = `/api/goals/${encodeURIComponent(goalId)}/assets/${encodeURIComponent(asset.id)}/download?versionId=${encodeURIComponent(current.id)}&mode=source`; anchor.download = current.originalFilename ?? `${asset.label}-v${current.version}`; anchor.rel = "noopener"; anchor.click(); }
  function exportAsset(format: string) { if (!current) return; void act(async () => { const job = await createGoalAssetJob(goalId, asset.id, { workspaceId, versionId: current.id, kind: "export", format }); const anchor = document.createElement("a"); anchor.href = `/api/goals/${encodeURIComponent(goalId)}/assets/${encodeURIComponent(asset.id)}/download?versionId=${encodeURIComponent(current.id)}&mode=export&format=${encodeURIComponent(job.format ?? format)}`; anchor.rel = "noopener"; anchor.click(); }, copy.exportReady); }
  return { act, ensureDraft, save, publish, downloadSource, exportAsset };
}

export function AssetEditor({ goalId, workspaceId, asset, assets, copy, onSelectAsset, onClose, onRefresh }: AssetEditorProps) {
  const current = asset.versions[0];
  const draft = asset.drafts[0];
  const { value, setValue, label, setLabel, description, setDescription, instruction, setInstruction, message, setMessage, initialValue, autosaveTimer } = useAssetEditorState(asset, current, draft);
  const displayKind = assetDisplayKind(asset);
  const editable = asset.kind === "document" || asset.kind === "data_table" || asset.kind === "form" || displayKind === "spreadsheet";
  const [mode, setMode] = useState<AssetCanvasMode>(asset.kind === "form" ? "edit" : "read");
  const [pending, setPending] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [assetsCollapsed, setAssetsCollapsed] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("chrona.goalAssets.collapsed") === "true");
  const [detailsCollapsed, setDetailsCollapsed] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("chrona.goalAssetDetails.collapsed") === "true");
  useEffect(() => {
    window.localStorage.setItem("chrona.goalAssets.collapsed", String(assetsCollapsed));
  }, [assetsCollapsed]);
  useEffect(() => {
    window.localStorage.setItem("chrona.goalAssetDetails.collapsed", String(detailsCollapsed));
  }, [detailsCollapsed]);
  useEffect(() => {
    setMode(asset.kind === "form" ? "edit" : "read");
  }, [asset.id, editable]);
  const { act, save, publish, downloadSource, exportAsset } = useAssetEditorActions({
    goalId, workspaceId, asset, current, value, initialValue, autosaveTimer, copy, onRefresh, setPending, setMessage,
  });
  useEffect(() => {
    if (!current || !editable || mode !== "edit" || value === initialValue.current || pending) return;
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void act(() => saveGoalAssetDraft(goalId, asset.id, { workspaceId, baseVersionId: current.id, authorType: "user", content: parseContent(value) as string | Record<string, unknown> | unknown[] }), copy.draftAutosaved);
      initialValue.current = value;
    }, 800);
    return () => clearTimeout(autosaveTimer.current);
  }, [asset.id, current, editable, goalId, mode, pending, value, workspaceId]);
  const exportFormats = assetExportFormats(asset, copy);
  function downloadSubmission(targetAsset: GoalAssetWorkbenchData, submission: GoalAssetWorkbenchData["submissions"][number]) {
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([JSON.stringify(submission.content, null, 2)], { type: "application/json" }));
    anchor.download = `${targetAsset.label}-submission-${submission.id}.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }
  const gridColumns = assetsCollapsed && detailsCollapsed
    ? "xl:grid-cols-[3rem_minmax(0,1fr)_3rem]"
    : assetsCollapsed
      ? "xl:grid-cols-[3rem_minmax(0,1fr)_19rem]"
      : detailsCollapsed
        ? "xl:grid-cols-[15rem_minmax(0,1fr)_3rem]"
        : "xl:grid-cols-[15rem_minmax(0,1fr)_19rem]";
  const details = <AssetDetails goalId={goalId} workspaceId={workspaceId} asset={asset} current={current} label={label} setLabel={setLabel} description={description} setDescription={setDescription} instruction={instruction} setInstruction={setInstruction} pending={pending} copy={copy} act={act} downloadSubmission={downloadSubmission} />;
  const actions: AssetEditorActions = { pending, save: () => void save(), publish: () => void publish(), downloadSource, exportAsset, exportFormats };
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="asset-workspace">
      <AssetEditorHeader asset={asset} current={current} draft={draft} copy={copy} editable={editable} mode={mode} actions={actions} onClose={onClose} openAssets={() => setAssetsOpen(true)} openDetails={() => setDetailsOpen(true)} onModeChange={setMode} message={message} />
      <div className={`grid min-h-0 flex-1 grid-cols-1 ${gridColumns}`}>
        <CollapsibleAssetNavigation assets={assets} asset={asset} copy={copy} collapsed={assetsCollapsed} setCollapsed={setAssetsCollapsed} onSelect={onSelectAsset} />
        <main className="flex min-h-0 flex-col overflow-y-auto bg-muted/15 p-3 sm:p-5 xl:p-6"><div className={displayKind === "spreadsheet" || displayKind === "document" || displayKind === "structured_result" ? "flex min-h-[32rem] w-full flex-1 flex-col" : asset.kind === "file" ? "mx-auto w-full max-w-[96rem]" : "mx-auto w-full max-w-5xl"}><AssetContentEditor asset={asset} currentVersionId={current?.id} value={value} formalValue={contentText(current?.content ?? asset.sourceArtifact.contentPreview ?? "")} mode={mode} setValue={setValue} pending={pending} copy={copy} act={act} /></div></main>
        <CollapsibleAssetDetails details={details} copy={copy} collapsed={detailsCollapsed} setCollapsed={setDetailsCollapsed} />
      </div>
      <MobileAssetDrawers assetsOpen={assetsOpen} setAssetsOpen={setAssetsOpen} detailsOpen={detailsOpen} setDetailsOpen={setDetailsOpen} assets={assets} asset={asset} copy={copy} onSelectAsset={onSelectAsset} details={details} />
    </div>
  );
}
