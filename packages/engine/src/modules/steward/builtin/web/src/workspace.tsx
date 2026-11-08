// Generic page primitives. Application state and operations remain in page specs/actions.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useBoundProp, type ComponentRenderProps } from "@json-render/react";
import { Time } from "./display";

type Props<P> = ComponentRenderProps<P> & { props: P; bindings?: Record<string, string> };
export type WorkspaceProps = { sidebarLabel?: string; mainLabel?: string; sidebarOpen?: boolean; mobileSidebarOpen?: boolean; breadcrumb?: string; title?: string; description?: string };
function WorkspaceBrand({ title, description }: Pick<WorkspaceProps, "title" | "description">) {
  if (!title && !description) return null;
  return <div className="workspace-brand">{title ? <div className="workspace-brand-title">{title}</div> : null}{description ? <p>{description}</p> : null}</div>;
}
function useSidebarOpen(value?: boolean, binding?: string) {
  const [bound, setBound] = useBoundProp<boolean>(value, binding);
  const [local, setLocal] = useState(value ?? true);
  useEffect(() => { setLocal(value ?? true); }, [value]);
  return binding ? [bound ?? true, setBound] as const : [local, setLocal] as const;
}
function useWorkspaceSidebar(props: WorkspaceProps, bindings?: Record<string, string>) {
  const [desktop, setDesktop] = useSidebarOpen(props.sidebarOpen, bindings?.sidebarOpen);
  const [mobile, setMobile] = useSidebarOpen(props.mobileSidebarOpen, bindings?.mobileSidebarOpen);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)"), update = () => setNarrow(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const separateMobile = narrow && (props.mobileSidebarOpen !== undefined || !!bindings?.mobileSidebarOpen);
  const open = separateMobile ? mobile : desktop;
  const change = separateMobile ? setMobile : setDesktop;
  return { open, toggle: () => change(!open) };
}
export function Workspace({ props, children, slots, bindings }: Props<WorkspaceProps>) {
  const { sidebarLabel = "列表", mainLabel = "内容" } = props;
  const id = useId(), root = useRef<HTMLDivElement>(null), main = useRef<HTMLDivElement>(null), toggle = useRef<HTMLButtonElement>(null);
  const { open, toggle: toggleSidebar } = useWorkspaceSidebar(props, bindings);
  useLayoutEffect(() => {
    const element = root.current!;
    const resize = () => element.style.setProperty("--workspace-height", `${Math.max(240, (window.visualViewport?.height ?? window.innerHeight) - element.getBoundingClientRect().top)}px`);
    resize(); window.addEventListener("resize", resize); window.visualViewport?.addEventListener("resize", resize);
    const observer = new ResizeObserver(resize);
    const header = document.querySelector("body > header"); if (header) observer.observe(header);
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("resize", resize); };
  }, []);
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (!open && active instanceof Element && root.current?.querySelector("aside")?.contains(active)) {
      if (window.matchMedia("(max-width: 700px)").matches) main.current?.focus({ preventScroll: true });
      else toggle.current?.focus({ preventScroll: true });
    }
  }, [open]);
  return <div ref={root} className={`renderer-workspace ${open ? "sidebar-open" : "sidebar-closed"}`}>
    <div className="workspace-toolbar"><button ref={toggle} type="button" aria-expanded={open} aria-controls={id} onClick={toggleSidebar}>
      <span className="workspace-toggle-icon" aria-hidden="true">☷</span><span className="workspace-desktop-label">{open ? "收起" : "显示"}{sidebarLabel}</span>
      <span className="workspace-mobile-label">{open ? `进入${mainLabel}` : `返回${sidebarLabel}`}</span>
    </button><span className="workspace-breadcrumb">{props.breadcrumb}</span></div>
    <div className="workspace-panes">
      <aside id={id} className="workspace-sidebar" aria-label={sidebarLabel} hidden={!open}>
        <WorkspaceBrand title={props.title} description={props.description} />
        {slots?.sidebar}
      </aside>
      <div ref={main} className="workspace-main" role="region" aria-label={mainLabel} tabIndex={-1}>{children}</div>
    </div>
  </div>;
}

