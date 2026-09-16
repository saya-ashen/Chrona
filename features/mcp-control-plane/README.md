# MCP control plane

Owns Chrona agent control surfaces:

- External management MCP: `features/mcp-control-plane/routes/management.routes.ts` (`/api/mcp/management`, independent client credentials, stateless durable commands)
- MCP HTTP route: `features/mcp-control-plane/routes/mcp.routes.ts`
- Skill/agent control route: `features/mcp-control-plane/routes/agent-control.routes.ts`
- App shell UI: `features/mcp-control-plane/ui/control-plane-shell.tsx`
- Public entrypoint: `features/mcp-control-plane/index.ts`

Management setup and limitations: [管理 MCP 接入](../../docs/zh/management-mcp.md).

Goal tools add bounded search/read, idempotent new Draft proposals and CAS-based
existing-Goal edits/notes. Explicit scopes: `goals:read`, `goals:propose`, and
opt-in `goals:write`; presets: `assistant-read`, `assistant`, `assistant-edit`.
Existing credentials/presets are not widened. None grants execution or approval.
Editing uses persisted `editRevision`, read-only previews, atomic brief/audit
history and preserved Task contexts; source implementation needs its registered
migration and separate rollout. The portable
[assistant skill](../../packages/skills/chrona-assistant/README.md) is repository-owned
and not automatically installed. Draft activation, standing permission enforcement
and delivery remain outside this milestone.

Existing execution route behavior stays unchanged: `/api/mcp` uses existing API auth middleware and MCP session handling; `/agent/control` keeps Bearer run-token validation and control payload schema validation.

Feature tests:

```bash
bun run test:feature mcp-control-plane
```
