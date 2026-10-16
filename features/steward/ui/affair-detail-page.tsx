import { useCallback } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import { useStewardSession } from "../hooks/use-steward-session";
import { useStewardResource } from "../hooks/use-steward";
import { fileTree, pageName, visiblePath, type FileBranch } from "../model/affair-file";
import { pageHref } from "../model/workspace";
import { PageColumn, Section, Surface } from "./layout";
import { ResourceStatus } from "./resource-status";
import { AffairFileActions } from "./affair-actions";
import { AffairHistory } from "./affair-history";
import { AffairFileView } from "./affair-file-view";
import { AffairArrangements, AffairCenterHeader, AffairTechnicalDetails, AffairTimeline } from "./affair-center";
import { affairCenter } from "../model/affair-center";
import { ApprovalItem } from "./approval-item";

export function AffairDetailPage() {
  const { affairId = "" } = useParams();
  const [params] = useSearchParams();
  const { messages } = useI18n();
  const c = messages.steward.affairFile;
  const client = useStewardSession().today.client;
  const resource = useStewardResource(useCallback((signal?: AbortSignal) => client.affair(affairId, signal), [client, affairId]));
  const detail = resource.data;
  const path = params.get("path") || "README.md";
  const selected = detail?.files.find(file => file.path === path && file.kind === "file" && visiblePath(path));
  const tree = detail ? fileTree(detail.files) : [];
  const model = detail ? affairCenter(detail, messages.steward.affairCenter.followUp) : null;
  return <PageColumn className="max-w-screen-2xl">
    <ResourceStatus resource={resource} />
    {detail && <>
      <AffairCenterHeader detail={detail} client={client} refresh={resource.refresh} />
      {!!model?.approvals.length && <Section title={messages.steward.foundation.decisions}><Surface className="border-primary">{model.approvals.map(approval => <ApprovalItem key={approval.id} approval={approval} client={client} refresh={resource.refresh} />)}</Surface></Section>}
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[11rem_minmax(0,1fr)_18rem]">
        <nav aria-label={c.pages} className="min-w-0 xl:col-start-1 xl:row-start-1">
          <div className="hidden xl:block"><h2 className="mb-3 font-medium">{c.pages}</h2><FileTree nodes={tree} affairId={affairId} selected={path} /></div>
          {/* Narrow screens: the page list sits above the content, collapsed, so long pages do not bury it. */}
          <details className="xl:hidden"><summary>{messages.steward.affairCenter.pagesCount.replace("{count}", String(detail.files.filter(file => file.kind === "file" && visiblePath(file.path)).length)).replace("{page}", pageName(path))}</summary><div className="pt-2"><FileTree nodes={tree} affairId={affairId} selected={path} /></div></details>
          {!tree.length && <p>{c.empty}</p>}
        </nav>
        <section aria-label={path} className="min-w-0 xl:col-start-2 xl:row-start-1"><AffairFileActions client={client} affairId={affairId} path={path} refresh={resource.refresh}>{selected ? <AffairFileView key={`${affairId}:${path}`} client={client} affairId={affairId} path={path} refresh={resource.refresh} /> : <p>{tree.length ? c.notFound : c.empty}</p>}</AffairFileActions></section>
        <aside className="grid min-w-0 gap-6 break-words xl:col-start-3 xl:row-start-1"><AffairArrangements detail={detail} client={client} refresh={resource.refresh} /><AffairTimeline key={affairId} detail={detail} /></aside>
      </div>
      <details className="min-w-0"><summary>{messages.steward.affairCenter.history}</summary><AffairHistory key={affairId} client={client} affairId={affairId} refresh={resource.refresh} /></details>
      <AffairTechnicalDetails detail={detail} />
    </>}
  </PageColumn>;
}
export function FileTree({ nodes, affairId, selected }: { nodes: FileBranch[]; affairId: string; selected: string }) {
  const { locale } = useI18n();
  return <ul className="grid min-w-0 gap-2">{nodes.map(node => <li key={node.path} className="min-w-0 break-words">
    {node.directory ? <details open={selected.startsWith(`${node.path}/`) || undefined}><summary>{node.name}</summary><div className="pl-3 pt-2"><FileTree nodes={node.children} affairId={affairId} selected={selected} /></div></details> : <Link to={pageHref(locale, affairId, node.path)} aria-current={selected === node.path ? "page" : undefined} className="block rounded px-1 py-1 aria-[current=page]:bg-muted aria-[current=page]:font-semibold">{pageName(node.name)}</Link>}
  </li>)}</ul>;
}
