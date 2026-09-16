# MCP control plane

Owns Chrona agent control surfaces:

- External management MCP: `features/mcp-control-plane/routes/management.routes.ts` (`/api/mcp/management`, independent client credentials, stateless durable commands)
- MCP HTTP route: `features/mcp-control-plane/routes/mcp.routes.ts`
- Skill/agent control route: `features/mcp-control-plane/routes/agent-control.routes.ts`
- App shell UI: `features/mcp-control-plane/ui/control-plane-shell.tsx`
- Public entrypoint: `features/mcp-control-plane/index.ts`

Management setup and limitations: [管理 MCP 接入](../../docs/zh/management-mcp.md).

Goal capture adds bounded search/read and idempotent new Draft proposals through
explicit `goals:read` / `goals:propose` scopes. The `assistant-read` / `assistant`
CLI presets grant no task execution or approval authority; legacy presets are
unchanged. The portable [assistant skill](../../packages/skills/chrona-assistant/README.md)
is repository-owned and not automatically installed. Draft activation, standing
permissions and delivery remain outside this first capture slice.

Existing execution route behavior stays unchanged: `/api/mcp` uses existing API auth middleware and MCP session handling; `/agent/control` keeps Bearer run-token validation and control payload schema validation.

Feature tests:

```bash
bun run test:feature mcp-control-plane
```
