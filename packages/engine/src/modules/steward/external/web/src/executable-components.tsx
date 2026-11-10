import { useEffect, useRef, useState } from "react";
import type { ComponentRegistry, ComponentRenderProps } from "@json-render/react";
import type { Deps, Extension, Page } from "./registered-page";

type Args = Record<string, unknown>;
export type ExecutableContext = {
  readonly props: Args;
  emit: (event: string) => void;
  call: (tool: string, args: Args) => Promise<unknown>;
  /** React owns this container and renders the standard children here. */
  children?: HTMLElement;
  /** Standard named slots are React-owned containers, beside the imperative mount host. */
  slots?: Record<string, HTMLElement>;
};
type Instance = { update?: (context: ExecutableContext) => void; destroy?: () => void };
type Mount = (element: HTMLElement, context: ExecutableContext) => (() => void) | Instance;
type Resource = { name: string; module: string; moduleId: string; hash: string; revision: string; javascript: string; css?: string };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const object = (value: unknown): value is Args => !!value && typeof value === "object" && !Array.isArray(value);

/** Uses the existing authenticated content loader, whose paths are relative to /api/web. */
// eslint-disable-next-line complexity -- Validate the authenticated resource identity and source shape at the load boundary.
export async function loadExecutable(page: Page, fullName: string, definition: Extension, deps: Deps): Promise<Resource> {
  const prefix = `${page.module}:`;
  if (!fullName.startsWith(prefix) || !definition.revision) throw new Error("组件声明无效");
  const name = fullName.slice(prefix.length);
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error("组件名称无效");
  const path = `/components/${encodeURIComponent(page.module)}/${encodeURIComponent(name)}?revision=${encodeURIComponent(definition.revision)}`;
  const resource: unknown = JSON.parse(await (await deps.content(path)).text());
  if (!object(resource) || resource.name !== name || resource.module !== page.module || resource.revision !== definition.revision
    || (page.moduleId !== undefined && resource.moduleId !== page.moduleId) || (page.hash !== undefined && resource.hash !== page.hash)
    || typeof resource.moduleId !== "string" || typeof resource.hash !== "string" || !resource.hash
    || typeof resource.javascript !== "string" || (resource.css !== undefined && typeof resource.css !== "string")) {
    throw new Error("组件版本或内容无效，请重新打开页面");
  }
  return resource as Resource;
}

// A variable import must reach the browser unchanged: Bun must not resolve the runtime blob URL.
const importExecutable = (url: string): Promise<{ default?: unknown }> => import(/* @vite-ignore */ url);

/** Trusted same-page code. Neither this host nor a style element provides isolation. */
function Executable({ page, deps, fullName, definition, render }: { page: Page; deps: Deps; fullName: string; definition: Extension; render: ComponentRenderProps }) {
  const host = useRef<HTMLDivElement>(null), children = useRef<HTMLDivElement>(null), slots = useRef<Record<string, HTMLElement>>({});
  const latest = useRef(render); latest.current = render;
  const mounted = useRef<{ update: () => void; fail: (error: unknown) => void } | null>(null);
  const [attempt, setAttempt] = useState(0), [status, setStatus] = useState<{ loading: boolean; error?: string }>({ loading: true });
  useEffect(() => {
    const element = host.current!;
    let active = true, url: string | undefined, style: HTMLStyleElement | undefined, instance: Instance | undefined;
    const dispose = () => {
      const current = instance; instance = undefined; mounted.current = null;
      try { current?.destroy?.(); }
      finally { element.replaceChildren(); style?.remove(); if (url) URL.revokeObjectURL(url); url = undefined; }
    };
    const fail = (error: unknown) => {
      if (!active) return;
      active = false;
      try { dispose(); } catch (cleanupError) { console.error("组件清理失败", cleanupError); }
      setStatus({ loading: false, error: message(error) });
    };
    const context: ExecutableContext = {
      get props() { return latest.current.element.props; },
      children: definition.slots?.includes("default") ? children.current ?? undefined : undefined,
      slots: slots.current,
      emit: event => {
        if (!active) return;
        if (!definition.events?.includes(event)) throw new Error(`组件未声明事件：${event}`);
        latest.current.emit(event);
      },
      call: async (tool, args) => {
        if (!active) throw new Error("组件已关闭");
        const target = tool.includes(".") ? tool : `${page.module}.${tool}`;
        const allowed = definition.tools?.some(name => (name.includes(".") ? name : `${page.module}.${name}`) === target);
        if (!target.startsWith(`${page.module}.`) || !allowed) throw new Error(`组件未声明操作：${tool}`);
        if (!object(args)) throw new Error("组件操作参数必须是对象");
        const result = await deps.call(target, args);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Unmount can happen during the awaited call.
        if (!active) throw new Error("组件已关闭");
        return result;
      },
    };
    setStatus({ loading: true });
    // eslint-disable-next-line complexity -- Keep source load, native ESM import, and synchronous mount within one lifecycle.
    void (async () => {
      const resource = await loadExecutable(page, fullName, definition, deps);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Cleanup can run during resource loading.
      if (!active) return;
      url = URL.createObjectURL(new Blob([resource.javascript], { type: "text/javascript" }));
      const module = await importExecutable(url);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Cleanup can run during native module import.
      if (!active) return;
      if (typeof module.default !== "function") throw new Error("组件必须默认导出 mount(element, context) 函数");
      if (resource.css) { style = document.createElement("style"); style.textContent = resource.css; element.append(style); }
      const result: unknown = (module.default as Mount)(element, context);
      if (typeof result === "function") instance = { destroy: result as () => void };
      else if (object(result) && result.then === undefined && (result.update === undefined || typeof result.update === "function") && (result.destroy === undefined || typeof result.destroy === "function")) instance = result as Instance;
      else throw new Error("组件 mount 必须返回清理函数或 { update?, destroy? }");
      // A component can replace its host contents during mount; keep its trusted stylesheet present.
      if (style && !element.contains(style)) element.append(style);
      mounted.current = { update: () => instance?.update?.(context), fail };
      setStatus({ loading: false });
    })().catch(fail);
    return () => {
      active = false;
      try { dispose(); } catch (error) { console.error("组件清理失败", error); }
    };
  }, [page, deps, fullName, definition, attempt]);
  useEffect(() => {
    const current = mounted.current;
    try { current?.update(); } catch (error) { current?.fail(error); }
  }, [render.element.props]);
  return <div data-executable-component={fullName}>
    {status.loading ? <p role="status">组件加载中……</p> : null}
    {status.error ? <div role="alert"><p className="error">组件加载或运行失败：{status.error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重试加载组件</button></div> : null}
    <div ref={host} />
    <div ref={children}>{render.children}</div>
    {Object.entries(render.slots ?? {}).map(([name, content]) => <div key={name} data-component-slot={name} ref={element => { if (element) slots.current[name] = element; else delete slots.current[name]; }}>{content}</div>)}
  </div>;
}

/** Create once per page/dependency identity so state/props updates preserve mounted native controls. */
export function executableRegistry(page: Page, deps: Deps): ComponentRegistry {
  return Object.fromEntries(Object.entries(page.extensions ?? {}).map(([fullName, definition]) => [fullName,
    function RegisteredExecutable(render: ComponentRenderProps) { return <Executable page={page} deps={deps} fullName={fullName} definition={definition} render={render} />; },
  ]));
}
