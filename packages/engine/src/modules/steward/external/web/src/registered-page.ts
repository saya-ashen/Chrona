import type { ReactNode } from "react";
import type { SystemHost } from "./system/adapter";

type Args = Record<string, unknown>;
export type Page = { module: string; moduleId: string; id: string; title: string; purpose?: "settings"; layout?: "document" | "workspace"; revision: string; hash: string; javascript: string; css?: string; props: Args; tools: string[]; keyed: string[]; content?: { tool: string } };
export type Deps = { source?: string; call: (target: string, args: Args) => Promise<unknown>; navigate: (path: string, replace?: boolean) => void; content: (path: string) => Promise<Blob> };
export type PageHost = {
  readonly props: Args;
  call: <T = unknown>(tool: string, args?: Args) => Promise<T>;
  navigate: Deps["navigate"];
  contentUrl: (ref: string) => Promise<string>;
  confirm: (options: { title: string; message?: string }) => Promise<boolean>;
  toast: (message: string) => void;
  render: (content: ReactNode) => () => void;
};
/** Standalone and embedded pages use identical revision-pinned HTTP calls. */
export function registeredDeps(page: Page, web: SystemHost["web"], navigate: Deps["navigate"]): Deps {
  return {
    source: `/api/web/pages/${encodeURIComponent(page.module)}/${encodeURIComponent(page.id)}/source?revision=${encodeURIComponent(page.revision)}`,
    call: (target, args) => web("/call", { method: "POST", body: { target, args, page: { module: page.module, id: page.id, revision: page.revision } } }),
    navigate,
    content: path => web(path, { raw: true }) as Promise<Blob>,
  };
}
export function failure(result: unknown) {
  if (!result || typeof result !== "object" || !("error" in result) || result.error == null) return null;
  const error = result.error;
  return typeof error === "object" && "message" in error ? String(error.message) : String(error);
}
