import { ChevronDown, ChevronUp } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@chrona/i18n";
import { cn } from "@shared/ui";
import { stringProp } from "./workspace-registry-utilities";

export type ResultCollapseCommand = { mode: "collapse" | "expand"; revision: number };
type ContextValue = { command: ResultCollapseCommand | null; storageKey: string | null };
type BlockProps = { title?: string | null; summary?: string | null; defaultCollapsed?: boolean | null; storageId?: string; subtle?: boolean; children?: ReactNode };
const Context = createContext<ContextValue>({ command: null, storageKey: null });
const prefix = "chrona.resultCollapse";

function stored(storageKey: string | null, storageId?: string) {
  if (!storageKey || !storageId || typeof window === "undefined") return undefined;
  try { const value = JSON.parse(window.localStorage.getItem(`${prefix}:${storageKey}`) ?? "{}") as Record<string, unknown>; return typeof value[storageId] === "boolean" ? value[storageId] : undefined; } catch { return undefined; }
}

function persist(storageKey: string | null, storageId: string | undefined, collapsed: boolean) {
  if (!storageKey || !storageId || typeof window === "undefined") return;
  try { const key = `${prefix}:${storageKey}`; const value = JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<string, boolean>; window.localStorage.setItem(key, JSON.stringify({ ...value, [storageId]: collapsed })); } catch { /* browser storage is best effort */ }
}

export function ResultCollapseProvider({ children, command, storageKey }: { children: ReactNode; command?: ResultCollapseCommand | null; storageKey?: string | null }) {
  return <Context.Provider value={{ command: command ?? null, storageKey: storageKey ?? null }}>{children}</Context.Provider>;
}

export function collapseStorageIdFromProps(props: Record<string, unknown>) { return stringProp(props.__chronaCollapseStorageId); }
export function shouldCollapseByDefault(props: Record<string, unknown>, fallback: boolean) { return props.defaultCollapsed === true ? true : props.defaultCollapsed === false ? false : fallback; }

function CollapseToggle({ collapsed, label, onClick, summary }: { collapsed: boolean; label: string; onClick: () => void; summary?: string | null }) {
  const { messages } = useI18n(); const copy = messages.components.taskWorkspace;
  return <button type="button" className="flex w-full min-w-0 max-w-full items-center justify-between gap-2 text-left" onClick={onClick} aria-expanded={!collapsed}><span className="min-w-0 flex-1"><span className="block truncate font-medium text-foreground">{label}</span>{summary ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{summary}</span> : null}</span><span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-muted-foreground">{collapsed ? copy.showResultDetails ?? "Show" : copy.hideResultDetails ?? "Hide"}{collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}</span></button>;
}

export function CollapsibleBlock({ children, defaultCollapsed, storageId, subtle = false, summary, title }: BlockProps) {
  const { messages } = useI18n(); const { command, storageKey } = useContext(Context); const fallback = Boolean(defaultCollapsed);
  const [collapsed, setState] = useState(() => stored(storageKey, storageId) ?? fallback);
  const setCollapsed = useCallback((next: boolean | ((current: boolean) => boolean)) => setState((current) => { const value = typeof next === "function" ? next(current) : next; persist(storageKey, storageId, value); return value; }), [storageKey, storageId]);
  useEffect(() => setState(stored(storageKey, storageId) ?? fallback), [fallback, storageId, storageKey]);
  useEffect(() => { if (command) setCollapsed(command.mode === "collapse"); }, [command?.mode, command?.revision, setCollapsed]);
  return <section className={cn("min-w-0 w-full max-w-full overflow-hidden text-sm", subtle ? "border-t border-border/60 py-3 first:border-t-0 first:pt-0" : "rounded-xl border border-border/70 bg-muted/45 px-3 py-2.5")}><CollapseToggle collapsed={collapsed} label={title || (messages.components.taskWorkspace.resultDetailsLabel ?? "Details")} summary={summary} onClick={() => setCollapsed((current) => !current)} />{collapsed ? null : <div className={cn("min-w-0 w-full max-w-full overflow-hidden space-y-2", subtle ? "mt-3" : "mt-2")}>{children}</div>}</section>;
}
