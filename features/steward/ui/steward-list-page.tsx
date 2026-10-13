import { DelegationsPage } from "./delegations-page";
import { ConnectionsPage } from "./connections-page";
import { AffairsPage } from "./affairs-page";

export type StewardListKind = "affairs" | "delegations" | "connections";
export function StewardListPage({ workspaceId, kind }: { workspaceId: string; kind: StewardListKind }) {
  if (kind === "delegations") return <DelegationsPage workspaceId={workspaceId} />;
  if (kind === "connections") return <ConnectionsPage workspaceId={workspaceId} />;
  return <AffairsPage workspaceId={workspaceId} />;
}
