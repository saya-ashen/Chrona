import { useCallback, useEffect, useState } from "react";
import { StewardClientError, type StewardClient } from "../model/client";
import { affairAssetType } from "../model/affair-asset";
import { useStewardResource } from "./use-steward";

export function useAffairAsset(client: StewardClient, affairId: string, path: string, revision?: string) {
  const resource = useStewardResource(useCallback((signal?: AbortSignal) => client.raw(affairId, path, signal), [client, affairId, path]), false, revision);
  const [object, setObject] = useState<{ blob: Blob | null; url: string | null; error: StewardClientError | null }>({ blob: null, url: null, error: null });
  const mime = affairAssetType(path);
  useEffect(() => {
    if (!resource.data || !mime) { setObject({ blob: null, url: null, error: null }); return; }
    try {
      const url = URL.createObjectURL(resource.data.slice(0, resource.data.size, mime));
      setObject({ blob: resource.data, url, error: null });
      return () => URL.revokeObjectURL(url);
    } catch { setObject({ blob: resource.data, url: null, error: new StewardClientError("requestError") }); }
  }, [resource.data, mime]);
  return { ...resource, url: object.blob === resource.data ? object.url : null, error: resource.error ?? (object.blob === resource.data ? object.error : null) };
}
