import { startPage } from "./page-runtime";
import * as React from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as ui from "./ui";
import { failure, registeredDeps, type Page, type Deps, type PageHost } from "./registered-page";
import type { SystemHost } from "./system/adapter";
import { settingsHref, type RegisteredPage } from "./system/registered-pages";
export { React, createRoot, ui, registeredDeps, failure };
export type { Page, Deps, PageHost };
export const RegisteredHost = createContext<{ web: SystemHost["web"]; navigate: Deps["navigate"] } | null>(null);
/** Trusted same-document ESM; resources belong to exactly one page revision. */
export function PageView({
  page,
  deps,
  embedded = false,
}: {
  page: Page;
  deps: Deps;
  embedded?: boolean;
  retry?: () => void;
}) {
  return (
    <ExecutablePage
      key={JSON.stringify([page.moduleId, page.hash, page.id, page.revision])}
      page={page}
      deps={deps}
      embedded={embedded}
    />
  );
}
function ExecutablePage({ page, deps, embedded }: { page: Page; deps: Deps; embedded: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [toast, setToast] = useState("");
  const [confirmation, setConfirmation] = useState<{ title: string; message?: string } | null>(null);
  const answer = useRef<((value: boolean) => void) | null>(null);
  const decide = (value: boolean) => {
    answer.current?.(value);
    answer.current = null;
    setConfirmation(null);
  };
  useEffect(
    () =>
      startPage(
        container.current!,
        page,
        deps,
        {
          loading: setLoading,
          error: setError,
          toast: setToast,
          confirm: (options) => {
            answer.current?.(false);
            setConfirmation(options);
            return new Promise((resolve) => {
              answer.current = resolve;
            });
          },
          cancel: () => {
            answer.current?.(false);
            answer.current = null;
          },
        },
        attempt,
      ),
    [page, deps, attempt],
  );
  return (
    <div className="registered-page">
      {!embedded ? (
        <nav className="row" aria-label="应用导航">
          <a href={`/apps/${encodeURIComponent(page.moduleId)}`}>返回应用</a>
          {page.purpose === "settings" ? (
            <a href="/settings">全部设置</a>
          ) : (
            <a aria-label="应用设置" href={settingsHref(page.moduleId)}>
              ⚙ 设置
            </a>
          )}
        </nav>
      ) : null}
      <h2>{page.title}</h2>
      {loading ? <p role="status">页面加载中……</p> : null}
      {error ? (
        <div role="alert">
          <p className="error">页面加载或运行失败：{error}</p>
          <ui.Button onClick={() => setAttempt((value) => value + 1)}>重试加载页面</ui.Button>
        </div>
      ) : null}
      <div key={attempt} ref={container} className="application-page" />
      {toast ? (
        <div role="status" className="ui-toast">
          {toast}
          <ui.Button aria-label="关闭提示" onClick={() => setToast("")}>
            ×
          </ui.Button>
        </div>
      ) : null}
      <ui.Dialog open={!!confirmation} title={confirmation?.title ?? "确认"} onClose={() => decide(false)}>
        <p>{confirmation?.message}</p>
        <div className="row">
          <ui.Button onClick={() => decide(false)}>取消</ui.Button>
          <ui.Button variant="primary" onClick={() => decide(true)}>
            确认
          </ui.Button>
        </div>
      </ui.Dialog>
    </div>
  );
}
export function AppSettings({ entry }: { entry: RegisteredPage & { activeHash?: string | null } }) {
  const host = useContext(RegisteredHost)!;
  const [attempt, setAttempt] = useState(0),
    [loaded, setLoaded] = useState<{ page: Page; deps: Deps } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    setLoaded(null);
    setError("");
    void host
      .web(`/pages/${encodeURIComponent(entry.module)}/${encodeURIComponent(entry.id)}`)
      .then((result) => {
        if (stopped) return;
        const page = result as Page;
        if (
          page.module !== entry.module ||
          page.moduleId !== entry.moduleId ||
          page.id !== entry.id ||
          page.purpose !== "settings" ||
          (entry.activeHash && page.hash !== entry.activeHash)
        )
          throw new Error("应用设置页面已变化，请重新打开应用。");
        setLoaded({ page, deps: registeredDeps(page, host.web, host.navigate) });
      })
      .catch((error) => {
        console.error(JSON.stringify({ component: "web", event: "settings_page_failed", error: String(error) }));
        if (!stopped) setError(String(error));
      });
    return () => {
      stopped = true;
    };
  }, [entry.module, entry.moduleId, entry.id, entry.activeHash, host, attempt]);
  if (error)
    return (
      <div role="alert">
        <p className="error">设置页面读取失败：{error}</p>
        <ui.Button onClick={() => setAttempt((value) => value + 1)}>重试读取设置</ui.Button>
      </div>
    );
  if (!loaded) return <p role="status">正在读取应用设置页面……</p>;
  return <PageView page={loaded.page} deps={loaded.deps} embedded />;
}
export function mount(element: HTMLElement, page: Page, deps: Deps) {
  const root = createRoot(element);
  root.render(<PageView page={page} deps={deps} />);
  return () => root.unmount();
}
