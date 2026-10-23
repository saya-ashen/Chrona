import { useCallback } from "react";
import type { StewardClient } from "../model/client";
import { useStewardResource } from "./use-steward";
export function useProviderWork(client: StewardClient, sessionId?: string) {
  const load = useCallback(async (signal?: AbortSignal) => client.providerRuns(sessionId, signal), [client, sessionId]);
  return useStewardResource(load, 5000);
}
