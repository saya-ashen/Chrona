import type { AffairDetail } from "@chrona/contracts";
import { Button } from "@shared/ui";
import { GeneratedPageFeedback } from "./generated-page-feedback";
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
import { selectedPage } from "../model/ui-page";
import type { StewardClient } from "../model/client";
import { AffairArrangements, AffairCenterHeader, AffairNow, AffairTechnicalDetails, AffairTimeline } from "./affair-center";
import { affairCenter, affairPages } from "../model/affair-center";
import { ApprovalItem } from "./approval-item";
import { ProviderWork } from "./provider-work";

export function AffairDetailPage() {
  const { affairId = "" } = useParams();
  const [params] = useSearchParams();
  const session = useStewardSession(), client = session.today.client;
  const resource = useStewardResource(useCallback((signal?: AbortSignal) => client.affair(affairId, signal), [client, affairId]), true, String(session.revision));
  const detail = resource.data;
  const path = selectedPage(detail?.entry, params.get("path"));
  return <PageColumn className="gap-5"><ResourceStatus resource={resource} />{detail && <AffairContent detail={detail} path={path} client={client} refresh={resource.refresh} />}</PageColumn>;
}

type ContentProps = { detail: AffairDetail; path: string; client: StewardClient; refresh: () => void };
function AffairContent({ detail, path, client, refresh }: ContentProps) {
  const { messages, locale } = useI18n();
  const affairId = detail.affair.id;
  const reading = path !== (detail.entry ?? "README.md");
  const standalone = reading || path.endsWith(".ui.json");
  const model = affairCenter(detail, messages.steward.affairCenter.followUp);
  return <>
      <AffairCenterHeader detail={detail} client={client} refresh={refresh} />
      <ProviderWork key={affairId} client={client} affairId={affairId} mode="summary" onChange={refresh} />
      {reading && <Button asChild variant="ghost" className="-ml-2 min-h-10 w-fit px-2"><Link to={pageHref(locale, affairId)}><span aria-hidden="true">←</span>{messages.steward.affairCenter.backHome}</Link></Button>}
      {standalone && <>
        {!!model.approvals.length && <Section title={messages.steward.foundation.decisions}><Surface>{model.approvals.map(approval => <ApprovalItem key={approval.id} approval={approval} client={client} refresh={refresh} />)}</Surface></Section>}
        <section aria-label={path} className="min-w-0"><AffairPageBody detail={detail} path={path} client={client} refresh={refresh} /></section>
      </>}
      {/* Entry content and secondary readers do not compete with the workspace's administration. */}
      <AffairSecondLevel collapsed={standalone} label={messages.steward.affairCenter.secondLevel}>
        <AffairContents detail={detail} path={path} client={client} refresh={refresh} showPage={!standalone} />
      </AffairSecondLevel>
    </>;
}
function AffairPageBody({ detail, path, client, refresh }: ContentProps) {
  const c = useI18n().messages.steward.affairFile;
  const affairId = detail.affair.id;
  const { selected, tree } = affairPages(detail, path);
  if (path.endsWith(".ui.json")) return <ComposedPage key={`${affairId}:${path}`} client={client} affairId={affairId} path={path} refresh={refresh} refreshVersion={detail.affair.lastActivityAt} readOnly={detail.affair.status === "done"} />;
  return selected ? <AffairFileView key={`${affairId}:${path}`} client={client} affairId={affairId} path={path} refresh={refresh} refreshVersion={detail.affair.lastActivityAt} summaryShown={path === (detail.entry ?? "README.md")} readOnly={detail.affair.status === "done"} /> : <p>{tree.length ? c.notFound : c.empty}</p>;
}
function AffairContents({ detail, path, client, refresh, showPage }: ContentProps & { showPage: boolean }) {
  const { messages } = useI18n();
  const c = messages.steward.affairFile;
  const affairId = detail.affair.id;
  const resource = { refresh };
  const { tree } = affairPages(detail, path);
  const model = affairCenter(detail, messages.steward.affairCenter.followUp);
  return <div className="grid min-w-0 items-start gap-x-7 gap-y-5 min-[861px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="contents min-[861px]:grid min-[861px]:gap-5 min-w-0">
        <div className="order-1 grid min-w-0 gap-5">
          {showPage && <AffairNow detail={detail} />}
          {showPage && !!model.approvals.length && <Section title={messages.steward.foundation.decisions}><Surface>{model.approvals.map(approval => <ApprovalItem key={approval.id} approval={approval} client={client} refresh={resource.refresh} />)}</Surface></Section>}
        </div>
        {showPage && <section aria-label={path} className="order-3 min-w-0"><AffairPageBody detail={detail} path={path} client={client} refresh={refresh} /></section>}
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
      </div>;
}
export function FileTree({ nodes, affairId, selected }: { nodes: FileBranch[]; affairId: string; selected: string }) {
  const { locale } = useI18n();
  return <ul className="grid min-w-0 gap-0.5">{nodes.map(node => <li key={node.path} className="min-w-0 break-words">
    {node.directory ? <details open={selected.startsWith(`${node.path}/`) || undefined}><summary>{node.name}</summary><div className="pl-3 pt-2"><FileTree nodes={node.children} affairId={affairId} selected={selected} /></div></details> : <Link to={pageHref(locale, affairId, node.path)} aria-current={selected === node.path ? "page" : undefined} className="block rounded-md px-2 py-1 text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:font-medium aria-[current=page]:text-foreground">{pageName(node.name)}</Link>}
  </li>)}</ul>;
}

function ComposedPage({ client, affairId, path, refresh, readOnly, refreshVersion }: { client: StewardClient; affairId: string; path: string; refresh: () => void; readOnly: boolean; refreshVersion: string }) {
  const file = useStewardResource(useCallback((signal?: AbortSignal) => client.file(affairId, path, signal), [client, affairId, path]), false, refreshVersion);
  const spec = useMemo(() => { try { return file.data ? JSON.parse(file.data.content) as unknown : null; } catch { return null; } }, [file.data]);
  return <><ResourceStatus resource={file} />{file.data && <><GeneratedPage spec={spec} path={path} client={client} affairId={affairId} readOnly={readOnly} refreshVersion={refreshVersion} refresh={() => { file.refresh(); refresh(); }} /><GeneratedPageFeedback client={client} affairId={affairId} path={path} readOnly={readOnly} /></>}</>;
}

function AffairSecondLevel({ collapsed, label, children }: { collapsed: boolean; label: string; children: ReactNode }) {
  return collapsed ? <details className="min-w-0"><summary className="cursor-pointer text-[13px] text-muted-foreground">{label}</summary><div className="pt-4">{children}</div></details> : <>{children}</>;
}
