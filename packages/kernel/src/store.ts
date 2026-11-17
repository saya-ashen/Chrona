import type * as db from "@chrona/db";
import * as c from "@chrona/contracts/steward";
/** Only schema keys cross the boundary; payloads, tokens and delivery leases stay private. */
function project<T>(schema: { shape: Record<string, unknown>; parse(value: unknown): T }, row: object): T {
  const source = row as Record<string, unknown>;
  return schema.parse(Object.fromEntries(Object.keys(schema.shape).map(key => [key, source[key] instanceof Date ? source[key].toISOString() : source[key]])));
}
export const toApproval = (row: db.Approval) => project(c.approvalSchema, row);
