/**
 * Reusable counterexample harnesses for stateful queues, quotas, retries, and two-phase settlements.
 *
 * Every capacity check, recovery loop, retry path, or split-transaction workflow in Chrona should
 * pass the matching invariant here—not only happy-path single-item tests.
 */

export interface QuotaCycleHarness<TId = string> {
	/** Declared active capacity limit (for example 100 active timers or 512 cleanup commands). */
	quota: number;
	/** Additional distinct IDs beyond `quota` to allocate after earlier items reach terminal state. */
	extra?: number;
	/** Allocate a fresh item for `index` and return its identifier. */
	allocate: (index: number) => Promise<TId> | TId;
	/** Move `id` into a terminal (completed/cancelled/expired) state. */
	settleTerminal: (id: TId, index: number) => Promise<void> | void;
}

/**
 * Verifies that completed/cancelled records do not permanently consume active capacity quotas.
 */
export async function assertTerminalRecordsReleaseQuota<TId = string>(
	harness: QuotaCycleHarness<TId>,
): Promise<void> {
	const total = harness.quota + (harness.extra ?? Math.max(2, Math.ceil(harness.quota * 0.1)));
	for (let index = 0; index < total; index += 1) {
		const id = await harness.allocate(index);
		await harness.settleTerminal(id, index);
	}
}

export interface HeadOfLineHarness {
	/** Batch/window size fetched per recovery or scheduler tick (for example 10 or 6). */
	windowSize: number;
	/** Seed `count` blocked, budget-exhausted, or permanently unqueryable items ahead of healthy work. */
	seedBlockedHead: (count: number) => Promise<void> | void;
	/** Enqueue a healthy item behind the blocked head. */
	seedHealthyTail: () => Promise<void> | void;
	/** Run one scheduler/recovery tick. */
	tick: (iteration: number) => Promise<void> | void;
	/** Return true once the healthy tail item has made forward progress. */
	isTailProcessed: () => Promise<boolean> | boolean;
	/** Maximum ticks allowed before declaring head-of-line starvation (defaults to `windowSize + 4`). */
	maxTicks?: number;
}

/**
 * Verifies that `windowSize` poisoned/blocked items at the head of a queue cannot starve healthy work behind them.
 */
export async function assertPoisonedHeadDoesNotStarveTail(
	harness: HeadOfLineHarness,
): Promise<void> {
	await harness.seedBlockedHead(harness.windowSize + 1);
	await harness.seedHealthyTail();
	const budget = harness.maxTicks ?? harness.windowSize + 4;
	for (let step = 0; step < budget; step += 1) {
		await harness.tick(step);
		if (await harness.isTailProcessed()) return;
	}
	throw new Error(
		`Head-of-line starvation: healthy tail item made no progress after ${budget} ticks behind ${harness.windowSize + 1} blocked items.`,
	);
}

export interface ExplicitRetryHarness<TItem> {
	/** Trigger initial execution that fails and lands in a retryable failure state. */
	runFailingAttempt: () => Promise<TItem>;
	/** Invoke explicit owner/system retry on the failed item. */
	retry: (failed: TItem) => Promise<void>;
	/** Return total distinct downstream delivery/effect invocations actually executed (excluding cached receipt replays). */
	observedDownstreamAttempts: () => Promise<number> | number;
}

/**
 * Verifies that an explicit retry triggers a genuinely new downstream attempt rather than replaying a cached failure receipt.
 */
export async function assertExplicitRetryIssuesFreshAttempt<TItem>(
	harness: ExplicitRetryHarness<TItem>,
): Promise<void> {
	const failed = await harness.runFailingAttempt();
	const before = await harness.observedDownstreamAttempts();
	if (before < 1) {
		throw new Error(`Expected initial failing attempt to reach downstream target at least once, observed ${before}.`);
	}
	await harness.retry(failed);
	const after = await harness.observedDownstreamAttempts();
	if (after <= before) {
		throw new Error(
			`Explicit retry was short-circuited (downstream attempts stayed at ${after}); check idempotency key generation on retry.`,
		);
	}
}

export interface InterleavedSettlementHarness<THandle, TState> {
	/** Phase 1: create external/open record before caller transitions into its waiting state. */
	beginRequest: (scenario: "ordered" | "interleaved") => Promise<THandle>;
	/** External decision/mutation arriving either before or after `enterWaiting`. */
	resolveExternally: (handle: THandle, scenario: "ordered" | "interleaved") => Promise<void>;
	/** Phase 2: caller transitions into waiting (or settles immediately if external decision already landed). */
	enterWaiting: (handle: THandle, scenario: "ordered" | "interleaved") => Promise<void>;
	/** Read final observable state for comparison. */
	readFinalState: (handle: THandle, scenario: "ordered" | "interleaved") => Promise<TState>;
	/** Predicate identifying a stuck non-terminal waiting state. */
	isStuckWaiting: (state: TState) => boolean;
}

/**
 * Verifies that an external decision arriving between `beginRequest` and `enterWaiting` converges to the same settled state.
 */
export async function assertInterleavedSettlementConverges<THandle, TState>(
	harness: InterleavedSettlementHarness<THandle, TState>,
): Promise<{ ordered: TState; interleaved: TState }> {
	const orderedHandle = await harness.beginRequest("ordered");
	await harness.enterWaiting(orderedHandle, "ordered");
	await harness.resolveExternally(orderedHandle, "ordered");
	const ordered = await harness.readFinalState(orderedHandle, "ordered");

	const interleavedHandle = await harness.beginRequest("interleaved");
	await harness.resolveExternally(interleavedHandle, "interleaved");
	await harness.enterWaiting(interleavedHandle, "interleaved");
	const interleaved = await harness.readFinalState(interleavedHandle, "interleaved");

	if (harness.isStuckWaiting(interleaved)) {
		throw new Error(
			`Lost settlement race: interleaved decision left item stuck in waiting state (${JSON.stringify(interleaved)}).`,
		);
	}
	if (JSON.stringify(interleaved) !== JSON.stringify(ordered)) {
		throw new Error(
			`Interleaved settlement diverged from ordered settlement: expected ${JSON.stringify(ordered)}, got ${JSON.stringify(interleaved)}.`,
		);
	}
	return { ordered, interleaved };
}
