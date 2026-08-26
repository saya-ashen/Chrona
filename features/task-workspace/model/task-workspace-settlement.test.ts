import { describe, expect, it } from "vitest";
import {
	isDurablySettledPlan,
	preserveAcceptedResultReview,
	settleWorkspaceCommand,
	shouldPollExecutionFinalization,
	shouldPollPlanSettlement,
} from "./task-workspace-settlement";

describe("task workspace durable settlement", () => {
	it("lets a durable completed plan stop a stale local generating session", () => {
		const snapshot = {
			aiPlanGenerationStatus: "waiting_acceptance",
			savedPlan: { status: "draft" },
			generationSession: { status: "completed" },
		};
		expect(isDurablySettledPlan(snapshot)).toBe(true);
		expect(shouldPollPlanSettlement(snapshot, "running")).toBe(false);
	});

	it("keeps polling a terminal execution finalizer until its result is durable", () => {
		const pending = {
			status: "completed",
			planOutput: { finalization: { status: "Pending" } },
		} as never;
		const ready = {
			status: "completed",
			planOutput: { finalization: { status: "Ready" } },
		} as never;
		expect(shouldPollExecutionFinalization(pending)).toBe(true);
		expect(shouldPollExecutionFinalization(ready)).toBe(false);
	});

	it("keeps a 202 receipt until its matching state transition and preserves failure text", () => {
		const receipt = {
			commandId: "command-1",
			message: "Command accepted.",
			instruction: "Add sources",
			status: "pending" as const,
		};
		expect(settleWorkspaceCommand(receipt, { type: "heartbeat" })).toEqual(receipt);
		expect(
			settleWorkspaceCommand(receipt, {
				type: "task_workspace_updated",
				commandId: "command-1",
			}),
		).toBeNull();
		expect(
			settleWorkspaceCommand(receipt, {
				type: "command.failed",
				commandId: "command-1",
				message: "Provider timed out",
			}),
		).toMatchObject({ status: "failed", instruction: "Add sources", failureMessage: "Provider timed out" });
		expect(
			settleWorkspaceCommand(receipt, {
				type: "execution.result",
				commandId: "command-1",
			}),
		).toBeNull();
	});

	it("keeps polling when only the local generation session reports a terminal state", () => {
		const snapshot = {
			aiPlanGenerationStatus: "generating",
			savedPlan: { status: "draft" },
			generationSession: { status: "running" },
		};
		expect(shouldPollPlanSettlement(snapshot, "failed")).toBe(true);
		expect(shouldPollPlanSettlement(snapshot, "cancelled")).toBe(true);
	});

	it("does not regress an accepted result when a stale page revalidation arrives", () => {
		const current: { resultReview: { status: string; runId: string; acceptedAt: string | null } } = {
			resultReview: { status: "accepted", runId: "run-1", acceptedAt: "2026-08-22T00:00:00.000Z" },
		};
		const stale: typeof current = { resultReview: { status: "pending_acceptance", runId: "run-1", acceptedAt: null } };
		expect(preserveAcceptedResultReview(current, stale).resultReview).toEqual(current.resultReview);
		const differentRun = { resultReview: { status: "pending_acceptance", runId: "run-2", acceptedAt: null } };
		expect(preserveAcceptedResultReview(current, differentRun).resultReview).toEqual(differentRun.resultReview);
	});
});
