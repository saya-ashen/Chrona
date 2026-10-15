import type { PrismaClient } from "@chrona/db";
import type { SourceItem, SourceAdapter } from "@chrona/contracts/steward";
import { createLocalTestSource } from "@chrona/integrations/steward";

export function createScopedTestSource(db: PrismaClient) {
  const sources = new Map<string, ReturnType<typeof createLocalTestSource>>();
  function source(workspaceId: string) {
    let value = sources.get(workspaceId);
    if (!value) { value = createLocalTestSource(); sources.set(workspaceId, value); }
    return value;
  }
  const adapter: SourceAdapter = { ...createLocalTestSource().adapter,
    async poll(connection, cursor) {
      const row = await db.sourceConnection.findUniqueOrThrow({ where: { id: connection.id }, select: { workspaceId: true } });
      return source(row.workspaceId).adapter.poll(connection, cursor);
    },
  };
  return { adapter, push(items: SourceItem[], workspaceId: string) { source(workspaceId).push(items); }, reset(workspaceId: string) { sources.delete(workspaceId); } };
}
