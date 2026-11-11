// System and registered app pages share the same json-render components and data lifecycle.
import "./schema-config";
import { Children, createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { JSONUIProvider, Renderer, defineRegistry, useBoundProp, type ComponentRenderProps } from "@json-render/react";
import { createStateStore, type Spec, type StateStore } from "@json-render/core";
import { catalog } from "../catalog";
import { CollapsedText, Time } from "./display";
import { systemCall, type SystemHost } from "./system/adapter";
import { SystemContext } from "./system/action";
import { systemComponents } from "./system/components";
import { systemPage, type SystemParams } from "./system/page";
import { ChatHost } from "./system/chat-stream";
import { registeredDeps, type Page, type Deps, type Source } from "./registered-page";
import { executableRegistry } from "./executable-components";
import { settingsHref, type RegisteredPage } from "./system/registered-pages";
export { registeredDeps } from "./registered-page";
export type { Page, Deps } from "./registered-page";
import { Workspace, WorkspaceHeader, ViewTabs, Composer, Panel, ScrollArea, Message, CodeDiff, ActionOption } from "./workspace";

type Args = Record<string, unknown>;
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
    ? <textarea name={name} disabled={!!element.disabled} rows={Number(element.rows ?? 4)} placeholder={text(element.placeholder)} value={current} onChange={event => set(event.target.value)} />
    : <input name={name} disabled={!!element.disabled} type={text(element.type) || "text"} placeholder={text(element.placeholder)} value={current} onChange={event => set(event.target.value)} />;
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
  if (fence as string[] | null) blocks.push(<pre key="end">{(fence as string[] | null)!.join("\n")}</pre>);
  return <div className="markdown">{blocks}</div>;
}
const ImageContext = createContext<{ page: Page; deps: Deps } | null>(null);
function Image({ props }: Props<{ ref: string; alt: string; width?: number | null; height?: number | null }>) {
  const context = useContext(ImageContext)!;
  const path = `/pages/${encodeURIComponent(context.page.module)}/${encodeURIComponent(context.page.id)}/content?ref=${encodeURIComponent(props.ref)}`;
  const [image, setImage] = useState<{ path: string; src?: string; failed?: boolean } | null>(null);
  useEffect(() => {
    let stopped = false, src: string | undefined;
    setImage(null);
    void context.deps.content(path).then(blob => {
      if (stopped) return;
      src = URL.createObjectURL(blob);
      setImage({ path, src });
    }).catch(() => { if (!stopped) setImage({ path, failed: true }); });
    return () => { stopped = true; if (src) URL.revokeObjectURL(src); };
  }, [path, context.deps]);
  if (image?.path !== path || !image.src || image.failed) return <p role="status" className={image?.failed ? "error" : "muted"}>{image?.failed ? `图片加载失败：${props.alt || "请稍后重新打开页面"}` : "图片加载中……"}</p>;
  return <img src={image.src} alt={props.alt} width={props.width ?? undefined} height={props.height ?? undefined} style={{ display: "block", maxWidth: "100%", height: "auto", objectFit: "contain", borderRadius: "8px" }} onError={() => setImage({ path, failed: true })} />;
}
const gap = (value?: string | null) => ({ none: "0", sm: ".4rem", md: ".6rem", lg: ".9rem", xl: "1.4rem" })[value ?? "md"] ?? ".6rem";

