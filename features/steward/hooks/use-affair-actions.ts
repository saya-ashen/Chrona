import { useState } from "react";
import type { StewardClient } from "../model/client";
import { currentFolder, initialSchedule, newPagePath, scheduleInput } from "../model/affair-actions";
import { useStewardMutation } from "./use-steward-mutation";

export function useAffairFiles(client: StewardClient, affairId: string, path: string, refresh: () => void) {
  const mutation = useStewardMutation(refresh);
  const [page, setPage] = useState("");
  const folder = currentFolder(path);
  const upload = (files: File[]) => mutation.run(async () => {
    // Refresh after each file too: a later failure must not hide earlier uploads.
    for (const file of files) { await client.upload(affairId, file, folder || undefined); refresh(); }
  });
  const create = async () => {
    const result = await mutation.run(() => client.saveFile(affairId, { path: newPagePath(folder, page), content: "", baseRevision: null }));
    if (result.ok) setPage("");
  };
  return { mutation, page, setPage, folder, upload, create };
}
export function useAddSchedule(client: StewardClient, affairId: string, refresh: () => void) {
  const mutation = useStewardMutation(refresh);
  const [draft, setDraft] = useState(initialSchedule);
  const submit = async () => {
    const result = await mutation.run(() => client.createSchedule(affairId, scheduleInput(draft)));
    if (result.ok) setDraft(initialSchedule);
  };
  return { mutation, draft, setDraft, submit };
}
