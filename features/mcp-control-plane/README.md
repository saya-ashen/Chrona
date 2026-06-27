# MCP control plane

Owns Chrona agent control surfaces:

- MCP HTTP route: `features/mcp-control-plane/routes/mcp.routes.ts`
- Skill/agent control route: `features/mcp-control-plane/routes/agent-control.routes.ts`
- App shell UI: `features/mcp-control-plane/ui/control-plane-shell.tsx`
- Public entrypoint: `features/mcp-control-plane/index.ts`

Route behavior stays unchanged: `/api/mcp` uses existing API auth middleware and MCP session handling; `/agent/control` keeps Bearer run-token validation and control payload schema validation.

Feature tests:

```bash
bun run test:feature mcp-control-plane
```
