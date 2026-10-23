import { useCallback } from "react";
import { useStewardResource } from "./use-steward";
import { useStewardSession } from "./use-steward-session";
import { useStewardMutation } from "./use-steward-mutation";

export function useApp(appId: string, path: string) {
  const { today, revision } = useStewardSession();
  const client = today.client;
  const apps = useStewardResource(client.apps, false, String(revision));
  const tree = useStewardResource(useCallback((signal?: AbortSignal) => client.tree(appId, signal), [client, appId]), false, String(revision));
  const refresh = () => { apps.refresh(); tree.refresh(); };
  const mutation = useStewardMutation(refresh);
  const upload = (files: File[]) => mutation.run(async () => {
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : undefined;
    for (const file of files) { await client.upload(appId, file, folder); tree.refresh(); }
  });
  return { client, apps, tree, refresh, mutation, upload, app: apps.data?.items.find(app => app.id === appId || app.name === appId) };
}
