import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { JSONUIProvider, Renderer, defineRegistry, type Components } from "@json-render/react";
import { shadcnComponents as shadcn } from "@json-render/shadcn";
import type { Spec } from "@json-render/core";
import { useI18n } from "@chrona/i18n";
import { Button, Checkbox, MarkdownContent } from "@shared/ui";
import type { StewardClient } from "../model/client";
import type { PanelBlock } from "@chrona/domain/steward/markdown";
import { FilePanel } from "./file-panel";
import { safeUiPath, uiCatalog } from "@chrona/ui-catalog";
import { pageTasks, recordUiEvent } from "../model/ui-page";
import { pageHref } from "../model/workspace";
import { pageName } from "../model/affair-file";
import { useStewardResource } from "../hooks/use-steward";
import { ResourceStatus } from "./resource-status";

type PageContext = { client: StewardClient; affairId: string; readOnly: boolean; refresh: () => void; path?: string };
const Page = createContext<PageContext | null>(null);
// json-render skips registry actions without a setState; Chrona actions never write page state.
const keepState = () => {};
const usePage = () => { const page = useContext(Page); if (!page) throw new Error("Generated page outside its affair"); return page; };

function TaskList({ props }: { props: { path: string; section: string | null; title: string | null; showProgress: boolean | null } }) {
  const { client, affairId, readOnly } = usePage();
  const file = useStewardResource(useCallback((signal?: AbortSignal) => client.file(affairId, props.path, signal), [client, affairId, props.path]));
  const [pending, setPending] = useState(false);
  // Show the tick at once; the page file stays the source of truth once it is re-read.
  const [optimistic, setOptimistic] = useState<Record<number, boolean>>({});
  useEffect(() => setOptimistic({}), [file.data]);
  const tasks = file.data ? pageTasks(file.data.content, props.section).map(task => ({ ...task, checked: optimistic[task.line] ?? task.checked })) : [];
  const done = tasks.filter(task => task.checked).length;
  const toggle = async (line: number, checked: boolean) => {
    if (!file.data) return;
    setOptimistic(previous => ({ ...previous, [line]: checked }));
    setPending(true);
    try { await client.toggleCheckbox(affairId, { path: props.path, line, checked, baseRevision: file.data.revision }); recordUiEvent(client, affairId, { kind: "toggle", path: props.path }); file.refresh(); }
    catch { setOptimistic(({ [line]: _failed, ...rest }) => rest); }
    finally { setPending(false); }
  };
  return <section className="grid min-w-0 gap-2" aria-label={props.title ?? pageName(props.path)}>
    {(props.title || props.showProgress) && <header className="flex items-baseline gap-2">{props.title && <h3 className="font-medium">{props.title}</h3>}{props.showProgress && <span className="ml-auto text-xs tabular-nums text-muted-foreground">{done} / {tasks.length}</span>}</header>}
    {props.showProgress && tasks.length > 0 && <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(done / tasks.length) * 100}%` }} /></div>}
    <ResourceStatus resource={file} />
    <ul className="grid">{tasks.map(task => <li key={task.line} className="flex min-w-0 items-start gap-2.5 border-t py-2 first:border-0">
      <Checkbox className="mt-1" aria-label={task.text} checked={task.checked} disabled={readOnly || pending} onCheckedChange={value => void toggle(task.line, value === true)} />
      <TaskText text={task.text} checked={task.checked} />
    </li>)}</ul>
  </section>;
}
function TaskText({ text, checked }: { text: string; checked: boolean }) {
  const { affairId } = usePage();
  const { locale } = useI18n();
  const navigate = useNavigate();
  return <div className={checked ? "text-muted-foreground line-through decoration-border" : ""} onClick={event => {
    const anchor = (event.target as HTMLElement).closest("a");
    const href = anchor?.getAttribute("href");
    if (href && safeUiPath(href) && !/^[a-z][a-z\d+.-]*:/i.test(href)) {
      event.preventDefault();
      navigate(pageHref(locale, affairId, decodeURI(href)));
    }
  }}><MarkdownContent>{text}</MarkdownContent></div>;
}
function Panel({ props }: { props: PanelBlock }) {
  const { client, affairId, readOnly, path } = usePage();
  return <FilePanel spec={props} client={client} affairId={affairId} readOnly={readOnly} onSubmit={() => recordUiEvent(client, affairId, { kind: "action", path: path ?? props.data, name: "panel" })} />;
}
function PageLink({ props }: { props: { label: string; path: string; hint: string | null } }) {
  const { affairId } = usePage();
  const { locale } = useI18n();
  return <Link className="group grid gap-0.5 text-primary" to={pageHref(locale, affairId, props.path)}><span className="group-hover:underline">{props.label} ›</span>{props.hint && <span className="text-xs text-muted-foreground">{props.hint}</span>}</Link>;
}
function Upload({ props }: { props: { label: string; folder: string; note: string | null } }) {
  const { client, affairId, readOnly, refresh } = usePage();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const upload = async (files: File[]) => {
    if (!files.length) return;
    setPending(true);
    try {
      for (const file of files) await client.upload(affairId, file, props.folder);
      await client.chat({ affairId, text: `${props.note ?? props.label}：${files.map(file => file.name).join("、")}` });
      refresh();
    } finally { setPending(false); }
  };
  if (readOnly) return null;
  return <div><Button disabled={pending} onClick={() => input.current?.click()}>{props.label}</Button><input ref={input} type="file" multiple hidden aria-label={props.label} onChange={event => { void upload(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></div>;
}

const textClass: Record<string, string> = { caption: "text-xs", muted: "text-sm text-muted-foreground", lead: "text-lg text-muted-foreground", code: "font-mono text-sm" };
/** Text and table cells render Markdown so the Provider can link sources and keep line breaks. */
function Text({ props }: { props: { text: string; variant?: string | null } }) {
  return <MarkdownContent className={`min-w-0 [overflow-wrap:anywhere] ${textClass[props.variant ?? ""] ?? ""}`}>{keepLineBreaks(props.text)}</MarkdownContent>;
}
/** Providers write plain line breaks; Markdown would join them into one paragraph. */
const keepLineBreaks = (text: string) => text.replace(/([^\n])\n(?!\n|\s*[-*+] |\s*\d+\. )/g, "$1  \n");
function Table({ props }: { props: { columns: string[]; rows: string[][]; caption?: string | null } }) {
  // Narrow screens: each row becomes a small card with column labels instead of a sideways-scrolling grid.
  return <div className="w-full min-w-0 max-w-full overflow-x-auto rounded-[10px] border bg-card [contain:inline-size]"><table className="w-full border-collapse text-sm max-sm:block">
    {props.caption && <caption className="p-2 text-left text-xs text-muted-foreground max-sm:block">{props.caption}</caption>}
    <thead className="max-sm:hidden"><tr>{props.columns.map((column, index) => <th key={index} scope="col" className="border-b px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground">{column}</th>)}</tr></thead>
    <tbody className="max-sm:block">{props.rows.map((row, rowIndex) => <tr key={rowIndex} className="border-b last:border-0 max-sm:grid max-sm:gap-1 max-sm:px-3 max-sm:py-2.5">{row.map((cell, index) => <td key={index} className="px-3 py-2 align-top tabular-nums [overflow-wrap:anywhere] max-sm:flex max-sm:gap-2 max-sm:p-0 [&_p]:m-0">
      <span aria-hidden="true" className="hidden shrink-0 text-xs text-muted-foreground max-sm:inline max-sm:min-w-16">{props.columns[index]}</span><MarkdownContent>{cell}</MarkdownContent>
    </td>)}</tr>)}</tbody>
  </table></div>;
}

const generic: Partial<Components<typeof uiCatalog>> = {
  Card: shadcn.Card, Stack: shadcn.Stack, Grid: shadcn.Grid, Separator: shadcn.Separator, Tabs: shadcn.Tabs, Accordion: shadcn.Accordion,
  Collapsible: shadcn.Collapsible, Table, Heading: shadcn.Heading, Text, Link: shadcn.Link, Badge: shadcn.Badge, Alert: shadcn.Alert,
  Progress: shadcn.Progress, Input: shadcn.Input, Textarea: shadcn.Textarea, Select: shadcn.Select, Radio: shadcn.Radio, Button: shadcn.Button,
};

/** Renders a page the Provider composed from the catalog (`*.ui.json`); actions go through Chrona. */
export function GeneratedPage({ spec, client, affairId, readOnly, refresh, path }: PageContext & { spec: unknown; path?: string }) {
  const { locale } = useI18n();
  const navigate = useNavigate();
  const valid = uiCatalog.validate(spec);
  const opened = useRef(false);
  useEffect(() => {
    if (valid.success && path && !opened.current) {
      opened.current = true;
      recordUiEvent(client, affairId, { kind: "open", path });
    }
  }, [valid.success, path, client, affairId]);
  const { registry, handlers } = useMemo(() => defineRegistry(uiCatalog, {
    components: { ...generic, TaskList, PageLink, Upload, Panel } as Components<typeof uiCatalog>,
    actions: {
      say: async params => { if (params && !readOnly) { if (path) recordUiEvent(client, affairId, { kind: "action", path, name: "say" }); await client.chat({ affairId, text: params.text }); refresh(); } },
      open: async params => { if (params) { if (path) recordUiEvent(client, affairId, { kind: "action", path, name: "open" }); navigate(pageHref(locale, affairId, params.path)); } },
    },
  }), [client, affairId, readOnly, refresh, navigate, locale, path]);
  const state = useRef<Record<string, unknown>>({});
  if (!valid.success) return <p role="alert">{valid.error?.issues[0]?.message ?? "Invalid page"}</p>;
  // Render the checked original: json-render 0.21's catalog.validate output drops elements' `on` bindings.
  const page = spec as Spec;
  return <Page.Provider value={{ client, affairId, readOnly, refresh, path }}>
    <div className="min-w-0 text-[13px] [overflow-wrap:anywhere] [&_input]:h-8 [&_button[data-slot=button]]:h-8 [&_button[data-slot=button]]:rounded-md [&_button[data-slot=button]]:px-3 [&_button[data-slot=button]]:text-[13px] [&_[data-slot=card]]:gap-3 [&_[data-slot=card]]:py-3.5 [&_[data-slot=card-content]]:px-3.5 [&_[data-slot=card-header]]:px-3.5">
    <JSONUIProvider registry={registry} initialState={page.state ?? {}} handlers={handlers(() => keepState, () => state.current)}>
      <Renderer spec={page} registry={registry} />
    </JSONUIProvider>
    </div>
  </Page.Provider>;
}
