import { useCallback, useMemo, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import { useStewardSession } from "../hooks/use-steward-session";
import { useStewardResource } from "../hooks/use-steward";
import { pageName, visiblePath, type FileBranch } from "../model/affair-file";
import { pageHref } from "../model/workspace";
import { PageColumn, Section, Surface } from "./layout";
import { ResourceStatus } from "./resource-status";
import { AffairFileActions } from "./affair-actions";
import { AffairHistory } from "./affair-history";
import { AffairFileView } from "./affair-file-view";
import { GeneratedPage } from "./generated-page";
import { entryPath } from "../model/ui-page";
import type { StewardClient } from "../model/client";
import { AffairArrangements, AffairCenterHeader, AffairNow, AffairTechnicalDetails, AffairTimeline } from "./affair-center";
import { affairCenter, affairPages } from "../model/affair-center";
import { ApprovalItem } from "./approval-item";

export function AffairDetailPage() {
  const { affairId = "" } = useParams();
  const [params] = useSearchParams();
  const { messages } = useI18n();
  const c = messages.steward.affairFile;
  const client = useStewardSession().today.client;
  const resource = useStewardResource(useCallback((signal?: AbortSignal) => client.affair(affairId, signal), [client, affairId]));
  const detail = resource.data;
  const path = params.get("path") || (resource.data ? entryPath(resource.data.files) : "README.md");
  const { selected, tree } = affairPages(detail, path);
  const composed = path.endsWith(".ui.json");
  const model = detail ? affairCenter(detail, messages.steward.affairCenter.followUp) : null;
  return <PageColumn className="gap-5">
    <ResourceStatus resource={resource} />
    {detail && <>
      <AffairCenterHeader detail={detail} client={client} refresh={resource.refresh} />
      {composed && <>
        {!!model?.approvals.length && <Section title={messages.steward.foundation.decisions}><Surface>{model.approvals.map(approval => <ApprovalItem key={approval.id} approval={approval} client={client} refresh={resource.refresh} />)}</Surface></Section>}
        <section aria-label={pageName(path)} className="min-w-0 max-w-[760px]"><ComposedPage key={`${affairId}:${path}`} client={client} affairId={affairId} path={path} refresh={resource.refresh} readOnly={detail.affair.status === "done"} /></section>
      </>}
      {/* A composed entry page is the whole first level; files, arrangements and history stay one click away. */}
      <AffairSecondLevel collapsed={composed} label={messages.steward.affairCenter.secondLevel}>
      <div className="grid min-w-0 items-start gap-x-7 gap-y-5 min-[861px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="contents min-[861px]:grid min-[861px]:gap-5 min-w-0">
        <div className="order-1 grid min-w-0 gap-5">
          {!composed && <AffairNow detail={detail} />}
          {!composed && !!model?.approvals.length && <Section title={messages.steward.foundation.decisions}><Surface>{model.approvals.map(approval => <ApprovalItem key={approval.id} approval={approval} client={client} refresh={resource.refresh} />)}</Surface></Section>}
        </div>
        <section aria-label={path} className="order-3 min-w-0">{composed ? null : selected ? <AffairFileView key={`${affairId}:${path}`} client={client} affairId={affairId} path={path} refresh={resource.refresh} readOnly={detail.affair.status === "done"} /> : <p>{tree.length ? c.notFound : c.empty}</p>}</section>
        <div className="order-4 min-w-0"><AffairTimeline key={affairId} detail={detail} client={client} refresh={resource.refresh} /></div>
        <div className="order-6 min-w-0"><AffairTechnicalDetails detail={detail}>
          <details className="min-w-0"><summary>{messages.steward.affairCenter.history}</summary><AffairHistory key={affairId} client={client} affairId={affairId} refresh={resource.refresh} /></details>
        </AffairTechnicalDetails></div>
        </div>
        <aside className="contents min-[861px]:grid min-[861px]:gap-4 min-w-0">
        <nav aria-label={c.pages} className="order-2 grid min-w-0 gap-2 rounded-[10px] border bg-card p-3.5 text-[13px]">
          <div className="hidden min-[861px]:block"><h2 className="mb-2 font-semibold text-muted-foreground">{c.pages}</h2><FileTree nodes={tree} affairId={affairId} selected={path} /></div>
          {/* Narrow screens: the page list sits above the content, collapsed, so long pages do not bury it. */}
          <details className="min-[861px]:hidden"><summary>{messages.steward.affairCenter.pagesCount.replace("{count}", String(detail.files.filter(file => file.kind === "file" && visiblePath(file.path)).length)).replace("{page}", pageName(path))}</summary><div className="pt-2"><FileTree nodes={tree} affairId={affairId} selected={path} /></div></details>
          {!tree.length && <p>{c.empty}</p>}
          {detail.affair.status !== "done" && <AffairFileActions client={client} affairId={affairId} path={path} refresh={resource.refresh} />}
        </nav>
        <div className="order-5 min-w-0"><AffairArrangements detail={detail} client={client} refresh={resource.refresh} /></div>
        </aside>
      </div>
      </AffairSecondLevel>
    </>}
  </PageColumn>;
}
export function FileTree({ nodes, affairId, selected }: { nodes: FileBranch[]; affairId: string; selected: string }) {
  const { locale } = useI18n();
  return <ul className="grid min-w-0 gap-0.5">{nodes.map(node => <li key={node.path} className="min-w-0 break-words">
    {node.directory ? <details open={selected.startsWith(`${node.path}/`) || undefined}><summary>{node.name}</summary><div className="pl-3 pt-2"><FileTree nodes={node.children} affairId={affairId} selected={selected} /></div></details> : <Link to={pageHref(locale, affairId, node.path)} aria-current={selected === node.path ? "page" : undefined} className="block rounded-md px-2 py-1 text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:font-medium aria-[current=page]:text-foreground">{pageName(node.name)}</Link>}
  </li>)}</ul>;
}

function ComposedPage({ client, affairId, path, refresh, readOnly }: { client: StewardClient; affairId: string; path: string; refresh: () => void; readOnly: boolean }) {
  const file = useStewardResource(useCallback((signal?: AbortSignal) => client.file(affairId, path, signal), [client, affairId, path]));
  const spec = useMemo(() => { try { return file.data ? JSON.parse(file.data.content) as unknown : null; } catch { return null; } }, [file.data]);
  return <><ResourceStatus resource={file} />{file.data && <GeneratedPage spec={spec} client={client} affairId={affairId} readOnly={readOnly} refresh={() => { file.refresh(); refresh(); }} />}</>;
}

function AffairSecondLevel({ collapsed, label, children }: { collapsed: boolean; label: string; children: ReactNode }) {
  return collapsed ? <details className="min-w-0"><summary className="cursor-pointer text-[13px] text-muted-foreground">{label}</summary><div className="pt-4">{children}</div></details> : <>{children}</>;
}
