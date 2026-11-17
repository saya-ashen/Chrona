import { describe, expect, test } from "bun:test";
import {
	assertExplicitRetryIssuesFreshAttempt,
	assertInterleavedSettlementConverges,
	assertPoisonedHeadDoesNotStarveTail,
	assertTerminalRecordsReleaseQuota,
} from "./state-machine-invariants";

describe("state-machine-invariants", () => {
	test("assertTerminalRecordsReleaseQuota catches total-row quota counting and passes active-only quota", async () => {
		const buggyRows: Array<{ id: string; active: boolean }> = [];
		await expect(
			assertTerminalRecordsReleaseQuota({
				quota: 5,
				allocate: (i) => {
					if (buggyRows.length >= 5) throw new Error("capacity exceeded");
					const id = `timer-${i}`;
					buggyRows.push({ id, active: true });
					return id;
				},
				settleTerminal: (id) => {
					const found = buggyRows.find((r) => r.id === id);
					if (found) found.active = false;
				},
			}),
		).rejects.toThrow("capacity exceeded");

		const healthyRows: Array<{ id: string; active: boolean }> = [];
		await assertTerminalRecordsReleaseQuota({
			quota: 5,
			allocate: (i) => {
				if (healthyRows.filter((r) => r.active).length >= 5) throw new Error("capacity exceeded");
				const id = `timer-${i}`;
				healthyRows.push({ id, active: true });
				return id;
			},
			settleTerminal: (id) => {
				const found = healthyRows.find((r) => r.id === id);
				if (found) found.active = false;
			},
		});
	});

	test("assertPoisonedHeadDoesNotStarveTail catches fixed oldest-N window without cursor", async () => {
		const createQueue = (rotateCursor: boolean) => {
			const items: Array<{ poisoned: boolean; done: boolean; attempts: number }> = [];
			return {
				windowSize: 3,
				seedBlockedHead: (count: number) => {
					for (let i = 0; i < count; i += 1) items.push({ poisoned: true, done: false, attempts: 0 });
				},
				seedHealthyTail: () => {
					items.push({ poisoned: false, done: false, attempts: 0 });
				},
				tick: () => {
					const candidates = items
						.filter((item) => !item.done)
						.sort((a, b) => (rotateCursor ? a.attempts - b.attempts : 0))
						.slice(0, 3);
					for (const item of candidates) {
						item.attempts += 1;
						if (!item.poisoned) item.done = true;
					}
				},
				isTailProcessed: () => items.some((item) => !item.poisoned && item.done),
			};
		};

		await expect(assertPoisonedHeadDoesNotStarveTail(createQueue(false))).rejects.toThrow("Head-of-line starvation");
		await assertPoisonedHeadDoesNotStarveTail(createQueue(true));
	});

	test("assertExplicitRetryIssuesFreshAttempt catches reused idempotency key on retry", async () => {
		const runScenario = async (includeRetryEpochInKey: boolean) => {
			const seenKeys = new Set<string>();
			let downstreamCalls = 0;
			let epoch = 0;
			let attempts = 0;
			const dispatch = () => {
				attempts += 1;
				const key = includeRetryEpochInKey ? `deliver:1:${epoch}:${attempts}` : `deliver:1:${attempts}`;
				if (seenKeys.has(key)) return;
				seenKeys.add(key);
				downstreamCalls += 1;
			};
			await assertExplicitRetryIssuesFreshAttempt({
				runFailingAttempt: async () => {
					dispatch();
					return "item-1";
				},
				retry: async () => {
					attempts = 0;
					epoch += 1;
					dispatch();
				},
				observedDownstreamAttempts: () => downstreamCalls,
			});
		};

		await expect(runScenario(false)).rejects.toThrow("Explicit retry was short-circuited");
		await runScenario(true);
	});

	test("assertInterleavedSettlementConverges catches split-transaction waiting race", async () => {
		const makeStore = (recheckDecisionWhenEnteringWaiting: boolean) => {
			const state = new Map<string, { decision: "open" | "approved"; call: "running" | "waiting" | "queued" }>();
			return {
				beginRequest: async (scenario: "ordered" | "interleaved") => {
					state.set(scenario, { decision: "open", call: "running" });
					return scenario;
				},
				resolveExternally: async (id: string) => {
					const row = state.get(id)!;
					row.decision = "approved";
					if (row.call === "waiting") row.call = "queued";
				},
				enterWaiting: async (id: string) => {
					const row = state.get(id)!;
					row.call = recheckDecisionWhenEnteringWaiting && row.decision !== "open" ? "queued" : "waiting";
				},
				readFinalState: async (id: string) => ({ ...state.get(id)! }),
				isStuckWaiting: (s: { call: string }) => s.call === "waiting",
			};
		};

		await expect(assertInterleavedSettlementConverges(makeStore(false))).rejects.toThrow("Lost settlement race");
		const res = await assertInterleavedSettlementConverges(makeStore(true));
		expect(res.interleaved.call).toBe("queued");
	});
});
