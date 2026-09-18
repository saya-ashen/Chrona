import { Component, createContext, useContext, useMemo, type ReactNode } from "react";
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import { useI18n } from "@chrona/i18n";
import { workPageCatalog, workPageSchema, calculatePageMetric, type WorkPage } from "@chrona/ui-protocol";
import type { PageInputsView } from "@chrona/contracts";
import type { PageScope } from "../model/client";
import { PageDatasetView } from "./page-dataset";
import { PageFormEditor } from "./page-form";

type Runtime = { page: WorkPage; scope: PageScope; versionId: string; inputs: PageInputsView | null; readOnly: boolean; onSaved: () => void };
const PageContext = createContext<Runtime | null>(null);
function usePage() { const page = useContext(PageContext); if (!page) throw new Error("Page context required"); return page; }
const { registry } = defineRegistry(workPageCatalog, {
  components: {
    Section: ({ props, children }) => {
      const body = <div className={props.layout === "columns" ? "grid min-w-0 gap-6 md:grid-cols-2" : "min-w-0 space-y-7"}>{children}</div>;
      return props.collapsed ? <details className="min-w-0 rounded-xl border p-4"><summary className="cursor-pointer font-medium">{props.title}{props.summary && <span className="mt-1 block text-sm font-normal text-muted-foreground">{props.summary}</span>}</summary><div className="mt-5">{body}</div></details>
        : <section className="min-w-0 space-y-4">{props.title && <h2 className="text-xl font-semibold">{props.title}</h2>}{props.summary && <p className="text-sm text-muted-foreground">{props.summary}</p>}{body}</section>;
    },
    Text: ({ props }) => <p className={`whitespace-pre-wrap [overflow-wrap:anywhere] ${props.tone === "muted" ? "text-sm text-muted-foreground" : props.tone === "lead" ? "text-lg leading-relaxed" : "leading-relaxed"}`}>{props.text}</p>,
    Callout: ({ props }) => <aside className={`space-y-2 rounded-xl border-l-4 p-4 ${props.tone === "attention" ? "border-amber-500 bg-amber-500/5" : "border-primary bg-primary/5"}`}><h2 className="font-semibold">{props.title}</h2><p className="whitespace-pre-wrap text-sm leading-relaxed">{props.text}</p></aside>,
    Table: ({ props }) => <PageDatasetView data={usePage().page.datasets[props.dataset]} title={props.title} searchable={props.searchable} />,
    Comparison: ({ props }) => <PageDatasetView data={usePage().page.datasets[props.dataset]} title={props.title} searchable={false} comparison />,
    Metric: ({ props }) => { const { locale } = useI18n(); const value = calculatePageMetric(usePage().page.datasets[props.dataset], props.calculation, props.column); return <div><p className="text-sm text-muted-foreground">{props.label}</p><p className="mt-1 text-3xl font-semibold tracking-tight">{value === null ? "—" : new Intl.NumberFormat(locale).format(value)}<span className="ml-1 text-base font-normal">{props.suffix}</span></p></div>; },
    Link: ({ props }) => <div><a href={props.href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">{props.label} ↗</a>{props.description && <p className="mt-1 text-sm text-muted-foreground">{props.description}</p>}</div>,
    Form: ({ props }) => {
      const ctx = usePage(), c = useI18n().messages.workPages;
      return ctx.inputs ? <PageFormEditor key={`${ctx.versionId}:${props.form}`} form={ctx.page.forms[props.form]} formKey={props.form} scope={ctx.scope} versionId={ctx.versionId} inputs={ctx.inputs} readOnly={ctx.readOnly} onSaved={ctx.onSaved} /> : <p role="status">{c.inputLoading}</p>;
    },
  },
});
class PageBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
export function WorkPageRenderer({ page, scope, versionId, inputs, readOnly = false, onSaved = () => {} }: Omit<Runtime, "page" | "onSaved" | "readOnly"> & { page: unknown; readOnly?: boolean; onSaved?: () => void }) {
  const c = useI18n().messages.workPages;
  const parsed = useMemo(() => workPageSchema.safeParse(page), [page]);
  const fallback = <p role="alert">{c.pageFallback}</p>;
  if (!parsed.success) return fallback;
  return <PageBoundary key={versionId} fallback={fallback}><PageContext.Provider value={{ page: parsed.data, scope, versionId, inputs, readOnly, onSaved }}>
    <div className="min-w-0 break-words [overflow-wrap:anywhere]" data-ui-surface-kind="ai-authored">
      <JSONUIProvider registry={registry} initialState={{}} handlers={{}}><Renderer spec={{ root: parsed.data.root, elements: parsed.data.elements }} registry={registry} /></JSONUIProvider>
    </div>
  </PageContext.Provider></PageBoundary>;
}
