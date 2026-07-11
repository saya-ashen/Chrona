import { useMemo, type ReactNode } from "react";
import { JSONUIProvider, Renderer, type StateStore } from "@json-render/react";
import { CATALOG_VERSION, isCatalogCompatible, type UiDocument } from "@chrona/ui-protocol";
import { ResultCollapseProvider, workspaceRegistry, type ResultCollapseCommand } from "./workspace-registry";

/**
 * Renders a json-render {@link UiDocument} with the Chrona workspace registry.
 * Falls back to the supplied typed renderer when there is no spec, or when the
 * spec was produced against an incompatible catalog major version (plan §4.3,
 * §7). Invalid specs are rejected upstream by `validateChronaSpec`; this guards
 * the render path itself.
 */
export function SpecRenderer({
  spec,
  catalogVersion = CATALOG_VERSION,
  loading,
  fallback,
  handlers,
  onStateChange,
  store,
  resultCollapseCommand,
  resultCollapseStorageKey,
}: {
  spec: UiDocument | null | undefined;
  catalogVersion?: string;
  loading?: boolean;
  fallback?: ReactNode;
  /** Per-render action handlers forwarded to JSONUIProvider (plan §6). */
  handlers?: Record<string, (params: Record<string, unknown>) => Promise<unknown> | unknown>;
  /** State-change notifications from JSONUIProvider (path/value pairs). */
  onStateChange?: (changes: Array<{ path: string; value: unknown }>) => void;
  store?: StateStore;
  resultCollapseCommand?: ResultCollapseCommand | null;
  resultCollapseStorageKey?: string | null;
}) {
  const keyedSpec = useMemo(() => {
    if (!spec?.elements) return spec;
    return {
      ...spec,
      elements: Object.fromEntries(Object.entries(spec.elements).map(([key, element]) => [
        key,
        { ...element, props: { ...element.props, __chronaCollapseStorageId: key } },
      ])),
    };
  }, [spec]);

  if (!spec || !isCatalogCompatible(catalogVersion)) {
    return <>{fallback}</>;
  }

  const renderSpec = keyedSpec ?? spec;

  return (
    <ResultCollapseProvider command={resultCollapseCommand} storageKey={resultCollapseStorageKey}>
      <JSONUIProvider registry={workspaceRegistry} store={store} initialState={renderSpec.state} handlers={handlers} onStateChange={onStateChange}>
        <Renderer spec={renderSpec} registry={workspaceRegistry} loading={loading} />
      </JSONUIProvider>
    </ResultCollapseProvider>
  );
}
