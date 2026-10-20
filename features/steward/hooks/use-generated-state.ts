import { useEffect, useRef, useState } from "react";
import { createStateStore } from "@json-render/core";
import { pageStateUpdates } from "../model/ui-page";

/** A controlled json-render store lets fresh results arrive without resetting inputs. */
export function useGeneratedState(initial: Record<string, unknown>) {
  const [store] = useState(() => createStateStore(initial));
  const previous = useRef(initial);
  useEffect(() => {
    store.update(pageStateUpdates(previous.current, store.getSnapshot(), initial));
    previous.current = initial;
  }, [store, initial]);
  return store;
}
