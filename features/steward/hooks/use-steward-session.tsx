import { createContext, useContext, useState, type ReactNode } from "react";
import { useSteward, useStewardResource } from "./use-steward";

function useSession(workspaceId: string) {
  const [chatPending, setChatPending] = useState(false);
  const today = useSteward(workspaceId, chatPending);
  const settings = useStewardResource(today.client.settings, true);
  const refresh = () => { today.refresh(); settings.refresh(); };
  return { today, settings, refresh, setChatPending };
}
const SessionContext = createContext<ReturnType<typeof useSession> | null>(null);
export function StewardSession({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  const session = useSession(workspaceId);
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
export function useStewardSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("StewardSession is required");
  return session;
}
