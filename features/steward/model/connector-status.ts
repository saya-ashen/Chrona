import type { Connector } from "@chrona/contracts";

export function connectorStatusClass(status: Connector["status"]) {
  if (status === "active") return "bg-success/10 text-success";
  return status === "failing" || status === "needs_authorization" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground";
}
