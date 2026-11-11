import { z } from "zod";
import { MindStore } from "./store";
import type { Call } from "./types";

export const REVIEW_TIMER = "mind-review";
const timerSchema = z.object({ id: z.string(), revision: z.string(), status: z.string(), schedule: z.discriminatedUnion("kind", [z.object({ kind: z.literal("every"), milliseconds: z.number() }), z.object({ kind: z.literal("at"), at: z.string() })]) });
const pageSchema = z.object({ items: z.array(timerSchema), nextCursor: z.string().nullable() });

function matchesInterval(timer: z.infer<typeof timerSchema> | undefined, milliseconds: number) {
  return timer && ["active", "running", "paused"].includes(timer.status) && timer.schedule.kind === "every" && timer.schedule.milliseconds === milliseconds;
}

/** Reconcile desired policy with one kernel-owned wakeup. Never replay an uncertain delivery. */
export class MindWakeups {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: MindStore, private readonly call: Call) {}
  sync(explicitResume = false): Promise<void> {
    const work = this.tail.then(() => this.apply(explicitResume));
    this.tail = work.catch(() => {});
    return work;
  }
  private async findReviewTimer() {
    let timer: z.infer<typeof timerSchema> | undefined, cursor: string | null = null;
    do {
      const page = pageSchema.parse(await this.call("timers.list", { limit: 100, ...(cursor ? { cursor } : {}) }));
      timer = page.items.find(row => row.id === REVIEW_TIMER) ?? timer;
      cursor = page.nextCursor;
    } while (cursor);
    return timer;
  }
  private async apply(explicitResume: boolean) {
    try {
      const { settings } = await this.store.read();
      const timer = await this.findReviewTimer();
      if (!settings.enabled) {
        if (timer && timer.status !== "cancelled") await this.call("timers.cancel", { id: REVIEW_TIMER }, { key: `mind-wake:cancel:${timer.revision}` });
      } else {
        const milliseconds = settings.intervalMinutes * 60_000;
        if (timer && ["unknown", "failed"].includes(timer.status) && !explicitResume) throw new Error("自动唤醒结果未确认。请先核对当前检查记录，再在设置中明确启用主动检查；不会重放上次唤醒。");
        if (!matchesInterval(timer, milliseconds)) await this.call("timers.set", { id: REVIEW_TIMER, schedule: { kind: "every", milliseconds } }, { key: `mind-wake:set:${timer?.revision ?? "initial"}:${milliseconds}` });
      }
      await this.store.update(state => { state.runtime.wakeError = null; });
    } catch (error) {
      await this.store.update(state => { state.runtime.wakeError = String(error).slice(0, 500); });
      throw error;
    }
  }
}
