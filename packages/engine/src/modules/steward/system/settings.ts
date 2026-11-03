import { z } from "zod";
import * as outputs from "../system-outputs";
import { createSettings } from "../settings";
import { createGrants } from "../grants";
import { createPreferences } from "../preferences";
import { createNotificationsView, forwardSettings } from "../notify-user";
import { CallError, type SystemModule } from "../module-calls";
import type { StewardPorts } from "../ports";
import { tool, text, entry, json, parsed } from "./shared";

async function handleSettings(ports: StewardPorts, workspaceId: string, name: string, args: Record<string, unknown>) {
  const ctx = { db: ports.db, workspaceId, now: ports.now }, notifications = createNotificationsView(ports, workspaceId);
  const service = createSettings(ctx, { status: notifications.status, forward: (tx, value, at) => forwardSettings(tx, ports, workspaceId, value, at) });
  switch (name) {
    case "get": return json(await service.get());
    case "update": return json(await service.update(parsed(args.settings, "settings")));
    case "grants": return json(await createGrants(ctx).list());
    case "revoke-grant": return json(await createGrants(ctx).revoke(String(args.grant)));
    case "preferences": return json(await createPreferences(ctx).list());
    case "forget": return json(await createPreferences(ctx).delete(String(args.preference)));
    default: throw new CallError("not_found", `settings.${name} not found`);
  }
}
/** `settings`: the user's settings, grants and preferences, for entry modules (v2-9). */
export const settings: SystemModule = {
  name: "settings",
  description: "设置：通知、模型、构建、反思与授权规则。",
  tools: [
    tool("get", "Owner settings: notifications, moduleModel, build limits and today's build usage.", {}, [], { idempotent: true, output: z.lazy(() => outputs.settingsOutput) }),
    tool("update", "Change owner notification, model or build settings. Build edits apply to the next run.", { settings: text('JSON {"notifications"?: {...}, "moduleModel"?: {"models": {tier: {"model", "thinking"?: off..max}}, "maxCallsPerEvent", "maxOutputTokens", "dailyCalls", "timeoutMs", "moduleDailyCalls"?: {module: n}} | null, "builds"?: {"dailyLimit"?: 0..200, "timeoutMinutes"?: 5..120, "maxSubmissions"?: 1..20}, "reflection"?: {"enabled": boolean}, "memory"?: {"provider"?: module name | null, "autoRecall"?: boolean, "autoRetain"?: boolean}, "sessions"?: {"idleMinutes"?: 5..1440, "minContextTokens"?: 0..1000000, "maxContextTokens"?: 10000..1000000}}') }, ["settings"], { idempotent: true, output: z.lazy(() => outputs.settingsOutput) }),
    tool("grants", "Grant rules (what Chrona may do without asking), active first.", {}, [], { idempotent: true, output: z.lazy(() => outputs.settingsGrantsOutput) }),
    tool("revoke-grant", "Revoke a grant rule.", { grant: text() }, ["grant"], { idempotent: true, output: z.lazy(() => outputs.settingsGrantOutput) }),
    tool("preferences", "What Chrona remembers about the user.", {}, [], { idempotent: true, output: z.lazy(() => outputs.settingsPreferencesOutput) }),
    tool("forget", "Delete a remembered preference.", { preference: text() }, ["preference"], { idempotent: true, output: z.lazy(() => outputs.settingsForgetOutput) }),
  ],
  async handle({ ports, workspaceId, caller }, name, args) {
    entry(caller);
    return handleSettings(ports, workspaceId, name, args);
  },
};