export type WorkspaceHeaderProps = { title: string; subtitle?: string; status?: string; statusTone?: "neutral" | "success" | "warning" | "danger" };
export function WorkspaceHeader({ props, children }: Props<WorkspaceHeaderProps>) {
  return <div className="renderer-workspace-header">
    <h1>{props.title}</h1>
    {props.status || props.subtitle ? <div className="workspace-summary">{props.status ? <span className={`workspace-status status-${props.statusTone ?? "neutral"}`}>{props.status}</span> : null}{props.subtitle ? <span>{props.subtitle}</span> : null}</div> : null}
    {children}
  </div>;
}

export type ViewTabsProps = { items: { value: string; label: string }[]; value?: string };
export function ViewTabs({ props, bindings }: Props<ViewTabsProps>) {
  const [bound, setBound] = useBoundProp<string>(props.value, bindings?.value);
  const [local, setLocal] = useState(props.value);
  useEffect(() => { setLocal(props.value); }, [props.value]);
  const value = (bindings?.value ? bound : local) ?? props.items[0]?.value;
  const select = bindings?.value ? setBound : setLocal;
  const list = useRef<HTMLDivElement>(null);
  return <div className="renderer-view-tabs" role="tablist" aria-label="内容视图" ref={list}>
    {props.items.map((item, index) => <button key={item.value} type="button" role="tab" aria-selected={value === item.value} tabIndex={value === item.value ? 0 : -1} onClick={() => select(item.value)} onKeyDown={event => {
      const count = props.items.length;
      const next = event.key === "ArrowRight" ? (index + 1) % count : event.key === "ArrowLeft" ? (index + count - 1) % count : event.key === "Home" ? 0 : event.key === "End" ? count - 1 : null;
      if (next === null) return;
      event.preventDefault(); select(props.items[next]!.value);
      list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    }}>{item.label}</button>)}
  </div>;
}

export type ComposerProps = { hint?: string; footnote?: string; disabled?: boolean };
export function Composer({ props, children, slots, emit }: Props<ComposerProps>) {
  return <div className="renderer-composer-wrap"><div className="renderer-composer" onKeyDown={event => {
    if (props.disabled || event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || !(event.target instanceof HTMLTextAreaElement)) return;
    event.preventDefault(); emit("submit");
  }}>
    <div className="composer-input">{children}</div>
    <div className="composer-tools">{props.hint ? <span className="composer-hint">{props.hint}</span> : null}<div className="composer-actions">{slots?.actions}</div></div>
  </div>{props.footnote ? <div className="composer-footnote">{props.footnote}</div> : null}</div>;
}

export type PanelProps = { tone?: "default" | "question" | "muted" };
export function Panel({ props, children }: Props<PanelProps>) {
  return <div className={`renderer-panel panel-${props.tone ?? "default"}`}>{children}</div>;
}

export type ScrollAreaProps = { label?: string; follow?: boolean };
export function ScrollArea({ props, children }: Props<ScrollAreaProps>) {
  const viewport = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const saved = useRef({ top: 0, pinned: !!props.follow, height: 0 });
  const [unread, setUnread] = useState(false);
  useLayoutEffect(() => {
    const view = viewport.current!, body = content.current!;
    const update = () => {
      // Hidden mobile panes keep their DOM, draft and reading position.
      if (!view.clientHeight) return;
      const previous = saved.current;
      if (props.follow && previous.pinned) view.scrollTop = view.scrollHeight;
      else view.scrollTop = previous.top;
      if (props.follow && !previous.pinned && previous.height && body.scrollHeight !== previous.height) setUnread(true);
      previous.top = view.scrollTop; previous.height = body.scrollHeight;
    };
    update();
    const observer = new ResizeObserver(update); observer.observe(body); observer.observe(view);
    return () => observer.disconnect();
  }, [props.follow]);
  const follow = () => {
    const view = viewport.current!; saved.current.pinned = true;
    view.scrollTop = view.scrollHeight; saved.current.top = view.scrollTop; setUnread(false);
  };
  return <div className="renderer-scroll-shell">
    <div ref={viewport} className="renderer-scroll-area" role="region" aria-label={props.label ?? "可滚动内容"} tabIndex={0} onScroll={() => {
      const view = viewport.current!;
      // A resize can hide the mobile pane; retain both its offset and follow preference.
      if (!view.clientHeight) return;
      saved.current.top = view.scrollTop;
      saved.current.pinned = view.scrollHeight - view.clientHeight - view.scrollTop <= 48;
      if (saved.current.pinned) setUnread(false);
    }}><div ref={content} className="renderer-scroll-content">{children}</div></div>
    {props.follow && unread ? <button type="button" className="scroll-new-content" onClick={follow}>有新内容 · 跳到最新</button> : null}
  </div>;
}

