import { useCallback } from "react";
import { useI18n } from "@chrona/i18n";
import { Badge, Button, Card, CardContent } from "@shared/ui";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useStewardClient, useStewardResource } from "../hooks/use-steward";

export type StewardListKind = "affairs" | "delegations" | "connections";
export function StewardListPage({ workspaceId, kind }: { workspaceId: string; kind: StewardListKind }) {
  const { messages } = useI18n(), copy = messages.steward;
  const client = useStewardClient(workspaceId);
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await client[kind](signal);
    return response.items;
  }, [client, kind]);
  const resource = useStewardResource(load);
  return <div className="mx-auto w-full min-w-0 max-w-4xl space-y-4 p-4 [overflow-wrap:anywhere]" data-ui-surface-kind="product-authored">
    <h1 className="text-2xl font-semibold">{copy[kind]}</h1>
    {resource.loading && <p role="status">{copy.loading}</p>}
    {resource.error && <Alert variant="destructive"><AlertTitle>{copy.error}</AlertTitle><AlertDescription><Button onClick={resource.refresh}>{copy.retry}</Button></AlertDescription></Alert>}
    {resource.data?.length === 0 && <p role="status">{copy.empty}</p>}
    {resource.data && <ul className="space-y-3">{resource.data.map(item => <li key={item.id}><Card><CardContent className="space-y-2 pt-4"><h2 className="font-medium">{"title" in item ? item.title : "purpose" in item ? item.purpose : item.label}</h2><p>{copy.status}: <Badge variant="outline">{copy.statuses[item.status]}</Badge></p></CardContent></Card></li>)}</ul>}
  </div>;
}
