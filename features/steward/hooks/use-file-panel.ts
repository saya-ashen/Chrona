import { useCallback, useMemo, useState } from "react";
import type { PanelBlock } from "@chrona/domain";
import { StewardClientError, type StewardClient } from "../model/client";
import { initialPanelValues, validatePanelEntry } from "../model/panel";
import { panelRows } from "../model/affair-file";
import { useStewardResource } from "./use-steward";
import { useStewardMutation } from "./use-steward-mutation";
export function useFilePanel(client: StewardClient, affairId: string, spec: PanelBlock) {
  // A new tracker has no data file yet: show the form so the first entry can create it.
  const resource = useStewardResource(useCallback(async (signal?: AbortSignal) => {
    try { return await client.file(affairId, spec.data, signal); }
    catch (error) { if (error instanceof StewardClientError && error.status === 404) return { path: spec.data, content: "", mime: "text/csv", revision: null, updatedAt: new Date(0).toISOString() }; throw error; }
  }, [client, affairId, spec.data]));
  const [values, setValues] = useState(() => initialPanelValues(spec));
  const [invalid, setInvalid] = useState(false);
  const mutation = useStewardMutation(resource.refresh);
  const parsed = useMemo(() => {
    try { return { rows: resource.data ? panelRows(resource.data.content, spec) : [], invalid: false }; }
    catch { return { rows: [], invalid: true }; }
  }, [resource.data, spec]);
  async function save() {
    const result = validatePanelEntry(spec, values);
    setInvalid(!result.passed);
    if (result.passed && (await mutation.run(() => client.addPanelEntry(affairId, { dataPath: spec.data, values: result.values }))).ok) setValues(initialPanelValues(spec));
  }
  return { resource, values, setValues, invalid, mutation, parsed, save };
}
