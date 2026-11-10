import type { Spec } from "@json-render/core";
import type { SystemHost } from "./system/adapter";

type Args = Record<string, unknown>;
export type Source = { tool: string; args?: Args; refresh?: number };
export type Extension = { revision: string; props?: Record<string, unknown>; events?: string[]; slots?: string[]; tools?: string[] };
export type Page = { module: string; moduleId?: string; id: string; title: string; purpose?: "settings"; revision?: string; hash?: string; contracts?: Record<string, string>; extensions?: Record<string, Extension>; data: Record<string, Source>; spec: Spec; keyed?: string[]; needs?: Record<string, string[]> };
export type Deps = { call: (target: string, args: Args) => Promise<unknown>; navigate: (path: string, replace?: boolean) => void; content: (path: string) => Promise<Blob> };

/** Standalone and embedded pages use the same page-pinned HTTP calls and content route. */
export function registeredDeps(page: Page, web: SystemHost["web"], navigate: Deps["navigate"]): Deps {
  return {
    call: (target, args) => web("/call", { method: "POST", body: { target, args, page: { module: page.module, id: page.id, revision: page.revision } } }),
    navigate,
    content: path => web(path, { raw: true }) as Promise<Blob>,
  };
}
