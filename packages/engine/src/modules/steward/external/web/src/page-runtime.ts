import { createRoot } from "react-dom/client";
import { failure, type Page, type Deps, type PageHost } from "./registered-page";

type Feedback = {
  loading: (value: boolean) => void;
  error: (message: string) => void;
  toast: (message: string) => void;
  confirm: PageHost["confirm"];
  cancel: () => void;
};
type Instance = { destroy?: () => void };
type Mount = (element: HTMLElement, host: PageHost) => (() => void) | Instance;
const importPage = (url: string): Promise<{ default?: unknown }> => import(/* @vite-ignore */ url);

/** A page revision owns its module, stylesheet, nested React root and object URLs. */
export function startPage(element: HTMLElement, page: Page, deps: Deps, feedback: Feedback, attempt: number) {
  const lifecycle = new AbortController(),
    urls = new Set<string>();
  let instance: Instance | undefined, rendered: ReturnType<typeof createRoot> | undefined;
  const style = page.css ? document.createElement("style") : undefined;
  const url = deps.source
    ? `${deps.source}&attempt=${attempt}`
    : URL.createObjectURL(new Blob([page.javascript], { type: "text/javascript" }));
  if (!deps.source) urls.add(url);
  if (style) {
    style.textContent = page.css!;
    document.head.append(style);
  }
  const unmount = () => {
    const root = rendered;
    rendered = undefined;
    // Parent React may already be committing its own unmount; finish that commit first.
    if (root) queueMicrotask(() => root.unmount());
  };
  const cleanup = () => {
    try {
      instance?.destroy?.();
    } catch (error) {
      console.error(JSON.stringify({ component: "web", event: "page_cleanup_failed", error: String(error) }));
    } finally {
      instance = undefined;
      unmount();
      style?.remove();
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    }
  };
  const render: PageHost["render"] = (content) => {
    rendered ??= createRoot(element);
    rendered.render(content);
    return unmount;
  };
  const host = createPageHost(page, deps, lifecycle.signal, urls, { ...feedback, render });
  feedback.error("");
  feedback.loading(true);
  void importPage(url)
    .then((module) => {
      if (lifecycle.signal.aborted) return;
      if (typeof module.default !== "function") throw new Error("页面必须默认导出 mount(element, host)");
      const result: unknown = (module.default as Mount)(element, host);
      if (typeof result === "function") instance = { destroy: result as () => void };
      else if (
        result &&
        typeof result === "object" &&
        !("then" in result) &&
        (!("destroy" in result) || typeof result.destroy === "function")
      )
        instance = result as Instance;
      else throw new Error("页面 mount 必须返回清理函数或 {destroy}");
      feedback.loading(false);
    })
    .catch((error) => {
      console.error(
        JSON.stringify({
          component: "web",
          event: "page_mount_failed",
          module: page.module,
          id: page.id,
          error: String(error),
        }),
      );
      if (!lifecycle.signal.aborted) {
        cleanup();
        feedback.loading(false);
        feedback.error(String(error));
      }
    });
  return () => {
    lifecycle.abort();
    feedback.cancel();
    cleanup();
  };
}
function createPageHost(
  page: Page,
  deps: Deps,
  signal: AbortSignal,
  urls: Set<string>,
  feedback: Feedback & { render: PageHost["render"] },
): PageHost {
  return {
    props: page.props,
    call: async <T>(name: string, input: Record<string, unknown> = {}) => {
      signal.throwIfAborted();
      const tool = name.startsWith(`${page.module}.`) ? name.slice(page.module.length + 1) : name;
      if (!page.tools.includes(tool)) throw new Error(`页面未声明操作：${name}`);
      const args = { ...input };
      if (page.keyed.includes(tool) && args["request-key"] === undefined) args["request-key"] = crypto.randomUUID();
      const result = await deps.call(`${page.module}.${tool}`, args),
        failed = failure(result);
      if (failed) throw new Error(failed);
      signal.throwIfAborted();
      return result as T;
    },
    navigate: (...args) => {
      if (!signal.aborted) deps.navigate(...args);
    },
    contentUrl: async (ref) => {
      signal.throwIfAborted();
      if (!page.content) throw new Error("页面未声明内容读取工具");
      const path = `/pages/${encodeURIComponent(page.module)}/${encodeURIComponent(page.id)}/content?ref=${encodeURIComponent(ref)}&revision=${encodeURIComponent(page.revision)}`;
      const blob = await deps.content(path);
      signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      urls.add(url);
      return url;
    },
    confirm: (options) => (signal.aborted ? Promise.resolve(false) : feedback.confirm(options)),
    toast: (message) => {
      if (!signal.aborted) feedback.toast(message);
    },
    render: feedback.render,
  };
}
