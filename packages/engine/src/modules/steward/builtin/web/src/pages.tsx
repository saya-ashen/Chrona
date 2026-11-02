// A page an app registered (module-dependency-direction §4), rendered with json-render in this page's own style.
// Built into /pages.js and loaded only when such a page opens; data and actions call only the registering app's tools.
import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { JSONUIProvider, Renderer, defineRegistry, useBoundProp, type ComponentRenderProps } from "@json-render/react";
import { createStateStore, type Spec, type StateStore } from "@json-render/core";
import { catalog } from "../catalog";

type Args = Record<string, unknown>;
type Source = { tool: string; args?: Args; refresh?: number };
export type Page = { module: string; id: string; title: string; data: Record<string, Source>; spec: Spec; keyed?: string[]; needs?: Record<string, string[]> };
export type Deps = { call: (target: string, args: Args) => Promise<unknown>; navigate: (path: string) => void };
type Feedback = { failed: boolean; text: string; source?: string } | null;

const record = (value: unknown): value is Args => !!value && typeof value === "object" && !Array.isArray(value);
/** `{ $state: "/path" }` anywhere in tool arguments reads the page state at call time. */
export function resolve(value: unknown, store: Pick<StateStore, "get">): unknown {
  if (Array.isArray(value)) return value.map(item => resolve(item, store));
  if (!record(value)) return value;
  if (typeof value.$state === "string" && Object.keys(value).length === 1) return store.get(value.$state);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, store)]));
}
/** Apps answer some failures as `{ error: { message } }` results rather than call errors. */
export function failure(result: unknown) {
  if (!record(result) || result.error === undefined || result.error === null) return null;
  return record(result.error) ? String(result.error.message ?? result.error.code ?? "操作失败") : String(result.error);
}

type Props<P> = ComponentRenderProps<P> & { props: P; bindings?: Record<string, string> };
const text = (value: unknown) => value == null ? "" : String(value);
function Field({ label, children }: { label?: string; children: ReactNode }) {
  return <label>{label ? <strong>{label} </strong> : null}{children}</label>;
}
function Bound({ name, value, binding, kind, element }: { name: string; value: unknown; binding?: string; kind: "input" | "textarea"; element: Args }) {
  const [bound, setBound] = useBoundProp<string>(value as string | undefined, binding);
  const [local, setLocal] = useState(text(value));
  const current = binding ? text(bound) : local, set = binding ? setBound : setLocal;
  return kind === "textarea"
    ? <textarea name={name} rows={Number(element.rows ?? 4)} placeholder={text(element.placeholder)} value={current} onChange={event => set(event.target.value)} />
    : <input name={name} type={text(element.type) || "text"} placeholder={text(element.placeholder)} value={current} onChange={event => set(event.target.value)} />;
}
function Toggle({ props, bindings, emit }: Props<{ label: string; name: string; checked?: boolean | null }>) {
  const [checked, setChecked] = useBoundProp<boolean>(props.checked ?? undefined, bindings?.checked);
  return <label className="check"><input type="checkbox" name={props.name} checked={!!checked} onChange={event => { setChecked(event.target.checked); emit("change"); }} />{props.label}</label>;
}
// The same Markdown subset app.js draws: escaped first, then only links, bold and code inline.
const inline = (line: string) => line.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
  .replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
