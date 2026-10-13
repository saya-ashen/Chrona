import type { PrismaClient } from "@chrona/db";
import { createStewardService } from "@chrona/engine";
import { createInAppDelivery, createLocalTestSource, createRedditInboxSource, createRuleAssessor, createTestDelivery } from "@chrona/integrations/steward";
import type { StewardRoutePorts } from "./routes/steward.routes";
import { areE2eTestRoutesEnabled } from "./routes/test-support.routes";

/** One composition per server, shared by HTTP, the test seam and the worker. */
export function createStewardRuntime(db: PrismaClient, options: { now?: () => Date; onError?: () => void } = {}) {
  const localSource = createLocalTestSource();
  const testRoutesEnabled = areE2eTestRoutesEnabled();
  const delivery = testRoutesEnabled ? createTestDelivery() : undefined;
  // Channel names are user data; inherited Object keys are not adapters.
  const deliveryAdapters: NonNullable<StewardRoutePorts["deliveryAdapters"]> = Object.create(null);
  deliveryAdapters.in_app = createInAppDelivery();
  if (delivery) deliveryAdapters.local_test = { ...delivery.adapter, idempotent: true };
  let available = true;
  const ports: StewardRoutePorts = {
    db, now: options.now,
    sources: { local_test: localSource.adapter, reddit_inbox: createRedditInboxSource() },
    assessor: createRuleAssessor({ available: () => available }),
    deliveryAdapters,
  };
  const service = (workspaceId: string) => createStewardService({ ...ports, authorize: async () => ({ workspaceId, actorKey: "owner:local", canWrite: true }) });
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;
  function start() {
    if (timer || process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test" || process.argv.includes("test")) return;
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
  return { ports, localSource: testRoutesEnabled ? localSource : undefined, delivery, service, setAvailable(value: boolean) { available = value; }, start,
    async stop() { if (timer) clearInterval(timer); timer = undefined; await running; },
  };
}
export type StewardRuntime = ReturnType<typeof createStewardRuntime>;
