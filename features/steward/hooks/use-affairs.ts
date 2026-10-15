import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import type { Affair } from "@chrona/contracts";
import { useStewardSession } from "./use-steward-session";
import { useStewardResource } from "./use-steward";
import { useStewardMutation } from "./use-steward-mutation";
import { detailView, parseCare, resultVersion } from "../model/affairs";
import { StewardClientError, type StewardClient } from "../model/client";

export function useAffairs() {
  const { today: { client } } = useStewardSession();
  const load = useCallback((signal?: AbortSignal) => client.affairs(undefined, signal), [client]);
  return useStewardResource(load, true);
}
export function useAffair() {
  const { affairId = "" } = useParams();
  const session = useStewardSession(), client = session.today.client;
  const load = useCallback(async (signal?: AbortSignal) => detailView(await client.affair(affairId, signal)), [client, affairId]);
  const resource = useStewardResource(load, true);
  const refresh = () => { resource.refresh(); session.refresh(); };
  return { ...resource, refresh, client, affairId };
}
export function useResult(client: StewardClient, affairId: string) {
  const { version } = useParams(), selected = resultVersion(version);
  const load = useCallback((signal?: AbortSignal) => selected === null ? Promise.reject(new StewardClientError("invalidInput")) : client.result(affairId, selected, signal), [client, affairId, selected]);
  return useStewardResource(load);
}
export function useEntryForm(client: StewardClient, affairId: string, kind: "feedback" | "supplement", refresh: () => void) {
  const [text, setText] = useState("");
  const mutation = useStewardMutation(refresh);
  async function submit() {
    if (!text.trim()) return;
    if ((await mutation.run(() => client.addEntry(affairId, { kind, text: text.trim() }))).ok) setText("");
  }
  return { ...mutation, text, setText, submit };
}
export function useAffairControls(client: StewardClient, affair: Affair, refresh: () => void) {
  const mutation = useStewardMutation(refresh);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const update = async (input: Parameters<StewardClient["updateAffair"]>[1]) => { const result = await mutation.run(() => client.updateAffair(affair.id, input)); if (result.ok) setConfirmEnd(false); return result; };
  return { ...mutation, confirmEnd, setConfirmEnd, update, togglePause: () => update({ status: affair.status === "paused" ? "active" : "paused" }) };
}
export function useCareForm(client: StewardClient, affair: Affair, refresh: () => void) {
  const [editing, setEditing] = useState(false), [minutes, setMinutes] = useState(String((affair.care?.cadenceSeconds ?? 3600) / 60)), [notify, setNotify] = useState<string>(affair.care?.notify ?? "digest"), [invalid, setInvalid] = useState(false);
  const mutation = useStewardMutation(refresh);
  const begin = () => { setMinutes(String((affair.care?.cadenceSeconds ?? 3600) / 60)); setNotify(affair.care?.notify ?? "digest"); setInvalid(false); setEditing(true); };
  async function save() { const care = parseCare(minutes, notify); setInvalid(!care); if (care && (await mutation.run(() => client.updateAffair(affair.id, { care }))).ok) setEditing(false); }
  return { ...mutation, editing, setEditing, begin, minutes, setMinutes, notify, setNotify, invalid, save, stop: () => mutation.run(() => client.updateAffair(affair.id, { care: null })) };
}
