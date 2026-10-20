import { useCallback } from "react";
import type { StewardClient } from "../model/client";
import { useStewardResource } from "./use-steward";
export function useProviderWork(client: StewardClient, affairId?: string) {
  const load = useCallback(async (signal?: AbortSignal) => client.providerRuns(affairId, signal), [client, affairId]);
  return useStewardResource(load, 5000);
}
