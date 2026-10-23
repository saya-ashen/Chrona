import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { JSONUIProvider, Renderer, defineRegistry, type Components } from "@json-render/react";
import { shadcnComponents as shadcn } from "@json-render/shadcn";
import type { Spec } from "@json-render/core";
import { useI18n } from "@chrona/i18n";
import { Alert, AlertDescription, Button, Checkbox, MarkdownContent, Table as DataTable, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow, cn } from "@shared/ui";
import { StewardClientError, type StewardClient } from "../model/client";
import type { PanelBlock } from "@chrona/domain";
import { FilePanel } from "./file-panel";
import { uiCatalog } from "@chrona/ui-catalog";
import { compactUiTable, pageTasks, recordUiEvent } from "../model/ui-page";
import { pageHref } from "../model/workspace";
import { pageName } from "../model/app-file";
import { useStewardResource } from "../hooks/use-steward";
import { useGeneratedState } from "../hooks/use-generated-state";
import { ResourceStatus } from "./resource-status";
import { useAppMarkdown } from "./app-markdown";

type PageContext = { client: StewardClient; appId: string; sessionId?: string; readOnly: boolean; refresh: () => void; path?: string; refreshVersion?: string };
const Page = createContext<PageContext | null>(null);
// json-render skips registry actions without a setState; Chrona actions never write page state.
const keepState = () => {};
const emptyState = {};
const usePage = () => { const page = useContext(Page); if (!page) throw new Error("Generated page outside its app"); return page; };

