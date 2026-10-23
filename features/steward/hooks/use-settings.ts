import { useCallback, useState } from "react";
import type { Action, GrantMode, Settings } from "@chrona/contracts";
import { useStewardSession } from "./use-steward-session";
import { useStewardResource } from "./use-steward";
import { useStewardMutation } from "./use-steward-mutation";
import { activeGrants, parseNotificationForm, policyRows } from "../model/settings";
import type { StewardClient } from "../model/client";
export function useSettings() {
  const session = useStewardSession(), client = session.today.client;
  const load = useCallback(async (signal?: AbortSignal) => {
    const [settings, grants, preferences, notifications, connectors, apps, health] = await Promise.all([client.settings(signal), client.grants(signal), client.preferences(signal), client.notifications(signal), client.connectors(signal), client.apps(signal), client.health(signal)]);
    return { settings, grants: grants.items, preferences: preferences.items, notifications: notifications.items, connectors: connectors.items, apps: apps.items, health };
  }, [client]);
  const resource = useStewardResource(load);
  const refresh = () => { resource.refresh(); session.refresh(); };
  const mutation = useStewardMutation(refresh);
  const grants = activeGrants(resource.data?.grants ?? [], Date.now());
  async function changeMode(action: Action, mode: GrantMode) {
    await mutation.run(async () => {
      await client.createGrant({ action, mode, scope: { kind: "global" } });
      for (const grant of grants.filter(g => g.action === action && g.scope.kind === "global")) await client.revokeGrant(grant.id);
    });
    resource.refresh();
  }
  const [preference, setPreference] = useState("");
  async function addPreference() {
    if (preference.trim() && (await mutation.run(() => client.createPreference({ text: preference.trim() }))).ok) setPreference("");
  }
  return { ...resource, client, mutation, refresh, grants, rows: policyRows(grants, Date.now()), changeMode, preference, setPreference, addPreference };
}
export function useNotificationForm(settings: Settings, client: StewardClient, refresh: () => void) {
  const n = settings.notifications;
  const [cap, setCap] = useState(String(n.dailyCap)), [start, setStart] = useState(n.quietHours?.start ?? "23:00"), [end, setEnd] = useState(n.quietHours?.end ?? "08:00"), [quiet, setQuiet] = useState(!!n.quietHours), [digest, setDigest] = useState(n.digestAt), [invalid, setInvalid] = useState(false), [saved, setSaved] = useState(false);
  const mutation = useStewardMutation(refresh);
  async function save() {
    const notifications = parseNotificationForm(cap, start, end, digest, quiet);
    setInvalid(!notifications); setSaved(false);
    if (notifications) setSaved((await mutation.run(() => client.updateSettings({ notifications }))).ok);
  }
  return { cap, setCap, start, setStart, end, setEnd, quiet, setQuiet, digest, setDigest, invalid, saved, save, ...mutation };
}
