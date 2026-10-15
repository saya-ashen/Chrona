import { useCallback } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import { useStewardSession } from "../hooks/use-steward-session";
import { useStewardResource } from "../hooks/use-steward";
import { fileTree, visiblePath, type FileBranch } from "../model/affair-file";
import { pageHref } from "../model/workspace";
import { PageColumn } from "./layout";
import { ResourceStatus } from "./resource-status";
import { AffairHistory } from "./affair-history";
import { AffairFileView } from "./affair-file-view";
import { WorkspaceAffairSidebar } from "./workspace-affair-sidebar";

export function AffairDetailPage() {
  const { affairId = "" } = useParams();
  const [params] = useSearchParams();
  const { locale, messages } = useI18n();
  const c = messages.steward.affairFile;
  const client = useStewardSession().today.client;
  const resource = useStewardResource(useCallback((signal?: AbortSignal) => client.affair(affairId, signal), [client, affairId]));
  const detail = resource.data;
  const path = params.get("path") || "README.md";
  const selected = detail?.files.find(file => file.path === path && file.kind === "file" && visiblePath(path));
  const tree = detail ? fileTree(detail.files) : [];
  return <PageColumn className="max-w-screen-2xl">
    <ResourceStatus resource={resource} />
    {detail && <>
      <header className="grid gap-2"><Link to={`/${locale}/affairs`}>← {messages.steward.affairs.title}</Link><h1 className="text-2xl font-semibold">{detail.affair.title}</h1><p>{detail.affair.summary}</p></header>
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[11rem_minmax(0,1fr)_16rem]">
        <nav aria-label={c.pages} className="min-w-0">
          <div className="hidden lg:block"><h2 className="mb-3 font-medium">{c.pages}</h2><FileTree nodes={tree} affairId={affairId} selected={path} /></div>
          <details className="lg:hidden"><summary>{c.pages}</summary><FileTree nodes={tree} affairId={affairId} selected={path} /></details>
          {!tree.length && <p>{c.empty}</p>}
        </nav>
        <section aria-label={path} className="min-w-0">{selected ? <AffairFileView key={`${affairId}:${path}`} client={client} affairId={affairId} path={path} refresh={resource.refresh} /> : <p>{tree.length ? c.notFound : c.empty}</p>}</section>
        <WorkspaceAffairSidebar detail={detail} client={client} refresh={resource.refresh} />
      </div>
      <AffairHistory key={affairId} client={client} affairId={affairId} refresh={resource.refresh} />
    </>}
  </PageColumn>;
}
export function FileTree({ nodes, affairId, selected }: { nodes: FileBranch[]; affairId: string; selected: string }) {
  const { locale } = useI18n();
  return <ul className="grid min-w-0 gap-2">{nodes.map(node => <li key={node.path} className="min-w-0 break-words">
    {node.directory ? <details open={selected.startsWith(`${node.path}/`) || undefined}><summary>{node.name}</summary><div className="pl-3 pt-2"><FileTree nodes={node.children} affairId={affairId} selected={selected} /></div></details> : <Link to={pageHref(locale, affairId, node.path)} aria-current={selected === node.path ? "page" : undefined} className="block rounded px-1 py-1 aria-[current=page]:bg-muted aria-[current=page]:font-semibold">{node.name}</Link>}
  </li>)}</ul>;
}
