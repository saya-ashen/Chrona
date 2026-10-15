import type { PrismaClient } from "@chrona/db";
import { createStewardService } from "@chrona/engine";
import { createChinoServiceHealthSource, createHermesQqDelivery, createInAppDelivery, createLocalTestSource, createPiAssessor, createRedditInboxSource, createRuleAssessor, createTestDelivery } from "@chrona/integrations/steward";
import type { StewardRoutePorts } from "./routes/steward.routes";
import { areE2eTestRoutesEnabled } from "./routes/test-support.routes";
import { createStewardAgentLoop } from "./steward-agent-loop";
import { createStewardQqBot } from "./steward-qq-bot";

/** Host-owned QQ delivery: the recipient allowlist and the public origin used in message links. */
function chatDeliveryConfig() {
  const allowedRecipients = (process.env.CHRONA_STEWARD_CHAT_RECIPIENTS ?? "").split(",").map(value => value.trim()).filter(value => /^qqbot:[A-Za-z0-9_-]{1,128}$/.test(value));
  let publicUrl: string | null = null;
  try { const url = new URL(process.env.CHRONA_PUBLIC_URL ?? ""); if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash) publicUrl = url.origin; } catch { /* No valid public origin configured. */ }
  return { allowedRecipients, publicUrl };
}

/** One composition per server, shared by HTTP, the test seam and the worker. */
export function createStewardRuntime(db: PrismaClient, options: { now?: () => Date; onError?: () => void; port?: number } = {}) {
  const localSource = createLocalTestSource();
  const testRoutesEnabled = areE2eTestRoutesEnabled();
  const delivery = testRoutesEnabled ? createTestDelivery() : undefined;
  // Channel names are user data; inherited Object keys are not adapters.
  const deliveryAdapters: NonNullable<StewardRoutePorts["deliveryAdapters"]> = Object.create(null);
  deliveryAdapters.in_app = createInAppDelivery();
  if (delivery) deliveryAdapters.local_test = { ...delivery.adapter, idempotent: true };
  const { allowedRecipients, publicUrl } = chatDeliveryConfig();
  if (allowedRecipients.length) deliveryAdapters.hermes_qqbot = createHermesQqDelivery({ allowedRecipients, publicUrl, command: process.env.CHRONA_STEWARD_HERMES_COMMAND || undefined });
  // Chrona's own QQ bot (optional): adds `chrona_qqbot` and, once bound, the owner's recipient.
  const qqBot = testRoutesEnabled ? null : createStewardQqBot({ db, allowedRecipients, deliveryAdapters, publicUrl, now: options.now });
  let available = true;
  const ports: StewardRoutePorts = {
    db, now: options.now, chatRecipients: allowedRecipients,
    sources: {
      local_test: localSource.adapter, reddit_inbox: createRedditInboxSource(),
      // Host-owned: only a host that runs the Chino dashboard configures this.
      chino_service_health: createChinoServiceHealthSource({ url: process.env.CHRONA_STEWARD_CHINO_DASHBOARD_URL }),
    },
    // "pi" asks the host's Pi model; the default is the deterministic rule assessor, which is not AI.
    assessor: process.env.CHRONA_STEWARD_ASSESSOR === "pi"
      ? createPiAssessor({ command: process.env.CHRONA_STEWARD_PI_COMMAND, model: process.env.CHRONA_STEWARD_PI_MODEL })
      : createRuleAssessor({ available: () => available }),
    deliveryAdapters,
  };
  const service = (workspaceId: string) => createStewardService({ ...ports, authorize: async () => ({ workspaceId, actorKey: "owner:local", canWrite: true }) });
  const agent = createStewardAgentLoop({ db, now: options.now, port: options.port, allowedRecipients, deliver: workspaceId => service(workspaceId).tick(), onError: options.onError });
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;
  function start() {
    if (timer || process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test" || process.argv.includes("test")) return;
    agent.start();
    void qqBot?.start().catch(() => options.onError?.());
    const seconds = Number(process.env.CHRONA_STEWARD_TICK_SECONDS ?? 60);
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    timer = setInterval(() => {
      if (running) return;
      running = (async () => {
        for (const workspace of await db.workspace.findMany({ select: { id: true } })) {
          try { await service(workspace.id).tick(); } catch { options.onError?.(); }
        }
      })().catch(() => options.onError?.()).finally(() => { running = undefined; });
    }, seconds * 1000);
  }
  return { ports, agent, localSource: testRoutesEnabled ? localSource : undefined, delivery, service, setAvailable(value: boolean) { available = value; }, start,
    async stop() { if (timer) clearInterval(timer); timer = undefined; await Promise.all([running, agent.stop(), qqBot?.stop()]); },
  };
}
export type StewardRuntime = ReturnType<typeof createStewardRuntime>;
