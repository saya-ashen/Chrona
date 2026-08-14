/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Lease fencing checks persisted owner fields defensively across schema upgrades. */
import { db, type Prisma } from "@chrona/db";

type SchedulerLeaseDelegate = {
	updateMany: (input: unknown) => Promise<{ count: number }>;
	findUnique: (input: unknown) => Promise<SchedulerLeaseRecord | null>;
	findUniqueOrThrow: (input: unknown) => Promise<SchedulerLeaseRecord>;
	deleteMany: (input: unknown) => Promise<{ count: number }>;
};

const schedulerLease = db.schedulerLease as unknown as SchedulerLeaseDelegate;

export type SchedulerLeaseInput = {
	name: string;
	ownerId: string;
	ttlMs: number;
	now?: Date;
	metadata?: unknown;
};

export type SchedulerLeaseRenewalInput = SchedulerLeaseInput & {
	epoch: number;
};

export type SchedulerLeaseReleaseInput = {
	name: string;
	ownerId: string;
	epoch: number;
};

export type SchedulerLeaseCompletionInput = {
	name: string;
	ownerId: string;
	epoch: number;
	worker: string;
	status: "completed" | "failed";
	error?: string;
	now?: Date;
};

export type SchedulerWorkContext = {
	signal: AbortSignal;
	lease: {
		name: string;
		ownerId: string;
		epoch: number;
	};
	isLeaseCurrent: () => boolean;
};

export type SchedulerLeaseRecord = {
	name: string;
	ownerId: string;
	epoch: number;
	expiresAt: Date;
	heartbeatAt: Date;
	metadata: unknown;
	createdAt: Date;
	updatedAt: Date;
};

export async function acquireSchedulerLease(input: SchedulerLeaseInput) {
	const now = input.now ?? new Date();
	const expiresAt = new Date(now.getTime() + input.ttlMs);

	const metadata =
		input.metadata === undefined ? null : JSON.stringify(input.metadata);
	const created = await db.$executeRaw`
    INSERT OR IGNORE INTO "SchedulerLease"
      ("name", "ownerId", "epoch", "heartbeatAt", "expiresAt", "metadata", "createdAt", "updatedAt")
    VALUES
      (${input.name}, ${input.ownerId}, 1, ${now}, ${expiresAt}, ${metadata}, ${now}, ${now})
  `;
	if (created === 1) {
		const lease = await schedulerLease.findUniqueOrThrow({
			where: { name: input.name },
		});
		return { acquired: true as const, lease };
	}

	const claimed = await schedulerLease.updateMany({
		where: {
			name: input.name,
			OR: [{ ownerId: input.ownerId }, { expiresAt: { lte: now } }],
		},
		data: {
			ownerId: input.ownerId,
			heartbeatAt: now,
			expiresAt,
			metadata: input.metadata ?? undefined,
			epoch: { increment: 1 },
		},
	});
	const lease = await schedulerLease.findUniqueOrThrow({
		where: { name: input.name },
	});
	return { acquired: claimed.count === 1, lease };
}

export async function renewSchedulerLease(input: SchedulerLeaseRenewalInput) {
	const now = input.now ?? new Date();
	const renewed = await schedulerLease.updateMany({
		where: {
			name: input.name,
			ownerId: input.ownerId,
			epoch: input.epoch,
			expiresAt: { gt: now },
		},
		data: {
			heartbeatAt: now,
			expiresAt: new Date(now.getTime() + input.ttlMs),
		},
	});
	const lease = await schedulerLease.findUnique({
		where: { name: input.name },
	});
	return { renewed: renewed.count === 1, lease };
}

export async function assertSchedulerWorkOwnership(
	context: SchedulerWorkContext | undefined,
	ttlMs = 30_000,
) {
	if (!context) return;
	if (context.signal.aborted || !context.isLeaseCurrent()) {
		throw (
			context.signal.reason ?? new Error("Scheduler lease ownership was lost.")
		);
	}
	const renewal = await renewSchedulerLease({
		name: context.lease.name,
		ownerId: context.lease.ownerId,
		epoch: context.lease.epoch,
		ttlMs,
	});
	if (!renewal.renewed || context.signal.aborted || !context.isLeaseCurrent()) {
		throw (
			context.signal.reason ?? new Error("Scheduler lease ownership was lost.")
		);
	}
}

export async function withSchedulerWorkOwnership<T>(
	context: SchedulerWorkContext | undefined,
	mutate: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
	await assertSchedulerWorkOwnership(context);
	return db.$transaction(async (tx: Prisma.TransactionClient) => {
		if (context) {
			const lease = await (
				tx.schedulerLease as unknown as SchedulerLeaseDelegate
			).updateMany({
				where: {
					name: context.lease.name,
					ownerId: context.lease.ownerId,
					epoch: context.lease.epoch,
					expiresAt: { gt: new Date() },
				},
				data: { heartbeatAt: new Date() },
			});
			if (lease.count !== 1) {
				throw (
					context.signal.reason ??
					new Error("Scheduler lease ownership was lost.")
				);
			}
		}
		return mutate(tx);
	});
}

export async function releaseSchedulerLease(input: SchedulerLeaseReleaseInput) {
	const released = await schedulerLease.deleteMany({
		where: { name: input.name, ownerId: input.ownerId, epoch: input.epoch },
	});
	return released.count === 1;
}

/**
 * Persists a worker terminal outcome only while its owner/epoch lease remains live.
 * Callers must treat false as an unknown outcome and never report the worker result.
 */
export async function completeSchedulerLeaseWork(
	input: SchedulerLeaseCompletionInput,
) {
	const completedAt = input.now ?? new Date();
	const completed = await schedulerLease.updateMany({
		where: {
			name: input.name,
			ownerId: input.ownerId,
			epoch: input.epoch,
			expiresAt: { gt: completedAt },
		},
		data: {
			metadata: {
				worker: input.worker,
				status: input.status,
				error: input.error ?? null,
				completedAt: completedAt.toISOString(),
			} as Prisma.InputJsonValue,
		},
	});
	return completed.count === 1;
}