/** Only what this page draws in its own style is offered; the catalog's other components render as a notice. */
const { registry } = defineRegistry(catalog, {
  components: {
    Workspace, WorkspaceHeader, ViewTabs, Composer, Panel, ScrollArea, Message, CodeDiff, ActionOption,
    Card: ({ props, children }: Props<{ title?: string | null; description?: string | null }>) => <section>{props.title ? <h2>{props.title}</h2> : null}{props.description ? <p className="muted">{props.description}</p> : null}{children}</section>,
    Stack: ({ props, children }: Props<{ direction?: string | null; gap?: string | null; align?: string | null }>) => <div style={{ display: "flex", flexDirection: props.direction === "horizontal" ? "row" : "column", flexWrap: props.direction === "horizontal" ? "wrap" : undefined, gap: gap(props.gap), alignItems: props.align ?? undefined }}>{children}</div>,
    Grid: ({ props, children }: Props<{ columns?: number | null; gap?: string | null }>) => <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${Math.max(8, 48 / (props.columns ?? 2))}rem), 1fr))`, gap: gap(props.gap) }}>{children}</div>,
    List: ({ children }: ComponentRenderProps) => <ul className="plain">{Children.map(children, child => <li>{child}</li>)}</ul>,
    Separator: () => <hr style={{ border: 0, borderTop: "1px solid var(--line)", width: "100%" }} />,
    Heading: ({ props }: Props<{ text: string; level?: string | null }>) => props.level === "h1" || props.level === "h2" || !props.level ? <h2>{props.text}</h2> : <h3>{props.text}</h3>,
    Text: ({ props }: Props<{ text: string; variant?: string | null }>) => <p className={props.variant === "muted" || props.variant === "caption" ? "muted" : undefined} style={{ margin: ".2rem 0", whiteSpace: "pre-wrap" }}>{text(props.text)}</p>,
    Badge: ({ props }: Props<{ text: string; variant?: string | null }>) => <span className={`level ${props.variant === "destructive" ? "red" : props.variant === "secondary" || props.variant === "outline" ? "" : "green"}`}>{props.text}</span>,
    Alert: ({ props }: Props<{ title: string; message?: string | null; type?: string | null }>) => <div role={props.type === "error" ? "alert" : "status"} className={props.type === "error" ? "error" : props.type === "success" ? "ok" : undefined}><strong>{props.title}</strong>{props.message ? <div>{props.message}</div> : null}</div>,
    Table: ({ props }: Props<{ columns?: string[] | null; rows?: unknown[][] | null; caption?: string | null }>) => <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>{props.caption ? <caption className="muted">{props.caption}</caption> : null}<thead><tr>{(props.columns ?? []).map(column => <th key={column} style={{ textAlign: "left", borderBottom: "1px solid var(--line)", padding: ".3rem" }}>{column}</th>)}</tr></thead><tbody>{(props.rows ?? []).map((row, i) => <tr key={i}>{(Array.isArray(row) ? row : []).map((cell, j) => <td key={j} style={{ borderBottom: "1px solid var(--line)", padding: ".3rem" }}>{text(cell)}</td>)}</tr>)}</tbody></table></div>,
    Button: ({ props, emit }: Props<{ label: string; variant?: string | null; disabled?: boolean | null }>) => <button type="button" className={props.variant === "secondary" ? undefined : props.variant === "danger" ? "danger" : "primary"} disabled={!!props.disabled} onClick={() => emit("press")}>{props.label}</button>,
    Link: ({ props, children, on }: Props<{ label?: string; href: string; current?: boolean }>) => <a href={props.href} className={props.current ? "selected" : undefined} aria-current={props.current ? "page" : undefined} onClick={event => { const press = on("press"); if (press.bound) { event.preventDefault(); press.emit(); } }}>{props.label ?? children}</a>,
    Input: ({ props, bindings }: Props<{ label: string; name: string; value?: string | null }>) => <Field label={props.label}><Bound kind="input" name={props.name} value={props.value} binding={bindings?.value} element={props as Args} /></Field>,
    Textarea: ({ props, bindings }: Props<{ label: string; name: string; value?: string | null }>) => <Field label={props.label}><Bound kind="textarea" name={props.name} value={props.value} binding={bindings?.value} element={props as Args} /></Field>,
    Select: ({ props, bindings, emit }: Props<{ label: string; name: string; options?: unknown[] | null; value?: string | null; placeholder?: string | null }>) => {
      const [value, setValue] = useBoundProp<string>(props.value ?? undefined, bindings?.value);
      return <Field label={props.label}><select name={props.name} value={text(value)} onChange={event => { setValue(event.target.value); emit("change"); }}>{props.placeholder ? <option value="">{props.placeholder}</option> : null}{(props.options ?? []).map(option => { const value = record(option) ? text(option.value) : text(option), label = record(option) ? text(option.label) : text(option); return <option key={value} value={value}>{label}</option>; })}</select></Field>;
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
    TabNav: ({ props }: Props<{ items: { label: string; href: string; current: boolean }[] }>) => <nav className="tabs" aria-label="应用标签">{props.items.map(item => <a key={item.href} href={item.href} className={item.current ? "selected" : undefined} aria-current={item.current ? "page" : undefined}>{item.label}</a>)}</nav>,
    Article: ({ children }: Props<Record<string, never>>) => <article>{children}</article>,
    Preformatted: ({ props }: Props<{ text: string }>) => <pre>{props.text}</pre>,
    Markdown,
    Image,
    Time: ({ props }: Props<{ value: string }>) => <Time value={props.value} />,
    CollapsedText: ({ props }: Props<{ content: string; limit?: number }>) => <CollapsedText {...props} />,
  } as never,
  actions: { call: async () => {} },
});
const fallback = ({ element }: ComponentRenderProps) => <p className="muted">（这个网页还不能显示组件 {element.type}）</p>;

type System = { spec: (state: Args) => Spec };
const RegisteredHost = createContext<{ web: SystemHost["web"]; navigate: Deps["navigate"] } | null>(null);
/** Only the system registry can compose an app page; the child receives fresh app-scoped providers. */
function AppSettings({ element }: ComponentRenderProps) {
  const props = element.props as RegisteredPage & { activeHash: string };
  return <SettingsPage key={JSON.stringify([props.moduleId, props.module, props.id, props.activeHash])} entry={props} />;
}
function SettingsPage({ entry }: { entry: RegisteredPage }) {
  const host = useContext(RegisteredHost)!;
  const [attempt, setAttempt] = useState(0), [loaded, setLoaded] = useState<{ page: Page; deps: Deps } | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    setLoaded(null); setError("");
    void host.web(`/pages/${encodeURIComponent(entry.module)}/${encodeURIComponent(entry.id)}`).then(result => {
      if (stopped) return;
      const page = result as Page;
      if (page.module !== entry.module || page.moduleId !== entry.moduleId || page.id !== entry.id || page.purpose !== "settings") throw new Error("应用设置页面已变化，请重新打开应用。");
      setLoaded({ page, deps: registeredDeps(page, host.web, host.navigate) });
    }).catch((error: Error) => { if (!stopped) setError(error.message); });
    return () => { stopped = true; };
  }, [entry.module, entry.moduleId, entry.id, host, attempt]);
  const retry = () => { setLoaded(null); setError(""); setAttempt(value => value + 1); };
  if (error) return <div role="alert"><p className="error">设置页面读取失败：{error}</p><button type="button" onClick={retry}>重试读取设置</button></div>;
  if (!loaded) return <p role="status">正在读取应用设置页面……</p>;
  return <RegisteredHost.Provider value={null}><PageView page={loaded.page} deps={loaded.deps} embedded retry={retry} /></RegisteredHost.Provider>;
}
const systemRegistry = { ...registry, ...systemComponents, AppSettings } as typeof registry;
type PageViewProps = { page: Page; deps: Deps; system?: System; embedded?: boolean; retry?: () => void };
export function PageView(props: PageViewProps) {
  const { page } = props;
  return <PageContent key={JSON.stringify([page.moduleId, page.module, page.id, page.revision])} {...props} />;
}
function RegisteredHeading({ page, embedded }: { page: Page; embedded?: boolean }) {
  return <>
    {!embedded ? <nav className="row" aria-label="应用导航">
      {page.moduleId ? <a href={`/apps/${encodeURIComponent(page.moduleId)}`}>返回应用</a> : <a href="/apps">应用目录</a>}
      {page.purpose === "settings" ? <a href="/settings">全部设置</a> : page.moduleId ? <a href={settingsHref(page.moduleId)} aria-label="应用设置" title="应用设置">⚙ 设置</a> : null}
    </nav> : null}
    {!embedded && page.purpose === "settings" ? <p className="muted">{page.module} · 设置</p> : null}
    <h2>{page.title}</h2>
  </>;
}
function PageContent({ page, deps, system, embedded, retry }: PageViewProps) {
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [store] = useState(() => createStateStore({ ...(page.spec.state ?? {}) }));
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [loading, setLoading] = useState<"initial" | "refresh" | null>(null);
  const ready = useRef(new Set<string>());
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const currentRegistry = useMemo(() => system ? systemRegistry : { ...registry, ...executableRegistry(page, deps) }, [system, page, deps]);
  const spec = system ? system.spec(state) : page.spec;
  const refresh = () => setLoadedAt(value => value + 1);
  const target = (tool: string) => `${page.module}.${tool}`;
  // Each source is read when the page opens, when the state its arguments use changes, and every `refresh` seconds.
  useEffect(() => {
    const last = new Map<string, string>(), timers: ReturnType<typeof setInterval>[] = [];
    let stopped = false, pending = 0, initial = 0;
    setLoading(null);
    // eslint-disable-next-line complexity -- Preserve source deduplication, stale-response checks and feedback ordering in one request lifecycle.
    const read = async (key: string, source: Source, force = false) => {
      const args = (resolve(source.args ?? {}, store) ?? {}) as Args, signature = JSON.stringify(args);
      if (!force && last.get(key) === signature) return;
      last.set(key, signature);
      if ((page.needs?.[key] ?? []).some(name => args[name] === undefined || args[name] === null || args[name] === "")) return;
      const firstRead = !ready.current.has(key);
      pending++; if (firstRead) initial++;
      setLoading(initial ? "initial" : "refresh");
      try {
        const result = await deps.call(target(source.tool), args), failed = failure(result);
        if (stopped || last.get(key) !== signature) return;
        if (failed) { setFeedback({ failed: true, text: failed, source: key }); return; }
        ready.current.add(key);
        store.set(`/${key}`, result);
        setFeedback(current => current?.source === key ? null : current);
      } catch (error) { if (!stopped && last.get(key) === signature) setFeedback({ failed: true, text: `读取失败：${(error as Error).message}`, source: key }); }
      finally { pending--; if (firstRead) initial--; if (!stopped) setLoading(pending ? initial ? "initial" : "refresh" : null); }
    };
    const all = (force: boolean) => { for (const [key, source] of Object.entries(page.data)) void read(key, source, force); };
    all(true);
    const unsubscribe = store.subscribe(() => all(false));
    for (const [key, source] of Object.entries(page.data)) if (source.refresh) timers.push(setInterval(() => { if (!document.hidden) void read(key, source, true); }, source.refresh * 1000));
    return () => { stopped = true; unsubscribe(); timers.forEach(clearInterval); };
  }, [page, deps, loadedAt]);
  const handlers = {
    call: async (params: Args) => {
      if (!active.current) throw new Error("页面已关闭");
      const tool = String(params.tool), args = { ...(resolve(params.args ?? {}, store) as Args) };
      // A tool that takes a request key gets a fresh one per press, so a retried press is not applied twice by the app.
      if (page.keyed?.includes(tool) && args["request-key"] === undefined) args["request-key"] = crypto.randomUUID();
      setFeedback({ failed: false, text: "处理中……" });
      let result: unknown;
      try { result = await deps.call(target(tool), args); }
      catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Unmount can change the ref during the awaited call.
        if (active.current) setFeedback({ failed: true, text: (error as Error).message });
        throw error;
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Unmount can change the ref during the awaited call.
      if (!active.current) throw new Error("页面已关闭");
      // Thrown, so json-render runs the binding's onError instead of its onSuccess.
      const failed = failure(result);
      if (failed) { setFeedback({ failed: true, text: failed }); throw new Error(failed); }
      if (typeof params.result === "string") store.set(params.result, result);
      setFeedback({ failed: false, text: "已完成" });
      if (params.reload !== false) setLoadedAt(Date.now());
    },
  };
  const systemContext = system ? { call: async (tool: string, args: Args) => {
    const result = await deps.call(target(tool), args), failed = failure(result);
    if (failed) throw new Error(failed);
    return result;
  }, refresh } : null;
  return <JSONUIProvider registry={currentRegistry} store={store} handlers={handlers} navigate={(...args) => { if (active.current) deps.navigate(...args); }}>
    <div className={system ? "registered-page system-page" : "registered-page"}>
      {!system ? <RegisteredHeading page={page} embedded={embedded} /> : null}
      {loading ? <p role="status" aria-live="polite" className="page-loading muted">{loading === "initial" ? "正在读取应用数据……" : "正在刷新应用数据……"}</p> : null}
      {feedback ? <p role="status" className={`page-feedback ${feedback.failed ? "error" : "muted"}`}>{feedback.text}{feedback.failed && retry ? <button type="button" onClick={retry}>重新读取设置</button> : null}</p> : null}
      <SystemContext.Provider value={systemContext}><ImageContext.Provider value={{ page, deps }}><Renderer spec={spec} registry={currentRegistry} fallback={fallback} /></ImageContext.Provider></SystemContext.Provider>
    </div>
  </JSONUIProvider>;
}

/** Called by app.js: draws `page` into `element`; returns the unmount. */
export function mount(element: HTMLElement, page: Page, deps: Deps) {
  const root = createRoot(element);
  root.render(<PageView page={page} deps={deps} />);
  return () => root.unmount();
}

/** The adapter and extra components exist only for system pages mounted here. */
export function mountSystem(element: HTMLElement, params: SystemParams, host: SystemHost, navigate: Deps["navigate"]) {
  const { spec, data } = systemPage(params);
  const page: Page = { module: "$web", id: params.name, title: params.name, data, spec: spec({}), ...(params.name === "app" ? { needs: { tools: ["query"], recent: ["module"] } } : {}) };
  const deps: Deps = { call: systemCall(host), navigate, content: async () => { throw new Error("系统页没有应用内容"); } };
  const root = createRoot(element);
  root.render(<RegisteredHost.Provider value={{ web: host.web, navigate }}><ChatHost.Provider value={{ subscribe: host.subscribe ?? (() => () => {}), navigate }}><PageView page={page} deps={deps} system={{ spec }} /></ChatHost.Provider></RegisteredHost.Provider>);
  return () => root.unmount();
}
