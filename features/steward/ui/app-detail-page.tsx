import { Link, useParams, useSearchParams } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import { Input } from "@shared/ui";
import { useApp } from "../hooks/use-app";
import { pageHref } from "../model/workspace";
import { fileTree, pageName, type FileBranch } from "../model/app-file";
import { selectedPage } from "../model/ui-page";
import { PageColumn } from "./layout";
import { MutationStatus, ResourceStatus } from "./resource-status";
import { AppFileView } from "./app-file-view";

export function FileTree({ nodes, selected, appId }: { nodes: FileBranch[]; selected: string; appId: string }) {
  const { locale } = useI18n();
  return <ul className="grid min-w-0 gap-1">{nodes.map(node => <li key={node.path} className="min-w-0 break-all">{node.directory
    ? <details><summary className="cursor-pointer text-sm">{node.name}</summary><div className="pl-3"><FileTree nodes={node.children} selected={selected} appId={appId} /></div></details>
    : <Link className="block rounded px-2 py-1 text-sm hover:bg-muted" aria-current={selected === node.path ? "page" : undefined} to={pageHref(locale, appId, node.path)}>{pageName(node.name)}</Link>}</li>)}</ul>;
}

export function AppDetailPage() {
  const { appId = "" } = useParams();
  const [search] = useSearchParams();
  const { messages, locale } = useI18n(), c = messages.steward;
  const app = useApp(appId, search.get("path") ?? "");
  const path = selectedPage(app.app?.entry, search.get("path"));
  return <PageColumn>
    <Link className="text-sm underline" to={`/${locale}/apps`}>{c.apps.title}</Link>
    <h1 className="text-2xl font-semibold">{app.app?.name ?? appId}</h1>
    <ResourceStatus resource={app.apps} />
    {app.apps.data && !app.app && <p role="alert">{c.appFile.notFound}</p>}
    {app.app && (!app.app.content ? <p>{c.apps.noContent}</p> : <>
      <p className="text-sm text-muted-foreground">{app.app.description}</p>
      <label className="grid gap-2">{c.appActions.upload}<Input type="file" multiple disabled={app.mutation.pending} onChange={event => { void app.upload(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></label>
      <MutationStatus mutation={app.mutation} />
      <div className="grid min-w-0 gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label={c.appFile.pages} className="grid min-w-0 content-start gap-1"><ResourceStatus resource={app.tree} />
          <FileTree nodes={fileTree(app.tree.data?.items ?? [])} selected={path} appId={appId} />
          {app.tree.data?.items.length === 0 && <p>{c.appFile.empty}</p>}
        </nav>
        <AppFileView key={`${appId}:${path}`} client={app.client} appId={appId} path={path} refresh={app.refresh} refreshVersion={app.tree.data?.items.find(node => node.path === path)?.updatedAt} />
      </div>
    </>)}
  </PageColumn>;
}
