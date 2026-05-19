import { useSyncExternalStore, type ReactNode } from "react";
import { useRevalidator } from "react-router-dom";

import { AccessKeyUnlock } from "@/components/access-key-unlock";
import { isAccessLocked, setAccessKey, subscribeAccessKey } from "@/lib/access-key";

type AccessKeyGateProps = {
  children: ReactNode;
};

export function AccessKeyGate({ children }: AccessKeyGateProps) {
  const accessLocked = useSyncExternalStore(subscribeAccessKey, isAccessLocked, isAccessLocked);
  const revalidator = useRevalidator();

  if (accessLocked) {
    return (
      <AccessKeyUnlock
        onUnlock={(key, remember) => {
          setAccessKey(key, remember);
          void revalidator.revalidate();
        }}
      />
    );
  }

  return children;
}