export function Markdown({ props }: Props<{ content: string }>) {
  const blocks: ReactNode[] = [];
  let list: ReactNode[] | null = null, fence: string[] | null = null;
  const html = (value: string) => ({ dangerouslySetInnerHTML: { __html: inline(value) } });
  text(props.content).split("\n").forEach((line, i) => {
    if (fence) { if (line.startsWith("```")) { blocks.push(<pre key={i}>{fence.join("\n")}</pre>); fence = null; } else fence.push(line); return; }
    if (line.startsWith("```")) { fence = []; list = null; return; }
    const task = /^\s*[-*] \[( |x|X)\] (.*)$/.exec(line), item = /^\s*[-*] (.*)$/.exec(line), heading = /^(#{1,6}) (.*)$/.exec(line);
    if (task || item) {
      if (!list) { list = []; blocks.push(<ul key={i}>{list}</ul>); }
      list.push(task ? <li key={i} className="task"><input type="checkbox" checked={task[1] !== " "} disabled style={{ width: "auto" }} /> <span {...html(task[2]!)} /></li> : <li key={i} {...html(item![1]!)} />);
      return;
    }
    list = null;
    if (heading) blocks.push(heading[1]!.length < 3 ? <h3 key={i} {...html(heading[2]!)} /> : <h4 key={i} {...html(heading[2]!)} />);
    else if (line.trim()) blocks.push(<p key={i} {...html(line)} />);
  });
  if (fence) blocks.push(<pre key="end">{(fence as string[]).join("\n")}</pre>);
  return <div className="markdown">{blocks}</div>;
}
const gap = (value?: string | null) => ({ none: "0", sm: ".4rem", md: ".6rem", lg: ".9rem", xl: "1.4rem" })[value ?? "md"] ?? ".6rem";

/** Only what this page draws in its own style is offered; the catalog's other components render as a notice. */
const { registry } = defineRegistry(catalog, {
  components: {
    Card: ({ props, children }: Props<{ title?: string | null; description?: string | null }>) => <section>{props.title ? <h2>{props.title}</h2> : null}{props.description ? <p className="muted">{props.description}</p> : null}{children}</section>,
    Stack: ({ props, children }: Props<{ direction?: string | null; gap?: string | null; align?: string | null }>) => <div style={{ display: "flex", flexDirection: props.direction === "horizontal" ? "row" : "column", flexWrap: props.direction === "horizontal" ? "wrap" : undefined, gap: gap(props.gap), alignItems: props.align ?? undefined }}>{children}</div>,
    Grid: ({ props, children }: Props<{ columns?: number | null; gap?: string | null }>) => <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${Math.max(8, 48 / (props.columns ?? 2))}rem), 1fr))`, gap: gap(props.gap) }}>{children}</div>,
    Separator: () => <hr style={{ border: 0, borderTop: "1px solid var(--line)", width: "100%" }} />,
    Heading: ({ props }: Props<{ text: string; level?: string | null }>) => props.level === "h1" || props.level === "h2" || !props.level ? <h2>{props.text}</h2> : <h3>{props.text}</h3>,
    Text: ({ props }: Props<{ text: string; variant?: string | null }>) => <p className={props.variant === "muted" || props.variant === "caption" ? "muted" : undefined} style={{ margin: ".2rem 0", whiteSpace: "pre-wrap" }}>{text(props.text)}</p>,
    Badge: ({ props }: Props<{ text: string; variant?: string | null }>) => <span className={`level ${props.variant === "destructive" ? "red" : props.variant === "secondary" || props.variant === "outline" ? "" : "green"}`}>{props.text}</span>,
    Alert: ({ props }: Props<{ title: string; message?: string | null; type?: string | null }>) => <div role={props.type === "error" ? "alert" : "status"} className={props.type === "error" ? "error" : props.type === "success" ? "ok" : undefined}><strong>{props.title}</strong>{props.message ? <div>{props.message}</div> : null}</div>,
    Table: ({ props }: Props<{ columns: string[]; rows: unknown[][]; caption?: string | null }>) => <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>{props.caption ? <caption className="muted">{props.caption}</caption> : null}<thead><tr>{(props.columns ?? []).map(column => <th key={column} style={{ textAlign: "left", borderBottom: "1px solid var(--line)", padding: ".3rem" }}>{column}</th>)}</tr></thead><tbody>{(props.rows ?? []).map((row, i) => <tr key={i}>{(Array.isArray(row) ? row : []).map((cell, j) => <td key={j} style={{ borderBottom: "1px solid var(--line)", padding: ".3rem" }}>{text(cell)}</td>)}</tr>)}</tbody></table></div>,
    Button: ({ props, emit }: Props<{ label: string; variant?: string | null; disabled?: boolean | null }>) => <button type="button" className={props.variant === "secondary" ? undefined : props.variant === "danger" ? "danger" : "primary"} disabled={!!props.disabled} onClick={() => emit("press")}>{props.label}</button>,
    Link: ({ props, on }: Props<{ label: string; href: string }>) => <a href={props.href} onClick={event => { const press = on("press"); if (press.bound) { event.preventDefault(); press.emit(); } }}>{props.label}</a>,
    Input: ({ props, bindings }: Props<{ label: string; name: string; value?: string | null }>) => <Field label={props.label}><Bound kind="input" name={props.name} value={props.value} binding={bindings?.value} element={props as Args} /></Field>,
    Textarea: ({ props, bindings }: Props<{ label: string; name: string; value?: string | null }>) => <Field label={props.label}><Bound kind="textarea" name={props.name} value={props.value} binding={bindings?.value} element={props as Args} /></Field>,
    Select: ({ props, bindings, emit }: Props<{ label: string; name: string; options: unknown[]; value?: string | null; placeholder?: string | null }>) => {
      const [value, setValue] = useBoundProp<string>(props.value ?? undefined, bindings?.value);
      return <Field label={props.label}><select name={props.name} value={text(value)} onChange={event => { setValue(event.target.value); emit("change"); }}>{props.placeholder ? <option value="">{props.placeholder}</option> : null}{(props.options ?? []).map(option => <option key={text(option)} value={text(option)}>{text(option)}</option>)}</select></Field>;
    },
    Checkbox: Toggle,
    Switch: Toggle,
    Spinner: ({ props }: Props<{ label?: string | null }>) => <p className="muted" role="status">{props.label ?? "加载中……"}</p>,
    Progress: ({ props }: Props<{ value: number; max?: number | null; label?: string | null }>) => <label>{props.label ? <span className="muted">{props.label} </span> : null}<progress value={props.value} max={props.max ?? 100} style={{ width: "100%" }} /></label>,
    Pagination: ({ props, bindings, emit }: Props<{ totalPages: number; page?: number | null }>) => {
      const [page, setPage] = useBoundProp<number>(props.page ?? undefined, bindings?.page), current = page ?? 1;
      const go = (next: number) => { setPage(next); emit("change"); };
      return <div className="row"><button type="button" disabled={current <= 1} onClick={() => go(current - 1)}>上一页</button><span className="muted">第 {current} / {props.totalPages} 页</span><button type="button" disabled={current >= props.totalPages} onClick={() => go(current + 1)}>下一页</button></div>;
    },
    Collapsible: ({ props, children }: Props<{ title: string; defaultOpen?: boolean | null }>) => <details open={!!props.defaultOpen}><summary>{props.title}</summary>{children}</details>,
    Markdown,
  } as never,
  actions: { call: async () => {} },
});
const fallback = ({ element }: ComponentRenderProps) => <p className="muted">（这个网页还不能显示组件 {element.type}）</p>;

export function PageView({ page, deps }: { page: Page; deps: Deps }) {
  const [store] = useState(() => createStateStore({ ...(page.spec.state ?? {}) }));
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const target = (tool: string) => `${page.module}.${tool}`;
  // Each source is read when the page opens, when the state its arguments use changes, and every `refresh` seconds.
  useEffect(() => {
    const last = new Map<string, string>(), timers: ReturnType<typeof setInterval>[] = [];
    let stopped = false;
    const read = async (key: string, source: Source, force = false) => {
      const args = (resolve(source.args ?? {}, store) ?? {}) as Args, signature = JSON.stringify(args);
      if (!force && last.get(key) === signature) return;
      last.set(key, signature);
      if ((page.needs?.[key] ?? []).some(name => args[name] === undefined || args[name] === null || args[name] === "")) return;
      try {
        const result = await deps.call(target(source.tool), args), failed = failure(result);
        if (stopped || last.get(key) !== signature) return;
        if (failed) { setFeedback({ failed: true, text: failed, source: key }); return; }
        store.set(`/${key}`, result);
        setFeedback(current => current?.source === key ? null : current);
      } catch (error) { if (!stopped) setFeedback({ failed: true, text: `读取失败：${(error as Error).message}`, source: key }); }
    };
    const all = (force: boolean) => { for (const [key, source] of Object.entries(page.data)) void read(key, source, force); };
    all(true);
    const unsubscribe = store.subscribe(() => all(false));
    for (const [key, source] of Object.entries(page.data)) if (source.refresh) timers.push(setInterval(() => { if (!document.hidden) void read(key, source, true); }, source.refresh * 1000));
    return () => { stopped = true; unsubscribe(); timers.forEach(clearInterval); };
  }, [page, loadedAt]);
  const handlers = {
    call: async (params: Args) => {
      const tool = String(params.tool), args = { ...(resolve(params.args ?? {}, store) as Args) };
      // A tool that takes a request key gets a fresh one per press, so a retried press is not applied twice by the app.
      if (page.keyed?.includes(tool) && args["request-key"] === undefined) args["request-key"] = crypto.randomUUID();
      setFeedback({ failed: false, text: "处理中……" });
      let result: unknown;
      try { result = await deps.call(target(tool), args); }
      catch (error) { setFeedback({ failed: true, text: (error as Error).message }); throw error; }
      // Thrown, so json-render runs the binding's onError instead of its onSuccess.
      const failed = failure(result);
      if (failed) { setFeedback({ failed: true, text: failed }); throw new Error(failed); }
      if (typeof params.result === "string") store.set(params.result, result);
      setFeedback({ failed: false, text: "已完成" });
      if (params.reload !== false) setLoadedAt(Date.now());
    },
  };
  return <JSONUIProvider registry={registry} store={store} handlers={handlers} navigate={deps.navigate}>
    <div className="registered-page">
      {feedback ? <p role="status" className={feedback.failed ? "error" : "muted"}>{feedback.text}</p> : null}
      <Renderer spec={page.spec} registry={registry} fallback={fallback} />
    </div>
  </JSONUIProvider>;
}

/** Called by app.js: draws `page` into `element`; returns the unmount. */
export function mount(element: HTMLElement, page: Page, deps: Deps) {
  const root = createRoot(element);
  root.render(<PageView page={page} deps={deps} />);
  return () => root.unmount();
}