function TaskList({ props }: { props: { path: string; section: string | null; title: string | null; showProgress: boolean | null } }) {
  const { client, appId, readOnly, refreshVersion } = usePage();
  const c = useI18n().messages.steward.appFile;
  const [notice, setNotice] = useState<"conflict" | "error" | null>(null);
  const file = useStewardResource(useCallback((signal?: AbortSignal) => client.file(appId, props.path, signal), [client, appId, props.path]), false, refreshVersion);
  const [pending, setPending] = useState(false);
  // Show the tick at once; the page file stays the source of truth once it is re-read.
  const [optimistic, setOptimistic] = useState<Record<number, boolean>>({});
  useEffect(() => setOptimistic({}), [file.data]);
  const tasks = file.data ? pageTasks(file.data.content, props.section).map(task => ({ ...task, checked: optimistic[task.line] ?? task.checked })) : [];
  const done = tasks.filter(task => task.checked).length;
  const toggle = async (line: number, checked: boolean) => {
    if (!file.data) return;
    setOptimistic(previous => ({ ...previous, [line]: checked }));
    setPending(true); setNotice(null);
    try { await client.toggleCheckbox(appId, { path: props.path, line, checked, baseRevision: file.data.revision }); recordUiEvent(client, appId, { kind: "toggle", path: props.path }); file.refresh(); }
    catch (error) {
      setOptimistic(({ [line]: _failed, ...rest }) => rest);
      const conflict = error instanceof StewardClientError && error.status === 409;
      setNotice(conflict ? "conflict" : "error");
      if (conflict) file.refresh();
    }
    finally { setPending(false); }
  };
  return <section className="grid min-w-0 gap-2" aria-label={props.title ?? pageName(props.path)}>
    {(props.title || props.showProgress) && <header className="flex items-baseline gap-2">{props.title && <h3 className="font-medium">{props.title}</h3>}{props.showProgress && <span className="ml-auto text-xs tabular-nums text-muted-foreground">{done} / {tasks.length}</span>}</header>}
    {props.showProgress && tasks.length > 0 && <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(done / tasks.length) * 100}%` }} /></div>}
    <ResourceStatus resource={file} />
    {notice && <Alert variant="destructive"><AlertDescription>{c[notice]}</AlertDescription></Alert>}
    <ul className="grid">{tasks.map(task => <li key={task.line} className="flex min-w-0 items-start gap-2.5 border-t py-2 first:border-0">
      <Checkbox className="mt-1" aria-label={task.text} checked={task.checked} disabled={readOnly || pending || file.loading} onCheckedChange={value => void toggle(task.line, value === true)} />
      <TaskText text={task.text} checked={task.checked} pagePath={props.path} />
    </li>)}</ul>
  </section>;
}
function TaskText({ text, checked, pagePath }: { text: string; checked: boolean; pagePath: string }) {
  return <div className={checked ? "text-muted-foreground line-through decoration-border" : ""}><GeneratedMarkdown pagePath={pagePath}>{text}</GeneratedMarkdown></div>;
}
function GeneratedMarkdown({ children, className, pagePath }: { children: string; className?: string; pagePath?: string }) {
  const { client, appId, path, refreshVersion } = usePage();
  const components = useAppMarkdown(client, appId, pagePath ?? path ?? "README.md", refreshVersion);
  return <MarkdownContent className={className} components={components}>{children}</MarkdownContent>;
}
function Panel({ props }: { props: PanelBlock }) {
  const { client, appId, readOnly, path } = usePage();
  return <FilePanel spec={props} client={client} appId={appId} readOnly={readOnly} onSubmit={() => recordUiEvent(client, appId, { kind: "action", path: path ?? props.data, name: "panel" })} />;
}
function PageLink({ props }: { props: { label: string; path: string; hint: string | null } }) {
  const { appId } = usePage();
  const { locale } = useI18n();
  return <Link className="group grid gap-0.5 text-primary" to={pageHref(locale, appId, props.path)}><span className="group-hover:underline">{props.label} ›</span>{props.hint && <span className="text-xs text-muted-foreground">{props.hint}</span>}</Link>;
}
function Upload({ props }: { props: { label: string; folder: string; note: string | null } }) {
  const { client, appId, readOnly, refresh } = usePage();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const upload = async (files: File[]) => {
    if (!files.length) return;
    setPending(true);
    try {
      for (const file of files) await client.upload(appId, file, props.folder);
      refresh();
    } finally { setPending(false); }
  };
  if (readOnly) return null;
  return <div><Button disabled={pending} onClick={() => input.current?.click()}>{props.label}</Button><input ref={input} type="file" multiple hidden aria-label={props.label} onChange={event => { void upload(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></div>;
}

const textClass: Record<string, string> = { caption: "text-xs", muted: "text-sm text-muted-foreground", lead: "text-lg text-muted-foreground", code: "font-mono text-sm" };
/** Text and table cells render Markdown so the Provider can link sources and keep line breaks. */
function Text({ props }: { props: { text: string; variant?: string | null } }) {
  return <GeneratedMarkdown className={`min-w-0 [overflow-wrap:anywhere] ${textClass[props.variant ?? ""] ?? ""}`}>{keepLineBreaks(props.text)}</GeneratedMarkdown>;
}
/** Providers write plain line breaks; Markdown would join them into one paragraph. */
const keepLineBreaks = (text: string) => text.replace(/([^\n])\n(?!\n|\s*[-*+] |\s*\d+\. )/g, "$1  \n");
function MarkdownTable({ props }: { props: { columns: string[]; rows: string[][]; caption?: string | null } }) {
  const stacked = !compactUiTable(props.columns, props.rows);
  return <div className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border bg-card [contain:inline-size]">
    <DataTable className={cn("table-fixed border-collapse caption-top", stacked && "max-sm:block")}>
      {props.caption && <TableCaption className="m-0 p-2 text-left text-xs">{props.caption}</TableCaption>}
      <TableHeader className={stacked ? "max-sm:hidden" : undefined}><TableRow>{props.columns.map((column, index) => <TableHead key={index} scope="col" className="px-2 py-2 text-xs whitespace-normal [overflow-wrap:anywhere] text-muted-foreground">{column}</TableHead>)}</TableRow></TableHeader>
      <TableBody className={stacked ? "max-sm:block" : undefined}>{props.rows.map((row, rowIndex) => <TableRow key={rowIndex} className={cn(stacked && "max-sm:grid max-sm:gap-1 max-sm:px-3 max-sm:py-2.5")}>{row.map((cell, index) => <TableCell key={index} className={cn("px-2 py-2 align-top whitespace-normal tabular-nums [overflow-wrap:anywhere] [&_p]:m-0", stacked && "max-sm:flex max-sm:gap-2 max-sm:p-0")}>
        {stacked && <span aria-hidden="true" className="hidden shrink-0 text-xs text-muted-foreground max-sm:inline max-sm:min-w-16">{props.columns[index]}</span>}
        <GeneratedMarkdown className="p-0 text-[13px] leading-5">{cell}</GeneratedMarkdown>
      </TableCell>)}</TableRow>)}</TableBody>
    </DataTable>
  </div>;
}

const generic: Partial<Components<typeof uiCatalog>> = {
  Card: shadcn.Card, Stack: shadcn.Stack, Grid: shadcn.Grid, Separator: shadcn.Separator, Tabs: shadcn.Tabs, Accordion: shadcn.Accordion,
  Collapsible: shadcn.Collapsible, Table: MarkdownTable, Heading: shadcn.Heading, Text, Link: shadcn.Link, Badge: shadcn.Badge, Alert: shadcn.Alert,
  Progress: shadcn.Progress, Input: shadcn.Input, Textarea: shadcn.Textarea, Select: shadcn.Select, Radio: shadcn.Radio, Button: shadcn.Button,
};

/** Renders a page the Provider composed from the catalog (`*.ui.json`); actions go through Chrona. */
export function GeneratedPage({ spec, client, appId, sessionId, readOnly, refresh, path, refreshVersion }: PageContext & { spec: unknown; path?: string }) {
  const { locale } = useI18n();
  const navigate = useNavigate();
  const valid = uiCatalog.validate(spec);
  const opened = useRef(false);
  useEffect(() => {
    if (valid.success && path && !opened.current) {
      opened.current = true;
      recordUiEvent(client, appId, { kind: "open", path });
    }
  }, [valid.success, path, client, appId]);
  const { registry, handlers } = useMemo(() => defineRegistry(uiCatalog, {
    components: { ...generic, TaskList, PageLink, Upload, Panel } as unknown as Components<typeof uiCatalog>,
    actions: {
      say: async params => { if (params && !readOnly) { await client.uiEvent(appId, { kind: "feedback", path: path ?? "README.md", name: "say", text: params.text }); refresh(); } },
      open: async params => { if (params) { if (path) recordUiEvent(client, appId, { kind: "action", path, name: "open" }); navigate(pageHref(locale, appId, params.path)); } },
    },
  }), [client, appId, sessionId, readOnly, refresh, navigate, locale, path]);
  const state = useGeneratedState(valid.success ? (spec as Spec).state ?? emptyState : emptyState);
  if (!valid.success) return <p role="alert">{valid.error?.issues[0]?.message ?? "Invalid page"}</p>;
  // Render the checked original: json-render 0.21's catalog.validate output drops elements' `on` bindings.
  const page = spec as Spec;
  return <Page.Provider value={{ client, appId, sessionId, readOnly, refresh, path, refreshVersion }}>
    <div className="min-w-0 text-[13px] [overflow-wrap:anywhere] [&_input]:h-8 [&_button[data-slot=button]]:h-8 [&_button[data-slot=button]]:rounded-md [&_button[data-slot=button]]:px-3 [&_button[data-slot=button]]:text-[13px] [&_[data-slot=card]]:gap-3 [&_[data-slot=card]]:py-3.5 [&_[data-slot=card-content]]:px-3.5 [&_[data-slot=card-header]]:px-3.5">
    <JSONUIProvider registry={registry} store={state} handlers={handlers(() => keepState, state.getSnapshot)}>
      <Renderer spec={page} registry={registry} />
    </JSONUIProvider>
    </div>
  </Page.Provider>;
}
