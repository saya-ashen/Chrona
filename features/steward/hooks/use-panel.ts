import { useCallback, useState } from "react";
import type { StewardClient } from "../model/client";
import { initialPanelValues, validatePanelEntry, type ToolSpec } from "../model/panel";
import { useStewardResource } from "./use-steward";
import { useStewardMutation } from "./use-steward-mutation";
export function usePanel(client: StewardClient, id: string) {
  return useStewardResource(useCallback((signal?: AbortSignal) => client.tool(id, signal), [client, id]));
}
export function usePanelForm(spec: ToolSpec, client: StewardClient, id: string, refresh: () => void) {
  const [values, setValues] = useState(() => initialPanelValues(spec));
  const [invalid, setInvalid] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const mutation = useStewardMutation(refresh);
  async function save() {
    const parsed = validatePanelEntry(spec, values);
    setInvalid(!parsed.passed);
    if (parsed.passed && (await mutation.run(() => client.addPanelEntry(id, { values: parsed.values }))).ok) setValues(initialPanelValues(spec));
  }
  async function remove(entryId: string) {
    if ((await mutation.run(() => client.deletePanelEntry(id, entryId))).ok) setConfirm(null);
  }
  return { values, setValues, invalid, save, confirm, setConfirm, remove, mutation };
}