export type MessageProps = { author: string; time?: string; tone?: "default" | "user" | "notice" };
export function Message({ props, children }: Props<MessageProps>) {
  return <article className={`renderer-message message-${props.tone ?? "default"}`} aria-label={props.author}>
    <div className="message-meta"><span className="message-avatar" aria-hidden="true" hidden>{Array.from(props.author)[0]}</span><strong>{props.author}</strong>{props.time ? <Time value={props.time} /> : null}</div>
    <div className="message-content">{children}</div>
  </article>;
}

type DiffKind = "hunk" | "add" | "remove" | "context";
type DiffRange = { old: number; next: number; oldLeft: number; nextLeft: number };
function diffKind(line: string, inHunk: boolean, heading: boolean): DiffKind {
  if (heading) return "hunk";
  if (!inHunk) return "context";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  return "context";
}
function diffNumbers(line: string, kind: DiffKind, range: DiffRange | null) {
  if (!range || !/^[ +-]/.test(line)) return { before: "", after: "" };
  const before = kind === "add" ? "" : range.old++, after = kind === "remove" ? "" : range.next++;
  if (before !== "") range.oldLeft--; if (after !== "") range.nextLeft--;
  return { before, after };
}
export type CodeDiffProps = { filename?: string; diff: string };
export function CodeDiff({ props }: Props<CodeDiffProps>) {
  // A dynamic prop is empty until its data source resolves.
  const diff = props.diff || "";
  let range: DiffRange | null = null, added = 0, removed = 0;
  const lines = diff.split(/\r?\n/).map((line, index) => {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) range = { old: Number(hunk[1]), oldLeft: Number(hunk.at(2) ?? 1), next: Number(hunk[3]), nextLeft: Number(hunk.at(4) ?? 1) };
    else if (/^(diff |index )/.test(line)) range = null;
    const kind = diffKind(line, !!range, !!hunk), { before, after } = diffNumbers(line, kind, range);
    added += Number(kind === "add"); removed += Number(kind === "remove");
    if (range && range.oldLeft <= 0 && range.nextLeft <= 0) range = null;
    return <span className={`diff-line diff-${kind}`} key={index}><span className="diff-number" aria-hidden="true">{before}</span><span className="diff-number" aria-hidden="true">{after}</span><span>{line || " "}</span>{"\n"}</span>;
  });
  return <figure className="renderer-diff">
    <figcaption><strong>{props.filename ?? "变更"}</strong><span>新增 {added} · 删除 {removed}</span></figcaption>
    {diff ? <div className="diff-viewport" role="region" aria-label={`${props.filename ?? "代码"}变更`} tabIndex={0}><pre><code>{lines}</code></pre></div> : <p className="muted">暂无变更</p>}
  </figure>;
}

export type ActionOptionProps = { label: string; description?: string; selected?: boolean; disabled?: boolean; compact?: boolean };
export function ActionOption({ props, emit }: Props<ActionOptionProps>) {
  return <button type="button" className={`renderer-action-option${props.compact ? " option-compact" : ""}`} aria-pressed={props.selected} disabled={!!props.disabled} onClick={() => emit("press")}>
    <span className="option-label">{props.label}</span>{props.description ? <span className="option-description">{props.description}</span> : null}
    {props.selected ? <span className="option-selected" aria-hidden="true">✓</span> : null}
  </button>;
}
